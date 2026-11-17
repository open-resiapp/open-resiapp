import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships } from "@/db/schema";

// BYT-20260511-001: housing units whose active memberships' sum of
// owner_unit_share_* does not equal 1/1. Shared by
// GET /api/admin/share-sum-invariants and the dashboard server layout.

export interface ShareSumViolation {
  unitEntityId: string;
  flatNumber: string;
  sumNumerator: string;
  sumDenominator: string;
}

export async function listShareSumViolations(): Promise<ShareSumViolation[]> {
  // Aggregate per unit the rational sum of owner_unit_share_*. Fetch raw
  // rows and reduce in JS (exact rational arithmetic with BigInt).
  //
  // Phase 2b: flat_number now comes from entities.data jsonb. The
  // membership share fields are still integer columns on the
  // memberships table — they're the source of truth for the invariant.
  const rows = await db
    .select({
      unitId: memberships.entityId,
      flatNumber: sql<string>`${entities.data}->>'flat_number'`,
      num: memberships.ownerUnitShareNumerator,
      den: memberships.ownerUnitShareDenominator,
    })
    .from(memberships)
    .innerJoin(entities, eq(entities.id, memberships.entityId))
    .where(
      and(
        eq(memberships.status, "active"),
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt)
      )
    );

  const byUnit = new Map<string, { flatNumber: string; num: bigint; den: bigint }>();
  for (const r of rows) {
    const cur = byUnit.get(r.unitId);
    if (!cur) {
      byUnit.set(r.unitId, {
        flatNumber: r.flatNumber,
        num: BigInt(r.num),
        den: BigInt(r.den),
      });
      continue;
    }
    // cur + (r.num/r.den) = (cur.num*r.den + r.num*cur.den) / (cur.den*r.den)
    const newNum = cur.num * BigInt(r.den) + BigInt(r.num) * cur.den;
    const newDen = cur.den * BigInt(r.den);
    cur.num = newNum;
    cur.den = newDen;
  }

  const invalid: ShareSumViolation[] = [];
  for (const [unitId, slot] of byUnit) {
    const g = gcd(slot.num < 0n ? -slot.num : slot.num, slot.den);
    const num = slot.num / g;
    const den = slot.den / g;
    if (num !== den) {
      invalid.push({
        unitEntityId: unitId,
        flatNumber: slot.flatNumber,
        sumNumerator: num.toString(),
        sumDenominator: den.toString(),
      });
    }
  }
  return invalid;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}
