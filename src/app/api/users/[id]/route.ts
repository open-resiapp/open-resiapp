import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, flats, entrances, userFlats } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { id } = await params;

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      flatId: users.flatId,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "Používateľ nenájdený" }, { status: 404 });
  }

  // Get all flats for this user from junction table
  const userFlatRows = await db
    .select({
      flatId: flats.id,
      flatNumber: flats.flatNumber,
      floor: flats.floor,
      entranceId: flats.entranceId,
      entranceName: entrances.name,
    })
    .from(userFlats)
    .innerJoin(flats, eq(userFlats.flatId, flats.id))
    .innerJoin(entrances, eq(flats.entranceId, entrances.id))
    .where(eq(userFlats.userId, id));

  // Backward-compat: single flat fields from first flat
  const firstFlat = userFlatRows[0] || null;

  return NextResponse.json({
    ...user,
    flats: userFlatRows,
    // Backward-compat fields
    flatNumber: firstFlat?.flatNumber || null,
    floor: firstFlat?.floor ?? null,
    entranceId: firstFlat?.entranceId || null,
    entranceName: firstFlat?.entranceName || null,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.name !== undefined) updateData.name = body.name;
  if (body.email !== undefined) updateData.email = body.email;
  if (body.phone !== undefined) updateData.phone = body.phone;
  if (body.role !== undefined) updateData.role = body.role;
  if (body.isActive !== undefined) updateData.isActive = body.isActive;

  // Handle flatIds array (new) or flatId (legacy)
  const hasFlatIds = body.flatIds !== undefined;
  const hasFlatId = body.flatId !== undefined;

  if (hasFlatIds || hasFlatId) {
    const resolvedFlatIds: string[] = hasFlatIds
      ? (body.flatIds || [])
      : body.flatId
        ? [body.flatId]
        : [];

    // Phase 1 compat: keep users.flatId in sync
    updateData.flatId = resolvedFlatIds[0] || null;

    // Update junction table: delete old, insert new
    await db.delete(userFlats).where(eq(userFlats.userId, id));
    if (resolvedFlatIds.length > 0) {
      await db.insert(userFlats).values(
        resolvedFlatIds.map((fid: string) => ({
          userId: id,
          flatId: fid,
        }))
      );
    }
  }

  if (Object.keys(updateData).length === 0 && !hasFlatIds && !hasFlatId) {
    return NextResponse.json({ error: "Žiadne údaje na aktualizáciu" }, { status: 400 });
  }

  // Check email uniqueness if changing email
  if (updateData.email) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, updateData.email as string))
      .limit(1);

    if (existing.length > 0 && existing[0].id !== id) {
      return NextResponse.json(
        { error: "Používateľ s týmto emailom už existuje" },
        { status: 400 }
      );
    }
  }

  let updated;
  if (Object.keys(updateData).length > 0) {
    [updated] = await db
      .update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        isActive: users.isActive,
        flatId: users.flatId,
      });
  } else {
    // Only flatIds changed, fetch user data
    [updated] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        isActive: users.isActive,
        flatId: users.flatId,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
  }

  if (!updated) {
    return NextResponse.json({ error: "Používateľ nenájdený" }, { status: 404 });
  }

  return NextResponse.json(updated);
}
