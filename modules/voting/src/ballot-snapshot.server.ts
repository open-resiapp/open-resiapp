import "server-only";
// Ownership snapshot frozen on the ballot at cast time (legal fix 2026-11-18):
// a closed result must not change when ownership changes later, so the
// owner's unit share and membership weight are copied onto the ballot row.
// results.ts uses these values and falls back to the CURRENT membership only
// for legacy rows (NULL snapshot).
import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { memberships } from "@/db/schema";
import { VOTING_ROLES } from "./voting-roles";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OwnershipSnapshot {
  ownerUnitShareNumerator: number | null;
  ownerUnitShareDenominator: number | null;
  membershipWeight: number | null;
}

export async function ownershipSnapshot(
  exec: Tx | typeof db,
  unitId: string,
  ownerId: string
): Promise<OwnershipSnapshot> {
  const [m] = await exec
    .select({
      num: memberships.ownerUnitShareNumerator,
      den: memberships.ownerUnitShareDenominator,
      weight: memberships.weight,
    })
    .from(memberships)
    .where(
      and(
        eq(memberships.entityId, unitId),
        eq(memberships.userId, ownerId),
        eq(memberships.status, "active"),
        // 2026-11-18 review: only a VOTING membership (owner / družstvo
        // member, voting-roles.ts) votes — validateCast enforces the same; a
        // tenant row must never feed the snapshot.
        inArray(memberships.role, [...VOTING_ROLES])
      )
    )
    .limit(1);
  return {
    ownerUnitShareNumerator: m?.num ?? null,
    ownerUnitShareDenominator: m?.den ?? null,
    membershipWeight: m?.weight ?? null,
  };
}
