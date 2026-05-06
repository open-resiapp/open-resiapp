import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, and, eq, isNull } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  directoryEntries,
  users,
  entities,
  housingUnitData,
  memberships,
} from "@/db/schema";
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

  // Phase 9.1d: directory entries are user-level. The flat / entrance
  // shown beside each entry comes from the user's first active
  // housing_unit membership (entity tree), not the legacy users.flatId.
  const flat = aliasedTable(entities, "flat");
  const entrance = aliasedTable(entities, "entrance");
  const baseRows = await db
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
    })
    .from(directoryEntries)
    .innerJoin(users, eq(directoryEntries.userId, users.id))
    .orderBy(users.name);

  // Resolve a representative flat/entrance per directory entry. We do
  // this in a follow-up query rather than a 4-way join so the directory
  // listing keeps one row per user even when they hold multiple flats.
  const userIds = baseRows.map((r) => r.userId);
  type FlatRow = {
    userId: string;
    flatId: string;
    flatNumber: string;
    entranceId: string | null;
    entranceName: string | null;
  };
  const flatRows: FlatRow[] = userIds.length
    ? await db
        .select({
          userId: memberships.userId,
          flatId: flat.id,
          flatNumber: housingUnitData.flatNumber,
          entranceId: entrance.id,
          entranceName: entrance.name,
        })
        .from(memberships)
        .innerJoin(flat, eq(memberships.entityId, flat.id))
        .innerJoin(housingUnitData, eq(housingUnitData.entityId, flat.id))
        .leftJoin(entrance, eq(entrance.id, flat.parentId))
        .where(
          and(
            eq(memberships.status, "active"),
            eq(flat.kind, "housing_unit"),
            isNull(flat.archivedAt)
          )
        )
    : [];

  const flatByUser = new Map<
    string,
    { flatId: string; flatNumber: string; entranceId: string | null; entranceName: string | null }
  >();
  for (const r of flatRows) {
    if (!flatByUser.has(r.userId)) {
      flatByUser.set(r.userId, {
        flatId: r.flatId,
        flatNumber: r.flatNumber,
        entranceId: r.entranceId,
        entranceName: r.entranceName,
      });
    }
  }

  const rows = baseRows.map((r) => ({
    ...r,
    flat: flatByUser.get(r.userId) ?? null,
    entrance: (() => {
      const fb = flatByUser.get(r.userId);
      return fb && fb.entranceId
        ? { id: fb.entranceId, name: fb.entranceName }
        : null;
    })(),
  }));

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
