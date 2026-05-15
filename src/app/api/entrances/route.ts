import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { aliasedTable, and, eq, isNull, sql } from "drizzle-orm";

import { entities } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { createEntity } from "@/lib/entity-tree";
import { recordEntityAudit } from "@/lib/entity-audit";
import { getCommunityRoot } from "@/lib/legacy-compat";
import type { UserRole } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  // Phase 9.1d: list housing_entrance entities with their child
  // housing_unit count.
  const child = aliasedTable(entities, "child");
  const result = await db
    .select({
      id: entities.id,
      name: entities.name,
      streetNumber: sql<string | null>`NULL`,
      buildingId: entities.parentId,
      createdAt: entities.createdAt,
      flatCount: sql<number>`count(${child.id})::int`,
    })
    .from(entities)
    .leftJoin(
      child,
      and(
        eq(child.parentId, entities.id),
        eq(child.kind, "unit"),
        isNull(child.archivedAt)
      )
    )
    .where(
      and(eq(entities.kind, "entrance"), isNull(entities.archivedAt))
    )
    .groupBy(entities.id)
    .orderBy(entities.name);

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
  const { name, streetNumber } = body;

  if (!name) {
    return NextResponse.json({ error: "Názov je povinný" }, { status: 400 });
  }

  const bld = await getCommunityRoot();
  if (!bld) {
    return NextResponse.json({ error: "Budova nenájdená" }, { status: 404 });
  }

  // Phase 9.1d/e: create the housing_entrance entity. The legacy
  // entrances table write is gone — the entity tree is canonical.
  // streetNumber has no entity-side counterpart yet; if needed, a
  // housing_entrance_data extension table can ship later.
  const entity = await createEntity({
    parentId: bld.id,
    kind: "entrance",
    name,
  });
  recordEntityAudit({
    action: "entity.create",
    actorUserId: session.user.id,
    entityId: entity.id,
    after: {
      kind: entity.kind,
      name: entity.name,
      parentId: entity.parentId,
      streetNumber: streetNumber || null,
    },
  });

  return NextResponse.json(
    {
      id: entity.id,
      buildingId: entity.parentId,
      name: entity.name,
      streetNumber: streetNumber || null,
      createdAt: entity.createdAt,
    },
    { status: 201 }
  );
}
