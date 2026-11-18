import "server-only";
// Ownership snapshot frozen on the ballot at cast time (legal fix 2026-11-18):
// a closed result must not change when ownership changes later, so the
// owner's unit share and membership weight are copied onto the ballot row.
// results.ts uses these values and falls back to the CURRENT membership only
// for legacy rows (NULL snapshot).
import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { memberships } from "@/db/schema";

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
        eq(memberships.status, "active")
      )
    )
    // Prefer the owner membership when a user holds several roles on the unit.
    .orderBy(desc(sql`(${memberships.role} = 'owner')`))
    .limit(1);
  return {
    ownerUnitShareNumerator: m?.num ?? null,
    ownerUnitShareDenominator: m?.den ?? null,
    membershipWeight: m?.weight ?? null,
  };
}
