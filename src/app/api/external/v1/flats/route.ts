import { NextRequest, NextResponse } from "next/server";
import { aliasedTable } from "drizzle-orm";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { entities, housingUnitData } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";

// Phase 9.1b: re-derived from entities + housing_unit_data so the v1
// flat shape (id / flatNumber / floor / share / area / entranceId /
// entranceName / createdAt) survives the schema cutover.
async function handler(_request: NextRequest) {
  const entrance = aliasedTable(entities, "entrance");

  const allFlats = await db
    .select({
      id: entities.id,
      flatNumber: housingUnitData.flatNumber,
      floor: housingUnitData.floor,
      shareNumerator: housingUnitData.shareNumerator,
      shareDenominator: housingUnitData.shareDenominator,
      area: housingUnitData.area,
      entranceId: entities.parentId,
      entranceName: entrance.name,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .innerJoin(housingUnitData, eq(housingUnitData.entityId, entities.id))
    .leftJoin(entrance, eq(entrance.id, entities.parentId))
    .where(
      and(
        eq(entities.kind, "housing_unit"),
        isNull(entities.archivedAt)
      )
    );

  return NextResponse.json(allFlats);
}

export const GET = withExternalAuth(handler, "read");
