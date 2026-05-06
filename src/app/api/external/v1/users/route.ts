import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import bcrypt from "bcrypt";

import { db } from "@/db";
import {
  users,
  memberships,
  entities,
  housingUnitData,
} from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import type { ValidatedApiKey } from "@/lib/api-keys";

async function handleGet(_request: NextRequest) {
  const allUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phone: users.phone,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users);

  if (allUsers.length === 0) {
    return NextResponse.json([]);
  }

  // Phase 9.1c: read flat assignments via memberships → housing_unit
  // entities → housing_unit_data.
  const userIds = allUsers.map((u) => u.id);
  const ufRows = await db
    .select({
      userId: memberships.userId,
      flatId: entities.id,
      flatNumber: housingUnitData.flatNumber,
    })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .innerJoin(housingUnitData, eq(housingUnitData.entityId, entities.id))
    .where(
      and(
        inArray(memberships.userId, userIds),
        eq(memberships.status, "active"),
        eq(entities.kind, "housing_unit"),
        isNull(entities.archivedAt)
      )
    );

  const flatsByUser = new Map<string, { flatId: string; flatNumber: string }[]>();
  for (const row of ufRows) {
    const list = flatsByUser.get(row.userId) || [];
    list.push({ flatId: row.flatId, flatNumber: row.flatNumber });
    flatsByUser.set(row.userId, list);
  }

  const result = allUsers.map((u) => ({
    ...u,
    flats: flatsByUser.get(u.id) || [],
  }));

  return NextResponse.json(result);
}

async function handlePost(request: NextRequest, _apiKey: ValidatedApiKey) {
  const body = await request.json();
  const { name, email, phone, role, password, flatIds } = body;

  if (!name || !email || !password) {
    return NextResponse.json(
      { error: "Missing required fields: name, email, password" },
      { status: 400 }
    );
  }

  // Check for existing email
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing) {
    return NextResponse.json(
      { error: "Email already exists" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const [newUser] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash,
      phone: phone || null,
      role: role || "owner",
    })
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    });

  // Phase 9.1d: only memberships — legacy userFlats write removed.
  if (flatIds && flatIds.length > 0) {
    const userRole = (role || "owner") as typeof memberships.$inferInsert.role;
    await db.insert(memberships).values(
      flatIds.map((fid: string) => ({
        userId: newUser.id,
        entityId: fid,
        role: userRole,
        status: "active" as const,
      }))
    );
  }

  return NextResponse.json(newUser, { status: 201 });
}

export const GET = withExternalAuth(handleGet, "read");
export const POST = withExternalAuth(handlePost, "read_write");
