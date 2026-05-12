import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  entities,
  housingUnitData,
  memberships,
} from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

/**
 * Admin-only: list housing_unit entities whose active memberships' sum of
 * owner_unit_share_* does not equal 1/1.
 *
 * Used by the dashboard banner introduced with BYT-20260511-001 to flag
 * communities entered before the share invariant was enforced (or units
 * mid-edit). Result is empty when every unit is consistent.
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Aggregate per unit the rational sum of owner_unit_share_*.
  // We compare exactly using SUM over a common denominator: the LCM of
  // denominators is overkill — checking that
  //   SUM(num * (cross_product_of_other_denoms))  ==  PRODUCT(denoms) * 1
  // is too involved in SQL. Instead, fetch raw rows and reduce in JS.
  const rows = await db
    .select({
      unitId: housingUnitData.entityId,
      flatNumber: housingUnitData.flatNumber,
      num: memberships.ownerUnitShareNumerator,
      den: memberships.ownerUnitShareDenominator,
    })
    .from(memberships)
    .innerJoin(housingUnitData, eq(housingUnitData.entityId, memberships.entityId))
    .innerJoin(entities, eq(entities.id, memberships.entityId))
    .where(
      and(
        eq(memberships.status, "active"),
        eq(entities.kind, "housing_unit"),
        isNull(entities.archivedAt)
      )
    );

  const byUnit = new Map<
    string,
    { flatNumber: string; num: bigint; den: bigint }
  >();
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

  const invalid: Array<{
    unitEntityId: string;
    flatNumber: string;
    sumNumerator: string;
    sumDenominator: string;
  }> = [];
  for (const [unitId, slot] of byUnit) {
    // Reduce.
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
  // Suppress an unused-import warning while the file is still small.
  void sql;
  return NextResponse.json({ invalid });
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}
