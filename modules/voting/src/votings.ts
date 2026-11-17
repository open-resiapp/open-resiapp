import "server-only";

import { aliasedTable, and, desc, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { users, entities, memberships } from "@/db/schema";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { assertBoard } from "@/lib/mcp/authz";
import { McpError, validationError } from "@/lib/mcp/errors";
import type { Principal, Viewer } from "@/lib/mcp/principal";
import type { Country } from "@/types";
import { votings, votingItems } from "./db/schema";
import { validatePerRollamDuration } from "./rules";
import { normalizeItems } from "./items";
import { findDisallowedQuorum } from "./quorum-guard.server";

// Votings list / detail / create — shared by /api/votings(/[id]) and the
// MCP voting tools (BYT-20261117-001 §3).

/**
 * Visibility rule (RES-20260501-002): a user sees voting V iff they hold an
 * active membership whose entity overlaps V.entity along the path (ancestor
 * / equal / descendant). Admin bypasses it.
 */
function visibleToViewer(viewer: Viewer): SQL | undefined {
  if (viewer.role === "admin") return undefined;
  return sql`EXISTS (
    SELECT 1
    FROM ${memberships} m
    JOIN ${entities} me ON me.id = m.entity_id
    JOIN ${entities} ve ON ve.id = ${votings.entityId}
    WHERE m.user_id = ${viewer.userId}
      AND m.status = 'active'
      AND (ve.path LIKE me.path || '%' OR me.path LIKE ve.path || '%')
  )`;
}

/** Votings visible to the viewer, newest first (drafts included — as the route always did). */
export async function listVisibleVotings(viewer: Viewer) {
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

  const filter = visibleToViewer(viewer);
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

export type VotingDetail = NonNullable<Awaited<ReturnType<typeof getVotingDetail>>>;

/**
 * Voting + ordered items by id, WITHOUT a visibility check — the
 * GET /api/votings/[id] route's existing behaviour (spec Notes → found gaps).
 * MCP tools must use `getVisibleVotingDetail`.
 */
export async function getVotingDetail(votingId: string) {
  return loadVotingDetail(eq(votings.id, votingId));
}

/** Voting detail with the visibility rule applied; invisible = null. */
export async function getVisibleVotingDetail(viewer: Viewer, votingId: string) {
  const filter = visibleToViewer(viewer);
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
  /** Raw ballot items as sent by clients — normalised by `normalizeItems`. */
  items?: unknown;
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
    throw validationError("items", { raw: normalized.error });
  }
  // BYT-20261117-002: only quorum types valid for the community's country
  // and the voting type (QUORUM_NOT_ALLOWED) — web and MCP alike.
  const quorumError = findDisallowedQuorum(normalized.items, country, resolvedVotingType);
  if (quorumError) throw validationError("items", { quorum: quorumError });

  const status = opts.forceDraft ? "draft" : input.status || "draft";

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
      })
      .returning();

    await tx.insert(votingItems).values(
      normalized.items.map((it) => ({
        votingId: created.id,
        idx: it.idx,
        title: it.title,
        description: it.description,
        quorumType: it.quorumType,
        financialEffectKind: it.financialEffectKind,
        financialEffectParams: it.financialEffectParams,
      }))
    );

    return created;
  });

  const items = await db
    .select()
    .from(votingItems)
    .where(eq(votingItems.votingId, voting.id))
    .orderBy(votingItems.idx);

  return { ...voting, items };
}
