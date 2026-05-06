import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, and, eq, inArray, isNull } from "drizzle-orm";
import bcrypt from "bcrypt";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  users,
  memberships,
  entities,
  housingUnitData,
} from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const roleFilter = searchParams.get("role");

  // Get all users
  const allUsers = await db
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
    .where(roleFilter ? eq(users.role, roleFilter as UserRole) : undefined);

  if (allUsers.length === 0) {
    return NextResponse.json([]);
  }

  // Phase 9.1c: read flat assignments via memberships → housing_unit
  // entities → housing_unit_data. Drops the legacy userFlats join.
  const userIds = allUsers.map((u) => u.id);
  const entrance = aliasedTable(entities, "entrance");
  type UfRow = {
    userId: string;
    flatId: string;
    flatNumber: string;
    entranceName: string | null;
  };
  const ufRows: UfRow[] = await db
    .select({
      userId: memberships.userId,
      flatId: entities.id,
      flatNumber: housingUnitData.flatNumber,
      entranceName: entrance.name,
    })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .innerJoin(housingUnitData, eq(housingUnitData.entityId, entities.id))
    .leftJoin(entrance, eq(entrance.id, entities.parentId))
    .where(
      and(
        inArray(memberships.userId, userIds),
        eq(memberships.status, "active"),
        eq(entities.kind, "housing_unit"),
        isNull(entities.archivedAt)
      )
    );

  // Build map: userId → flat numbers
  const userFlatsMap = new Map<string, string[]>();
  for (const row of ufRows) {
    const list = userFlatsMap.get(row.userId) || [];
    list.push(row.flatNumber);
    userFlatsMap.set(row.userId, list);
  }

  const result = allUsers.map((u) => ({
    ...u,
    flatNumber: userFlatsMap.get(u.id)?.join(", ") || null,
  }));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json();
  const { name, email, password, phone, role, flatId, flatIds } = body;

  if (!name || !email || !password) {
    return NextResponse.json(
      { error: "Meno, email a heslo sú povinné" },
      { status: 400 }
    );
  }

  // Check for existing email
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "Používateľ s týmto emailom už existuje" },
      { status: 400 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  // Resolve flat IDs: prefer flatIds array, fall back to single flatId
  const resolvedFlatIds: string[] = flatIds?.length
    ? flatIds
    : flatId
      ? [flatId]
      : [];

  const [user] = await db
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
    });

  // Phase 9.1d: only memberships — legacy userFlats write removed.
  if (resolvedFlatIds.length > 0) {
    const userRole = (role || "owner") as typeof memberships.$inferInsert.role;
    await db
      .insert(memberships)
      .values(
        resolvedFlatIds.map((fid) => ({
          userId: user.id,
          entityId: fid,
          role: userRole,
          status: "active" as const,
        }))
      )
      .onConflictDoNothing({
        target: [memberships.userId, memberships.entityId],
      });
  }

  return NextResponse.json(user, { status: 201 });
}
