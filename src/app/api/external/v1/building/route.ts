import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { entities } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { getCommunityRoot } from "@/lib/legacy-compat";

async function handler(_request: NextRequest) {
  const buildingInfo = await getCommunityRoot();
  if (!buildingInfo) {
    return NextResponse.json({ error: "Building not found" }, { status: 404 });
  }

  // Counts re-derived from entities so the response stays stable
  // across the Phase 9 cutover (legacy `entrances` / `flats` tables go
  // away, but the v1 contract — entranceCount / flatCount — survives).
  const [entranceCountRow] = await db
    .select({ c: count() })
    .from(entities)
    .where(
      and(
        eq(entities.parentId, buildingInfo.id),
        eq(entities.kind, "housing_entrance"),
        isNull(entities.archivedAt)
      )
    );
  const [flatCountRow] = await db
    .select({ c: count() })
    .from(entities)
    .where(
      and(
        eq(entities.kind, "housing_unit"),
        eq(entities.rootId, buildingInfo.id),
        isNull(entities.archivedAt)
      )
    );

  return NextResponse.json({
    id: buildingInfo.id,
    name: buildingInfo.name,
    address: buildingInfo.address,
    ico: buildingInfo.ico,
    votingMethod: buildingInfo.votingMethod,
    entranceCount: entranceCountRow.c,
    flatCount: flatCountRow.c,
    createdAt: buildingInfo.createdAt,
  });
}

export const GET = withExternalAuth(handler, "read");
