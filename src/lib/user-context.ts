import "server-only";

import { and, asc, eq, gt, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { boardMembers, entities, memberships, users } from "@/db/schema";
import type { boardMemberRoleEnum } from "@/db/schema";
import type { MembershipRole } from "@/lib/legacy-compat";
import type { UserRole, UserStatus } from "@/types";

// Small per-user context reads (BYT-20261117-001 §3 / whoami). Shared by the
// MCP principal + whoami tool and any UI surface that needs the same facts,
// so the three authz models (flat users.role, board_members, memberships)
// are read in exactly one place each.

export type BoardRole = (typeof boardMemberRoleEnum.enumValues)[number];

export interface UserAuthRow {
  id: string;
  name: string;
  email: string | null;
  role: UserRole;
  status: UserStatus;
}

/** Live flat role + status (not the JWT copy). Null when the user is gone. */
export async function getUserAuthRow(userId: string): Promise<UserAuthRow | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      status: users.status,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return (row as UserAuthRow | undefined) ?? null;
}

/**
 * A board_members row grants authority only while it is in force: flagged
 * active AND its term has not ended (`termEndsAt` null = open-ended term).
 * The one definition of an "active board role" — used by
 * `listActiveBoardRoles` (Principal / shell / faults) and the accounting
 * `hasBoardRole`, so web, MCP and accounting agree.
 */
export function boardRoleInForce(now: Date = new Date()): SQL {
  return and(
    eq(boardMembers.isActive, true),
    or(isNull(boardMembers.termEndsAt), gt(boardMembers.termEndsAt, now))
  ) as SQL;
}

/** Board roles in force (`boardRoleInForce`) the user holds on `entityId` (the community root). */
export async function listActiveBoardRoles(
  userId: string,
  entityId: string
): Promise<BoardRole[]> {
  const rows = await db
    .select({ role: boardMembers.role })
    .from(boardMembers)
    .where(
      and(
        eq(boardMembers.userId, userId),
        eq(boardMembers.entityId, entityId),
        boardRoleInForce()
      )
    );
  return [...new Set(rows.map((r) => r.role))];
}

export interface UserMembershipRow {
  membershipId: string;
  entityId: string;
  entityName: string;
  entityKind: string;
  parentId: string | null;
  role: MembershipRole;
  flatNumber: string | null;
  ownerUnitShareNumerator: number;
  ownerUnitShareDenominator: number;
}

/** Every active membership of the user on a non-archived entity. */
export async function listUserMemberships(
  userId: string
): Promise<UserMembershipRow[]> {
  return db
    .select({
      membershipId: memberships.id,
      entityId: entities.id,
      entityName: entities.name,
      entityKind: entities.kind,
      parentId: entities.parentId,
      role: memberships.role,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      ownerUnitShareNumerator: memberships.ownerUnitShareNumerator,
      ownerUnitShareDenominator: memberships.ownerUnitShareDenominator,
    })
    .from(memberships)
    .innerJoin(entities, eq(entities.id, memberships.entityId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        isNull(entities.archivedAt)
      )
    )
    .orderBy(asc(entities.name));
}
