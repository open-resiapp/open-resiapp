import { NextRequest, NextResponse } from "next/server";
import { aliasedTable } from "drizzle-orm";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";

// Phase 2b: re-derived from entities (data jsonb) so the v1 flat shape
// (id / flatNumber / floor / share / area / entranceId / entranceName /
// createdAt) survives the housing_unit_data → entities.data cutover.
async function handler(_request: NextRequest) {
  const entrance = aliasedTable(entities, "entrance");

  const allFlats = await db
    .select({
      id: entities.id,
      flatNumber: sql<string>`${entities.data}->>'flat_number'`,
      floor: sql<number>`coalesce((${entities.data}->>'floor')::int, 0)`,
      shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
      area: sql<number | null>`(${entities.data}->>'area_m2')::numeric`,
      entranceId: entities.parentId,
      entranceName: entrance.name,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .leftJoin(entrance, eq(entrance.id, entities.parentId))
    .where(
      and(
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt)
      )
    );

  return NextResponse.json(allFlats);
}

export const GET = withExternalAuth(handler, "read");
