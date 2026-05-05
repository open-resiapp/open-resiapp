import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, flats, userFlats, memberships } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { withExternalAuth } from "@/lib/external-auth";
import type { ValidatedApiKey } from "@/lib/api-keys";

async function handleGet(
  _request: NextRequest,
  _apiKey: ValidatedApiKey,
  context?: { params: Promise<Record<string, string>> }
) {
  const { id } = await context!.params;

  const [user] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Get flat assignments
  const ufRows = await db
    .select({
      flatId: userFlats.flatId,
      flatNumber: flats.flatNumber,
    })
    .from(userFlats)
    .innerJoin(flats, eq(userFlats.flatId, flats.id))
    .where(eq(userFlats.userId, user.id));

  return NextResponse.json({
    ...user,
    flats: ufRows,
  });
}

async function handlePatch(
  request: NextRequest,
  _apiKey: ValidatedApiKey,
  context?: { params: Promise<Record<string, string>> }
) {
  const { id } = await context!.params;
  const body = await request.json();
  const { name, phone, role, isActive, flatIds } = body;

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!existing) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name;
  if (phone !== undefined) updateData.phone = phone;
  if (role !== undefined) updateData.role = role;
  if (isActive !== undefined) updateData.isActive = isActive;

  if (Object.keys(updateData).length > 0) {
    await db.update(users).set(updateData).where(eq(users.id, id));
  }

  // Update flat assignments if provided
  if (flatIds !== undefined) {
    // Remove existing
    await db.delete(userFlats).where(eq(userFlats.userId, id));

    if (flatIds.length > 0) {
      await db.insert(userFlats).values(
        flatIds.map((fid: string) => ({
          userId: id,
          flatId: fid,
        }))
      );

      // Update primary flatId
      await db
        .update(users)
        .set({ flatId: flatIds[0] })
        .where(eq(users.id, id));
    }

    // Phase 4 dual-run: mirror to memberships (flat.id == entity.id).
    const [userRow] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    const userRole = userRow?.role as
      | typeof memberships.$inferInsert.role
      | undefined;

    await db.delete(memberships).where(eq(memberships.userId, id));
    if (flatIds.length > 0 && userRole) {
      await db.insert(memberships).values(
        flatIds.map((fid: string) => ({
          userId: id,
          entityId: fid,
          role: userRole,
          status: "active" as const,
        }))
      );
    }
  }

  // Return updated user
  const [updated] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id));

  return NextResponse.json(updated);
}

export const GET = withExternalAuth(handleGet, "read");
export const PATCH = withExternalAuth(handlePatch, "read_write");
