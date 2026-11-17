import "server-only";

import { cache } from "react";
import { aliasedTable, and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { boardMembers, directoryEntries, entities, memberships, users } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { CommunityRootRow } from "@/lib/legacy-compat";
import {
  getRequestCommunityRoot,
  getRequestConsent,
  getRequestEnabledModules,
  listActiveBoardRoles,
  listOwnUnitIds,
} from "@/lib/shell.server";
import { getNavAudience, type NavAudience } from "@/lib/navigation";
import { ballots, votings } from "@modules/voting/src/db/schema";
import type { BoardMemberRole, UserRole, UserStatus } from "@/types";

// Server read models for Domov / Dom (BYT-20261117-002 Phase 4). All
// read-only, per request, no cross-request caching (multi-replica safe).
// `getViewer` is wrapped in React `cache` so several server components of
// one render share a single resolution.

export interface Viewer {
  userId: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  isAdmin: boolean;
  boardRoles: BoardMemberRole[];
  /** Unit ids with an active membership (any role) — same as ShellData.user.unitIds. */
  unitIds: string[];
  audience: NavAudience;
  root: CommunityRootRow | null;
  enabledModules: Set<string>;
  /** The layout shows <ConsentGate> instead of the page (same rule as ShellData.consent). */
  needsConsent: boolean;
}

/**
 * True when the layout does not render the page at all — pending users
 * (PendingShell, only /community-info) and users who must consent first
 * (ConsentGate). Data-loading pages return null early for these.
 */
export function isViewerGated(viewer: Viewer): boolean {
  return viewer.status !== "active" || viewer.needsConsent;
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;
  const { id: userId, name, role, status } = session.user;

  // Same request-cached slices the dashboard layout's shell resolves
  // (src/lib/shell.server.ts) — on a full page load these hit the cache
  // instead of repeating the queries; on a soft navigation (layout not
  // re-rendered) they run once here. 4 connections at most.
  const root = await getRequestCommunityRoot();
  const [enabled, boardRoles, unitIds, consent] = await Promise.all([
    getRequestEnabledModules(),
    root ? listActiveBoardRoles(userId, root.id) : Promise.resolve([] as BoardMemberRole[]),
    listOwnUnitIds(userId),
    getRequestConsent(userId, status === "active"),
  ]);

  const userRole = role as UserRole;
  return {
    userId,
    name: name ?? "",
    role: userRole,
    status: status as UserStatus,
    isAdmin: userRole === "admin",
    boardRoles,
    unitIds,
    audience: getNavAudience({ role: userRole, boardRoles }),
    root,
    enabledModules: new Set(enabled),
    needsConsent: consent.needsConsent,
  };
});

// ── Voting ─────────────────────────────────────────────

/** Open right now: status active and inside [startsAt, endsAt). */
const openNow = () =>
  and(
    eq(votings.status, "active"),
    sql`${votings.startsAt} <= now()`,
    sql`${votings.endsAt} > now()`
  );

export interface OwnerOpenVoting {
  id: string;
  title: string;
  /** ISO timestamp. */
  endsAt: string;
  /** Units of the viewer inside the voting's scope. */
  unitCount: number;
  /** True once the viewer has a ballot for every one of those units. */
  voted: boolean;
}

/**
 * Votings open now in which at least one of `unitIds` lies inside the
 * voting's scope subtree (unit path under the voting entity path), with
 * the viewer's own ballot state per unit.
 */
