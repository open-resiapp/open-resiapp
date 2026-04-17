import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { directoryEntries, users, flats, entrances } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "viewDirectory")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const rows = await db
    .select({
      id: directoryEntries.id,
      userId: directoryEntries.userId,
      sharePhone: directoryEntries.sharePhone,
      shareEmail: directoryEntries.shareEmail,
      note: directoryEntries.note,
      skills: directoryEntries.skills,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
      },
      flat: {
        id: flats.id,
        flatNumber: flats.flatNumber,
      },
      entrance: {
        id: entrances.id,
        name: entrances.name,
      },
    })
    .from(directoryEntries)
    .innerJoin(users, eq(directoryEntries.userId, users.id))
    .leftJoin(flats, eq(users.flatId, flats.id))
    .leftJoin(entrances, eq(flats.entranceId, entrances.id))
    .orderBy(users.name);

  const result = rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.user.name,
    phone: r.sharePhone ? r.user.phone : null,
    email: r.shareEmail ? r.user.email : null,
    note: r.note,
    skills: r.skills,
    sharePhone: r.sharePhone,
    shareEmail: r.shareEmail,
    flatNumber: r.flat?.flatNumber ?? null,
    entranceName: r.entrance?.name ?? null,
  }));

  return NextResponse.json(result);
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "editOwnDirectory")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json();
  const {
    sharePhone = false,
    shareEmail = false,
    note = null,
    skills = null,
  } = body as {
    sharePhone?: boolean;
    shareEmail?: boolean;
    note?: string | null;
    skills?: string | null;
  };

  const [existing] = await db
    .select()
    .from(directoryEntries)
    .where(eq(directoryEntries.userId, session.user.id))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(directoryEntries)
      .set({
        sharePhone,
        shareEmail,
        note: note || null,
        skills: skills || null,
        updatedAt: new Date(),
      })
      .where(eq(directoryEntries.id, existing.id))
      .returning();
    return NextResponse.json(updated);
  }

  const [created] = await db
    .insert(directoryEntries)
    .values({
      userId: session.user.id,
      sharePhone,
      shareEmail,
      note: note || null,
      skills: skills || null,
    })
    .returning();
  return NextResponse.json(created, { status: 201 });
}

export async function DELETE() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  await db
    .delete(directoryEntries)
    .where(eq(directoryEntries.userId, session.user.id));

  return NextResponse.json({ ok: true });
}
