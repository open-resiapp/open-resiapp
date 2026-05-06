import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, and, asc, eq, isNull } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { entities, housingUnitData } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { createEntity } from "@/lib/entity-tree";
import { recordEntityAudit } from "@/lib/entity-audit";
import { listUserFlats } from "@/lib/legacy-compat";
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

  // Phase 9.1d: list all housing_unit entities with their data + parent
  // entrance name. Replaces the legacy flats + entrances join.
  const entrance = aliasedTable(entities, "entrance");
  const result = await db
    .select({
      id: entities.id,
      flatNumber: housingUnitData.flatNumber,
      floor: housingUnitData.floor,
      area: housingUnitData.area,
      shareNumerator: housingUnitData.shareNumerator,
      shareDenominator: housingUnitData.shareDenominator,
      entranceId: entities.parentId,
      entranceName: entrance.name,
    })
    .from(entities)
    .innerJoin(housingUnitData, eq(housingUnitData.entityId, entities.id))
    .leftJoin(entrance, eq(entrance.id, entities.parentId))
    .where(
      and(eq(entities.kind, "housing_unit"), isNull(entities.archivedAt))
    )
    .orderBy(asc(entrance.name), asc(housingUnitData.flatNumber));

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

  // Phase 9.1d: create the housing_unit entity + housing_unit_data only.
  // Legacy flats table write removed; entity tree is canonical.
  const entity = await createEntity({
    parentId: entranceId,
    kind: "housing_unit",
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
