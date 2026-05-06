import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  users,
  memberships,
  entities,
  housingUnitData,
} from "@/db/schema";
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

  // Phase 9.1c: read flat assignments via memberships → housing_unit
  // entities → housing_unit_data.
  const ufRows = await db
    .select({
      flatId: entities.id,
      flatNumber: housingUnitData.flatNumber,
    })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .innerJoin(housingUnitData, eq(housingUnitData.entityId, entities.id))
    .where(
      and(
        eq(memberships.userId, user.id),
        eq(memberships.status, "active"),
        eq(entities.kind, "housing_unit"),
        isNull(entities.archivedAt)
      )
    );

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

  // Phase 9.1d: memberships are authoritative. Replace the user's
  // membership set with the new flat list.
  if (flatIds !== undefined) {
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
