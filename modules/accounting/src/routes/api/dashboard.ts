import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireReader } from "@modules/accounting/src/lib/api-guard";
import { getDashboardTiles } from "@modules/accounting/src/lib/dashboard";
import { postAllDueMonths } from "@modules/accounting/src/lib/fee-schedule-publish";

// Accounting dashboard API — whole-dom financial state, board roles only
// (owners get 403 and the landing page falls back to their own karta).

export async function handleGet(): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;

  // Tiles must reflect all due months (invariant 11 — derived, current).
  await db.transaction((tx) =>
    postAllDueMonths(tx, {
      entityId: ctx.root.id,
      country: ctx.root.country,
    })
  );

  const tiles = await getDashboardTiles(ctx.root.id, ctx.root.country);
  return NextResponse.json(tiles);
}
