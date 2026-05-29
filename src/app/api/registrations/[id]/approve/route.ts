import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, memberships, entities } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

const ALLOWED_ROLES: UserRole[] = [
  "admin",
  "owner",
  "tenant",
  "vote_counter",
  "caretaker",
];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { error: "Neautorizovaný prístup" },
      { status: 401 }
    );
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { flatId, role = "owner" } = body ?? {};

  // Flat is optional: an admin may admit a registrant into the community
  // without assigning a flat. No flat → activate the user, create no
  // membership (a flatless community member, status='active').
  const hasFlat = typeof flatId === "string" && flatId.length > 0;

  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: "Neplatná rola" }, { status: 400 });
  }

  const [pending] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.status, "pending")))
    .limit(1);

  if (!pending) {
    return NextResponse.json(
      { error: "Žiadosť nebola nájdená" },
      { status: 404 }
    );
  }

  if (hasFlat) {
    // Phase 9.1d: existence check via the housing_unit entity.
    const [flat] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, flatId), eq(entities.kind, "unit")))
      .limit(1);

    if (!flat) {
      return NextResponse.json({ error: "Byt nebol nájdený" }, { status: 400 });
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        status: "active",
        role,
        emailVerifiedAt: pending.emailVerifiedAt ?? new Date(),
      })
      .where(eq(users.id, id));

    // Phase 9.1d: memberships single source of truth — userFlats /
    // users.flatId writes removed. Skip entirely when no flat was chosen.
    if (hasFlat) {
      await tx
        .insert(memberships)
        .values({
          userId: id,
          entityId: flatId,
          role: role as typeof memberships.$inferInsert.role,
          status: "active",
        })
        .onConflictDoNothing({
          target: [memberships.userId, memberships.entityId],
        });
    }
  });

  return NextResponse.json({ success: true });
}
