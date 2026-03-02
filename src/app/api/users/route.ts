import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, flats, entrances, userFlats } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import bcrypt from "bcrypt";
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

  // Get all userFlats with flat + entrance info
  const userIds = allUsers.map((u) => u.id);
  const ufRows = await db
    .select({
      userId: userFlats.userId,
      flatId: flats.id,
      flatNumber: flats.flatNumber,
      entranceName: entrances.name,
    })
    .from(userFlats)
    .innerJoin(flats, eq(userFlats.flatId, flats.id))
    .innerJoin(entrances, eq(flats.entranceId, entrances.id))
    .where(inArray(userFlats.userId, userIds));

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
      flatId: resolvedFlatIds[0] || null, // Phase 1 compat
    })
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    });

  // Insert junction rows
  if (resolvedFlatIds.length > 0) {
    await db.insert(userFlats).values(
      resolvedFlatIds.map((fid) => ({
        userId: user.id,
        flatId: fid,
      }))
    );
  }

  return NextResponse.json(user, { status: 201 });
}