export async function listOpenVotingsForUnits(
  userId: string,
  unitIds: string[]
): Promise<OwnerOpenVoting[]> {
  if (unitIds.length === 0) return [];
  const ve = aliasedTable(entities, "ve");
  const ue = aliasedTable(entities, "ue");
  const rows = await db
    .select({
      id: votings.id,
      title: votings.title,
      endsAt: votings.endsAt,
      unitId: ue.id,
    })
    .from(votings)
    .innerJoin(ve, eq(ve.id, votings.entityId))
    .innerJoin(
      ue,
      and(inArray(ue.id, unitIds), sql`${ue.path} LIKE ${ve.path} || '%'`)
    )
    .where(openNow())
    .orderBy(votings.endsAt);
  if (rows.length === 0) return [];

  const votingIds = [...new Set(rows.map((r) => r.id))];
  const own = await db
    .select({ votingId: ballots.votingId, unitId: ballots.entityId })
    .from(ballots)
    .where(and(inArray(ballots.votingId, votingIds), eq(ballots.ownerId, userId)));
  const votedKeys = new Set(own.map((b) => `${b.votingId}:${b.unitId}`));

  const byVoting = new Map<string, OwnerOpenVoting>();
  for (const r of rows) {
    const v = byVoting.get(r.id) ?? {
      id: r.id,
      title: r.title,
      endsAt: r.endsAt.toISOString(),
      unitCount: 0,
      voted: true,
    };
    v.unitCount += 1;
    if (!votedKeys.has(`${r.id}:${r.unitId}`)) v.voted = false;
    byVoting.set(r.id, v);
  }
  return [...byVoting.values()];
}

export interface RunningVotingTurnout {
  id: string;
  title: string;
  endsAt: string;
  /** Distinct units with at least one ballot. */
  votedUnits: number;
  /** Live units in the voting's scope subtree. */
  totalUnits: number;
}

/**
 * Votings open now with unit turnout. Visibility rule of GET /api/votings
 * (path overlap with an active membership); admin sees all.
 */
export async function listRunningVotingsWithTurnout(
  userId: string,
  isAdmin: boolean
): Promise<RunningVotingTurnout[]> {
  const ve = aliasedTable(entities, "ve");
  const visible = isAdmin
    ? sql`true`
    : sql`EXISTS (
        SELECT 1
        FROM ${memberships} m
        JOIN ${entities} me ON me.id = m.entity_id
        WHERE m.user_id = ${userId}
          AND m.status = 'active'
          AND (${ve.path} LIKE me.path || '%' OR me.path LIKE ${ve.path} || '%')
      )`;
  const rows = await db
    .select({
      id: votings.id,
      title: votings.title,
      endsAt: votings.endsAt,
      votedUnits: sql<number>`(
        SELECT count(DISTINCT b.entity_id)::int
        FROM ${ballots} b
        WHERE b.voting_id = ${votings.id}
      )`,
      totalUnits: sql<number>`(
        SELECT count(*)::int
        FROM ${entities} u
        WHERE u.kind = 'unit'
          AND u.archived_at IS NULL
          AND u.path LIKE ${ve.path} || '%'
      )`,
    })
    .from(votings)
    .innerJoin(ve, eq(ve.id, votings.entityId))
    .where(and(openNow(), visible))
    .orderBy(votings.endsAt);
  return rows.map((r) => ({ ...r, endsAt: r.endsAt.toISOString() }));
}

// ── People ─────────────────────────────────────────────

export interface BoardContact {
  id: string;
  name: string;
  role: BoardMemberRole;
  email: string | null;
  /** Only when the member shares the phone in the neighbours directory. */
  phone: string | null;
}

/**
 * Active board members of the community with contact details. E-mail is
 * already exposed to every signed-in user by GET /api/board-members; the
 * phone number only when the member opted in to share it in the directory.
 */
export async function listBoardContacts(rootId: string): Promise<BoardContact[]> {
  const rows = await db
    .select({
      id: boardMembers.id,
      role: boardMembers.role,
      name: users.name,
      email: users.email,
      phone: users.phone,
      sharePhone: directoryEntries.sharePhone,
    })
    .from(boardMembers)
    .innerJoin(users, eq(boardMembers.userId, users.id))
    .leftJoin(directoryEntries, eq(directoryEntries.userId, users.id))
    .where(and(eq(boardMembers.entityId, rootId), eq(boardMembers.isActive, true)))
    .orderBy(users.name);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    email: r.email,
    phone: r.sharePhone ? r.phone : null,
  }));
}

/** Same population as the shell's nav badge / GET /api/registrations/pending (request-cached, shared with the shell). */
export { countPendingRegistrations } from "@/lib/shell.server";

/** An optional home block failing must not 500 the page — it just disappears. */
export async function soft<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.error("[home] block failed", err);
    return fallback;
  }
}
