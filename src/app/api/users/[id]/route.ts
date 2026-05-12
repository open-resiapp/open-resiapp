import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  users,
  posts,
  documents,
  memberships,
} from "@/db/schema";
import { votes, mandates, votings } from "@modules/voting/src/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { listUserFlats } from "@/lib/legacy-compat";
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
      passwordHash: users.passwordHash,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "Používateľ nenájdený" }, { status: 404 });
  }

  const isShell = user.passwordHash === null;

  // Phase 9.1c: read user's flats via memberships → housing_unit
  // entities → housing_unit_data + parent (entrance) entity.
  const userFlatRows = await listUserFlats(id);

  // Backward-compat: single flat fields from first flat
  const firstFlat = userFlatRows[0] || null;

  // passwordHash is internal — strip before returning.
  const { passwordHash: _ignored, ...safeUser } = user;
  void _ignored;

  return NextResponse.json({
    ...safeUser,
    isShell,
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

    // Phase 9.1d: memberships are the single source of truth.
    // Resolve membership role from the new role (if updating) or the
    // existing user's role.
    const resolvedRole = (updateData.role ??
      (
        await db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, id))
          .limit(1)
      )[0]?.role) as typeof memberships.$inferInsert.role | undefined;

    // Drop existing housing-unit memberships for this user that are
    // not in the new set; insert any missing.
    const existingMemberships = await db
      .select({ entityId: memberships.entityId })
      .from(memberships)
      .where(eq(memberships.userId, id));

    const wantSet = new Set(resolvedFlatIds);
    const haveSet = new Set(existingMemberships.map((m) => m.entityId));

    const toRemove = [...haveSet].filter((eid) => !wantSet.has(eid));
    const toAdd = [...wantSet].filter((eid) => !haveSet.has(eid));

    if (toRemove.length > 0) {
      await db
        .delete(memberships)
        .where(
          and(
            eq(memberships.userId, id),
            inArray(memberships.entityId, toRemove)
          )
        );
    }
    if (toAdd.length > 0 && resolvedRole) {
      await db.insert(memberships).values(
        toAdd.map((eid) => ({
          userId: id,
          entityId: eid,
          role: resolvedRole,
          status: "active" as const,
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

export async function DELETE(
  _request: NextRequest,
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

  // Prevent self-deletion
  if (session.user.id === id) {
    return NextResponse.json(
      { error: "Nemôžete zmazať vlastný účet" },
      { status: 400 }
    );
  }

  // Check user exists
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) {
    return NextResponse.json({ error: "Používateľ nenájdený" }, { status: 404 });
  }

  // Check for related records
  const [hasVotes] = await db
    .select({ id: votes.id })
    .from(votes)
    .where(eq(votes.ownerId, id))
    .limit(1);

  const [hasPosts] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.authorId, id))
    .limit(1);

  const [hasDocuments] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.uploadedById, id))
    .limit(1);

  const [hasMandates] = await db
    .select({ id: mandates.id })
    .from(mandates)
    .where(or(eq(mandates.fromOwnerId, id), eq(mandates.toOwnerId, id)))
    .limit(1);

  const [hasVotings] = await db
    .select({ id: votings.id })
    .from(votings)
    .where(or(eq(votings.createdById, id), eq(votings.voteCounterId, id)))
    .limit(1);

  if (hasVotes || hasPosts || hasDocuments || hasMandates || hasVotings) {
    return NextResponse.json(
      { error: "Používateľ má súvisiace záznamy. Použite deaktiváciu namiesto zmazania." },
      { status: 409 }
    );
  }

  // Phase 9.1d: memberships have ON DELETE CASCADE on user_id, so
  // deleting the user removes all of them automatically.
  await db.delete(users).where(eq(users.id, id));

  return NextResponse.json({ success: true });
}
