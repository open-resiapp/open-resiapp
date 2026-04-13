import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { boardMembers, building, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const [bld] = await db.select().from(building).limit(1);
  if (!bld) {
    return NextResponse.json({ members: [], governanceModel: "chairman_council" });
  }

  const members = await db
    .select({
      id: boardMembers.id,
      userId: boardMembers.userId,
      role: boardMembers.role,
      electedAt: boardMembers.electedAt,
      termEndsAt: boardMembers.termEndsAt,
      isActive: boardMembers.isActive,
      userName: users.name,
      userEmail: users.email,
    })
    .from(boardMembers)
    .leftJoin(users, eq(boardMembers.userId, users.id))
    .where(eq(boardMembers.buildingId, bld.id));

  return NextResponse.json({
    members,
    governanceModel: bld.governanceModel,
  });
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
  const { userId, role, electedAt, termEndsAt } = body;

  if (!userId || !role || !electedAt) {
    return NextResponse.json(
      { error: "userId, role a electedAt sú povinné" },
      { status: 400 }
    );
  }

  const [bld] = await db.select().from(building).limit(1);
  if (!bld) {
    return NextResponse.json({ error: "Budova neexistuje" }, { status: 400 });
  }

  const [member] = await db
    .insert(boardMembers)
    .values({
      buildingId: bld.id,
      userId,
      role,
      electedAt: new Date(electedAt),
      termEndsAt: termEndsAt ? new Date(termEndsAt) : null,
    })
    .returning();

  return NextResponse.json(member, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id je povinné" }, { status: 400 });
  }

  await db.delete(boardMembers).where(eq(boardMembers.id, id));

  return NextResponse.json({ success: true });
}
