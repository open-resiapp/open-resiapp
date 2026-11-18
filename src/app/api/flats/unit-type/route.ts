import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { isUnitType } from "@/lib/unit-type";
import type { UserRole } from "@/types";

const MAX_UNITS = 2000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bulk "Nastaviť typ priestorov": set `entities.data.unit_type` on several
 * units of the current community in one UPDATE. Body:
 * `{ unitIds: string[], unitType: "flat" | "non_residential" | "garage" | "other" }`.
 * Returns `{ updated }` or `{ error: <code> }` (UI maps codes to i18n).
 *
 * The unit type never changes voting weight (SK zák. 182/1993 §14(3): one
 * vote per flat and per non-residential unit) — display / filters only.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    unitIds?: unknown;
    unitType?: unknown;
  } | null;
  const unitType = body?.unitType;
  const unitIds = Array.isArray(body?.unitIds)
    ? [...new Set(body.unitIds.filter((id): id is string => typeof id === "string" && UUID_RE.test(id)))]
    : [];
  if (!isUnitType(unitType) || unitIds.length === 0 || unitIds.length > MAX_UNITS) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const root = await getCommunityRoot();
  if (!root) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const patch = JSON.stringify({ unit_type: unitType });
  const rows = await db
    .update(entities)
    .set({ data: sql`${entities.data} || ${patch}::jsonb` })
    .where(
      and(
        inArray(entities.id, unitIds),
        eq(entities.kind, "unit"),
        eq(entities.rootId, root.id),
        isNull(entities.archivedAt)
      )
    )
    .returning({ id: entities.id });

  return NextResponse.json({ updated: rows.length });
}
