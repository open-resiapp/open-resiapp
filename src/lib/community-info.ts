import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { boardMembers, entities, users } from "@/db/schema";

// Read-only community facts shared by the MCP `get_community_info` tool
// (BYT-20261117-001 §4 #2). Board list carries NO emails and only active
// members (the board-members route's gaps are filed separately).

export interface EntranceRow {
  id: string;
  name: string;
  unitCount: number;
}

/** Non-archived entrances under the community root, with unit counts. */
export async function listEntrances(rootId: string): Promise<EntranceRow[]> {
  return db
    .select({
      id: entities.id,
      name: entities.name,
      unitCount: sql<number>`(
        SELECT count(*)::int FROM ${entities} u
        WHERE u.parent_id = ${entities.id}
          AND u.kind = 'unit'
          AND u.archived_at IS NULL
      )`,
    })
    .from(entities)
    .where(
      and(
        eq(entities.kind, "entrance"),
        isNull(entities.archivedAt),
        sql`${entities.path} LIKE (SELECT path || '%' FROM ${entities} r WHERE r.id = ${rootId})`
      )
    )
    .orderBy(asc(entities.name));
}

export interface ActiveBoardMemberRow {
  role: string;
  name: string | null;
  electedAt: string | null;
  termEndsAt: string | null;
}

/** Active board members of the root — names + roles only, never emails. */
export async function listActiveBoardMembers(
  rootId: string
): Promise<ActiveBoardMemberRow[]> {
  const rows = await db
    .select({
      role: boardMembers.role,
      name: users.name,
      electedAt: boardMembers.electedAt,
      termEndsAt: boardMembers.termEndsAt,
    })
    .from(boardMembers)
    .leftJoin(users, eq(users.id, boardMembers.userId))
    .where(and(eq(boardMembers.entityId, rootId), eq(boardMembers.isActive, true)))
    .orderBy(asc(boardMembers.role));
  return rows.map((r) => ({
    role: r.role,
    name: r.name,
    electedAt: r.electedAt ? r.electedAt.toISOString() : null,
    termEndsAt: r.termEndsAt ? r.termEndsAt.toISOString() : null,
  }));
}

/** Does the user hold an active OWNER membership on any unit of the dom? */
export async function isDomOwnerOf(userId: string, rootId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(entities)
    .where(
      and(
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt),
        sql`${entities.path} LIKE (SELECT path || '%' FROM ${entities} r WHERE r.id = ${rootId})`,
        sql`EXISTS (
          SELECT 1 FROM memberships m
          WHERE m.entity_id = ${entities.id}
            AND m.user_id = ${userId}
            AND m.role IN ('owner', 'member')
            AND m.status = 'active'
        )`
      )
    )
    .limit(1);
  return !!row;
}
