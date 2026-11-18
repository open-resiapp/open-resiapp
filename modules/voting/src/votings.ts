import "server-only";

import { aliasedTable, and, desc, eq, ne, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { users, entities, memberships } from "@/db/schema";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { assertBoard, isBoard } from "@/lib/mcp/authz";
import { McpError, validationError } from "@/lib/mcp/errors";
import type { Session } from "next-auth";
import { principalFromSession, type Principal, type Viewer } from "@/lib/mcp/principal";
import type { ApiKeyPermission, Country } from "@/types";
import { votings, votingItems } from "./db/schema";
import { validatePerRollamDuration } from "./rules";
import { applyRepeatEscalation, normalizeItems } from "./items";
import { findDisallowedQuorum } from "./quorum-guard.server";
import { noticeRulesFor, validateNotice } from "./workflow/notice";
import { recordVotingEvent } from "./events";
import { timeZoneForCountry } from "@/lib/time-zone";
import { createMeetingPost } from "./attendance";
import { notifyVotingStarted } from "./voting-notify.server";

// Votings list / detail / create — shared by /api/votings(/[id]) and the
// MCP voting tools (BYT-20261117-001 §3).

/**
 * Who reads votings: the Viewer plus what the draft rule needs. A Principal
 * satisfies it (web routes build one via `principalFromSession`).
 */
export type VotingViewer = Viewer & Pick<Principal, "status" | "boardRoles">;

/**
 * Drafts are board-only: admin OR active chairman (the `assertBoard` rule
 * that also creates them). Same rule for web routes and MCP tools.
 */
export function canSeeDraftVotings(viewer: VotingViewer): boolean {
  return viewer.status === "active" && isBoard(viewer);
}

/**
 * Visibility rule (RES-20260501-002): a user sees voting V iff they hold an
 * active membership whose entity overlaps V.entity along the path (ancestor
 * / equal / descendant), or they are V's assigned vote counter. The board
 * (admin / active chairman — `canSeeDraftVotings`) sees every voting of the
 * community, drafts included; a non-active admin keeps the scope bypass but
 * not drafts. Everyone else never sees drafts.
 *
 * The ONE voting visibility filter — every user-facing voting read (web
 * routes, home cards, MCP tools) applies it; undefined = no restriction.
 */
export function votingVisibilityFilter(viewer: VotingViewer): SQL | undefined {
  if (canSeeDraftVotings(viewer)) return undefined;
  const notDraft = ne(votings.status, "draft");
  if (viewer.role === "admin") return notDraft;
  const scoped = sql`(EXISTS (
    SELECT 1
    FROM ${memberships} m
    JOIN ${entities} me ON me.id = m.entity_id
    JOIN ${entities} ve ON ve.id = ${votings.entityId}
    WHERE m.user_id = ${viewer.userId}
      AND m.status = 'active'
      AND (ve.path LIKE me.path || '%' OR me.path LIKE ve.path || '%')
  ) OR ${votings.voteCounterId} = ${viewer.userId})`;
  return and(scoped, notDraft);
}

/** Is voting `votingId` visible to the viewer? Missing = false (callers answer 404). */
export async function isVotingVisible(viewer: VotingViewer, votingId: string): Promise<boolean> {
  const filter = votingVisibilityFilter(viewer);
  const [row] = await db
    .select({ id: votings.id })
    .from(votings)
    .where(filter ? and(eq(votings.id, votingId), filter) : eq(votings.id, votingId))
    .limit(1);
  return !!row;
}

/**
 * Session variant for routes that do not otherwise build a Principal.
 * A gone user / missing community counts as not visible.
 */
export async function sessionCanSeeVoting(session: Session, votingId: string): Promise<boolean> {
  let principal: Principal;
  try {
    principal = await principalFromSession(session);
  } catch (err) {
    if (err instanceof McpError) return false;
    throw err;
  }
  return isVotingVisible(principal, votingId);
}

/**
 * External API keys (/api/external/v1) are community-wide integrations an
 * admin issues (`manageApiKeys`); there is no user behind them, so the scope
 * is the whole community. Drafts are internal board work: only a `full` key
 * (the admin-equivalent tier) sees them; `read` / `read_write` keys never do.
 */
export function apiKeyCanSeeDraftVotings(permission: ApiKeyPermission): boolean {
  return permission === "full";
}

/** Votings visible to the viewer (scope + board-only drafts), newest first. */
export async function listVisibleVotings(viewer: VotingViewer) {
  const entrance = aliasedTable(entities, "entrance");
  const baseQuery = db
    .select({
      id: votings.id,
      title: votings.title,
      description: votings.description,
      status: votings.status,
      votingType: votings.votingType,
      initiatedBy: votings.initiatedBy,
      startsAt: votings.startsAt,
      endsAt: votings.endsAt,
      createdAt: votings.createdAt,
      entityId: votings.entityId,
      entranceName: entrance.name,
      createdBy: {
        id: users.id,
        name: users.name,
      },
    })
    .from(votings)
    .leftJoin(users, eq(votings.createdById, users.id))
    .leftJoin(entrance, eq(entrance.id, votings.entityId));

  const filter = votingVisibilityFilter(viewer);
  const q = filter ? baseQuery.where(filter) : baseQuery;
  return q.orderBy(desc(votings.createdAt));
}

async function loadVotingDetail(where: SQL | undefined) {
  const entrance = aliasedTable(entities, "entrance");
  const [voting] = await db
    .select({
      id: votings.id,
      title: votings.title,
      description: votings.description,
      status: votings.status,
      votingType: votings.votingType,
      initiatedBy: votings.initiatedBy,
      startsAt: votings.startsAt,
      endsAt: votings.endsAt,
      createdAt: votings.createdAt,
      voteCounterId: votings.voteCounterId,
      entityId: votings.entityId,
      documentProjectId: votings.documentProjectId,
      place: votings.place,
      announcedAt: votings.announcedAt,
      resultPublishedAt: votings.resultPublishedAt,
      entranceName: entrance.name,
      createdBy: {
        id: users.id,
        name: users.name,
      },
    })
    .from(votings)
    .leftJoin(users, eq(votings.createdById, users.id))
    .leftJoin(entrance, eq(entrance.id, votings.entityId))
    .where(where)
    .limit(1);
  if (!voting) return null;

  // BYT-20260609-008: ordered ballot items (each with its own quorumType).
  const items = await db
    .select()
    .from(votingItems)
    .where(eq(votingItems.votingId, voting.id))
    .orderBy(votingItems.idx);

  return { ...voting, items };
}

export type VotingDetail = NonNullable<Awaited<ReturnType<typeof getVisibleVotingDetail>>>;

/**
 * Voting detail with the visibility rule (scope + board-only drafts)
 * applied. Invisible and missing are both null, so ids can't be probed.
 * Used by GET /api/votings/[id] and the MCP voting tools.
 */
export async function getVisibleVotingDetail(viewer: VotingViewer, votingId: string) {
  const filter = votingVisibilityFilter(viewer);
  return loadVotingDetail(
    filter ? and(eq(votings.id, votingId), filter) : eq(votings.id, votingId)
  );
}

export interface CreateVotingInput {
  title?: string;
  description?: string | null;
  startsAt?: string | Date;
  endsAt?: string | Date;
  status?: "draft" | "active" | "closed";
  votingType?: "written" | "meeting";
  initiatedBy?: "board" | "owners_quarter";
  /** Scope entity; legacy `entranceId` accepted for older clients. */
  entityId?: string | null;
  entranceId?: string | null;
  documentProjectId?: string | null;
  /** Where ballot lists are signed / handed in (§14a ods. 2). */
  place?: string | null;
  /** Raw ballot items as sent by clients — normalised by `normalizeItems`. */
  items?: unknown;
  /**
   * BYT-20261118-001: meeting voting created active → also create the
   * linked owners' meeting event post in the same transaction.
   */
  announceMeeting?: boolean;
  // normalizeItems also reads legacy single-item fields off the body.
  [legacy: string]: unknown;
}

/**
 * Creates a voting + its items as `principal`. Authz: board (admin / active
 * chairman — spec Notes → Decided 1). `forceDraft` pins `status: "draft"`
 * regardless of input (MCP `draft_voting`: activation stays UI-only).
 *
 * Throws McpError: forbidden, validation.title|startsAt|endsAt|items.
 * `validation.endsAt` carries `details.minEnd` (ISO date) for the per-rollam
 * minimum; `validation.items` carries the normaliser's message in
 * `details.raw` (server/UI use only — never put into a tool result).
 */
export async function createVoting(
  principal: Principal,
  input: CreateVotingInput,
  opts: { forceDraft?: boolean } = {}
) {
  assertBoard(principal);

  const { title, description, startsAt, endsAt, votingType, initiatedBy } = input;
  if (!title) throw validationError("title");
  if (!startsAt) throw validationError("startsAt");
  if (!endsAt) throw validationError("endsAt");

  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime())) throw validationError("startsAt");
  if (Number.isNaN(end.getTime())) throw validationError("endsAt");

  // Phase 9.2: country from the root entity; falls back to "sk" if no root.
  const root = await getCommunityRoot();
  const country = (root?.country ?? "sk") as Country;

  const resolvedVotingType = votingType || "written";
  if (resolvedVotingType === "written") {
    const minEnd = validatePerRollamDuration(country, start, end);
    if (minEnd) {
      throw validationError("endsAt", {
        reason: "per_rollam_min_duration",
        minEnd: minEnd.toISOString().split("T")[0],
      });
    }
  }

  // Scope: explicit entityId, legacy entranceId, or the root entity
  // (community-wide vote).
  const scopeEntityId =
    (typeof input.entityId === "string" && input.entityId) ||
    input.entranceId ||
    root?.id ||
    null;
  if (!scopeEntityId) throw new McpError("community_missing");

  // BYT-20260609-008: normalise ballot items (quorum lives per item).
  const normalized = normalizeItems(
    input as Parameters<typeof normalizeItems>[0],
    title,
    description || null
  );
  if ("error" in normalized) {
    throw validationError("items", { raw: normalized.error, itemIdx: normalized.itemIdx });
  }
  // BYT-20261117-002: only quorum types valid for the community's country
  // and the voting type (QUORUM_NOT_ALLOWED) — web and MCP alike.
  const quorumError = findDisallowedQuorum(normalized.items, country, resolvedVotingType);
  if (quorumError) throw validationError("items", { quorum: quorumError });
  // SK §14b ods. 6 repeated-vote escalation (code, never prose).
  const escalated = applyRepeatEscalation(normalized.items, country);
  if ("error" in escalated) throw validationError("items", { repeat: escalated });

  // BYT-20261118-002 §6: a voting is created as a draft or announced right
  // away; never created closed (that would skip the state machine).
  const status: "draft" | "active" =
    !opts.forceDraft && input.status === "active" ? "active" : "draft";
  const now = new Date();
  if (status === "active") {
    // Creating active = announcing now: same lead-time rule as activation.
    const noticeError = validateNotice({
      country,
      announcedAt: now,
      startsAt: start,
      endsAt: end,
      timeZone: timeZoneForCountry(country),
      rules: noticeRulesFor(root),
    });
    if (noticeError) throw validationError("startsAt", { notice: noticeError });
  }
  const place =
    typeof input.place === "string" && input.place.trim() ? input.place.trim().slice(0, 500) : null;

  const voting = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(votings)
      .values({
        title,
        description: description || null,
        status,
        votingType: resolvedVotingType,
        initiatedBy: initiatedBy || "board",
        startsAt: start,
        endsAt: end,
        createdById: principal.userId,
        entityId: scopeEntityId,
        documentProjectId: input.documentProjectId || null,
        place,
        announcedAt: status === "active" ? now : null,
      })
      .returning();

    if (status === "active") {
      await recordVotingEvent(tx, {
        votingId: created.id,
        kind: "announced",
        actorId: principal.userId,
      });
    }

    // BYT-20261118-001 §1: one meeting ↔ one voting ↔ one post. Only for an
    // announced (active) meeting voting with a place; a draft is announced
    // later from the voting detail ("Oznámiť schôdzu vlastníkom").
    if (
      input.announceMeeting === true &&
      status === "active" &&
      resolvedVotingType === "meeting" &&
      place
    ) {
      await createMeetingPost(tx, created, principal.userId);
    }

    await tx.insert(votingItems).values(
      escalated.items.map((it) => ({
        votingId: created.id,
        idx: it.idx,
        title: it.title,
        description: it.description,
        quorumType: it.quorumType,
        repeatOfQuorumType: it.repeatOfQuorumType,
        financialEffectKind: it.financialEffectKind,
        financialEffectParams: it.financialEffectParams,
      }))
    );

    return created;
  });

  // Created already announced: same push + e-mail fallback as the
  // "announce" transition (fire-and-forget, never throws).
  if (voting.status === "active") void notifyVotingStarted(voting);

  const items = await db
    .select()
    .from(votingItems)
    .where(eq(votingItems.votingId, voting.id))
    .orderBy(votingItems.idx);

  return { ...voting, items };
}
