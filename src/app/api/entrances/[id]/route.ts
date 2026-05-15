import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { archiveEntity } from "@/lib/entity-tree";
import { recordEntityAudit } from "@/lib/entity-audit";
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
  const { name } = body;

  // Phase 9.1d: entrance is now the housing_entrance entity. street_number
  // has no entity-side counterpart yet — silently ignored if the client
  // still sends it.
  const updateData: Partial<typeof entities.$inferInsert> = {};
  if (name !== undefined) updateData.name = name;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "Žiadne údaje na aktualizáciu" }, { status: 400 });
  }

  const [updated] = await db
    .update(entities)
    .set(updateData)
    .where(and(eq(entities.id, id), eq(entities.kind, "entrance")))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Vchod nenájdený" }, { status: 404 });
  }

  return NextResponse.json({
    id: updated.id,
    buildingId: updated.parentId,
    name: updated.name,
    createdAt: updated.createdAt,
  });
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

  // Check if entrance has child housing_unit entities (= flats).
  const child = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.parentId, id),
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt)
      )
    )
    .limit(1);

  if (child.length > 0) {
    return NextResponse.json(
      { error: "Nemožno zmazať vchod s bytmi. Najprv zmažte byty." },
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
