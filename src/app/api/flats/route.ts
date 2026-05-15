import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, and, asc, eq, isNull, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { entities, housingUnitData } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { createEntity } from "@/lib/entity-tree";
import { recordEntityAudit } from "@/lib/entity-audit";
import { listUserFlats } from "@/lib/legacy-compat";
import { unitDataPatch } from "@/lib/db/entity-data";
import type { UserRole } from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  // Phase 9.1c: if userId is provided, return the user's flats via
  // memberships → housing_unit entities.
  if (userId) {
    const userFlatRows = await listUserFlats(userId);
    return NextResponse.json(
      userFlatRows.map((r) => ({
        flatId: r.flatId,
        flatNumber: r.flatNumber,
        floor: r.floor,
        entranceName: r.entranceName,
      }))
    );
  }

  // Phase 2b: list all unit entities with their data + parent entrance
  // name from entities.data jsonb. Replaces the housingUnitData join.
  const entrance = aliasedTable(entities, "entrance");
  const flatNumberExpr = sql<string>`${entities.data}->>'flat_number'`;
  const result = await db
    .select({
      id: entities.id,
      flatNumber: flatNumberExpr,
      floor: sql<number>`coalesce((${entities.data}->>'floor')::int, 0)`,
      area: sql<number | null>`(${entities.data}->>'area_m2')::numeric`,
      shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
      entranceId: entities.parentId,
      entranceName: entrance.name,
    })
    .from(entities)
    .leftJoin(entrance, eq(entrance.id, entities.parentId))
    .where(
      and(eq(entities.kind, "unit"), isNull(entities.archivedAt))
    )
    .orderBy(asc(entrance.name), asc(flatNumberExpr));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json();
  const { entranceId, flatNumber, floor, area, shareNumerator, shareDenominator } = body;

  if (!entranceId || !flatNumber || shareNumerator === undefined || shareDenominator === undefined) {
    return NextResponse.json(
      { error: "Vchod, číslo bytu, podiel čitateľ a menovateľ sú povinné" },
      { status: 400 }
    );
  }

  // Phase 2b dual-write: create the unit entity, insert legacy
  // housing_unit_data row, AND mirror the same fields into
  // entities.data jsonb so read paths see fresh values immediately.
  const entity = await createEntity({
    parentId: entranceId,
    kind: "unit",
    name: flatNumber,
  });
  recordEntityAudit({
    action: "entity.create",
    actorUserId: session.user.id,
    entityId: entity.id,
    after: {
      kind: entity.kind,
      name: entity.name,
      parentId: entity.parentId,
      shareNumerator,
      shareDenominator,
    },
  });

  await db.insert(housingUnitData).values({
    entityId: entity.id,
    flatNumber,
    floor: floor ?? 0,
    shareNumerator,
    shareDenominator,
    area: area ?? null,
  });
  const dataPatch = unitDataPatch({
    flatNumber,
    floor: floor ?? 0,
    shareNumerator,
    shareDenominator,
    area: area ?? null,
  });
  await db
    .update(entities)
    .set({
      data: sql`${entities.data} || ${JSON.stringify(dataPatch)}::jsonb`,
    })
    .where(eq(entities.id, entity.id));

  return NextResponse.json(
    {
      id: entity.id,
      entranceId: entity.parentId,
      flatNumber,
      floor: floor ?? 0,
      area: area ?? null,
      shareNumerator,
      shareDenominator,
      createdAt: entity.createdAt,
    },
    { status: 201 }
  );
}
