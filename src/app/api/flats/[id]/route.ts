import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { entities, memberships } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { archiveEntity, setParent } from "@/lib/entity-tree";
import { recordEntityAudit } from "@/lib/entity-audit";
import { unitDataPatch } from "@/lib/db/entity-data";
import type { UserRole } from "@/types";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { flatNumber, floor, area, shareNumerator, shareDenominator, entranceId } = body;

  // Phase 8a: dual-write removed — entities.data is the only target.
  if (flatNumber !== undefined) {
    await db
      .update(entities)
      .set({ name: flatNumber })
      .where(and(eq(entities.id, id), eq(entities.kind, "unit")));
  }
  const dataPatch = unitDataPatch({
    flatNumber,
    floor,
    shareNumerator,
    shareDenominator,
    area,
  });
  if (Object.keys(dataPatch).length > 0) {
    await db
      .update(entities)
      .set({
        data: sql`${entities.data} || ${JSON.stringify(dataPatch)}::jsonb`,
      })
      .where(eq(entities.id, id));
  }
  if (entranceId !== undefined) {
    await setParent(id, entranceId);
    recordEntityAudit({
      action: "entity.set_parent",
      actorUserId: session.user.id,
      entityId: id,
      after: { parentId: entranceId },
    });
  }

  const [updated] = await db
    .select({
      id: entities.id,
      entranceId: entities.parentId,
      flatNumber: sql<string>`${entities.data}->>'flat_number'`,
      floor: sql<number>`coalesce((${entities.data}->>'floor')::int, 0)`,
      area: sql<number | null>`(${entities.data}->>'area_m2')::numeric`,
      shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .where(and(eq(entities.id, id), eq(entities.kind, "unit")))
    .limit(1);

  if (!updated) {
    return NextResponse.json({ error: "Byt nenájdený" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;

  // Phase 9.1d: pre-check via memberships (authoritative).
  const flatUsers = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(eq(memberships.entityId, id), eq(memberships.status, "active"))
    )
    .limit(1);

  if (flatUsers.length > 0) {
    return NextResponse.json(
      { error: "Nemožno zmazať byt s priradenými používateľmi. Najprv odpojte používateľov." },
      { status: 400 }
    );
  }

  await archiveEntity(id);
  recordEntityAudit({
    action: "entity.archive",
    actorUserId: session.user.id,
    entityId: id,
  });

  return NextResponse.json({ success: true });
}
