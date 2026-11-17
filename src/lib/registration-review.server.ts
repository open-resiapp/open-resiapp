import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";
import type { UserRole } from "@/types";

// Approve / reject of a pending registration — extracted unchanged from
// POST /api/registrations/[id]/approve and /reject so the MCP pending
// actions (approve_registration, reject_registration, link_owner_account)
// commit through the same code as the owners inbox. No e-mail is sent
// to the person on either path.

export const REGISTRATION_APPROVE_ROLES: UserRole[] = [
  "admin",
  "owner",
  "tenant",
  "vote_counter",
  "caretaker",
];

export type ApproveRegistrationError = "invalid_role" | "not_found" | "flat_not_found";

/**
 * Activates a pending user with `role`; with `flatId` also creates an active
 * membership on that unit. Flat is optional: no flat → a flatless community
 * member (status 'active'), no membership.
 */
export async function approvePendingRegistration(input: {
  userId: string;
  flatId: string | null;
  role: string;
}): Promise<{ ok: true } | { ok: false; error: ApproveRegistrationError }> {
  const { userId, role } = input;
  const flatId = input.flatId;
  const hasFlat = typeof flatId === "string" && flatId.length > 0;

  if (!REGISTRATION_APPROVE_ROLES.includes(role as UserRole)) {
    return { ok: false, error: "invalid_role" };
  }

  const [pending] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "pending")))
    .limit(1);

  if (!pending) return { ok: false, error: "not_found" };

  if (hasFlat) {
    // Phase 9.1d: existence check via the housing_unit entity.
    const [flat] = await db
      .select({ id: entities.id })
      .from(entities)
      .where(and(eq(entities.id, flatId), eq(entities.kind, "unit")))
      .limit(1);

    if (!flat) return { ok: false, error: "flat_not_found" };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        status: "active",
        role: role as UserRole,
        emailVerifiedAt: pending.emailVerifiedAt ?? new Date(),
      })
      .where(eq(users.id, userId));

    // Phase 9.1d: memberships single source of truth — userFlats /
    // users.flatId writes removed. Skip entirely when no flat was chosen.
    if (hasFlat) {
      await tx
        .insert(memberships)
        .values({
          userId,
          entityId: flatId,
          role: role as typeof memberships.$inferInsert.role,
          status: "active",
        })
        .onConflictDoNothing({
          target: [memberships.userId, memberships.entityId],
        });
    }
  });

  return { ok: true };
}

/** Marks a pending user rejected and blocks login. False when not pending. */
export async function rejectPendingRegistration(userId: string): Promise<boolean> {
  const [pending] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "pending")))
    .limit(1);

  if (!pending) return false;

  await db
    .update(users)
    .set({ status: "rejected", isActive: false })
    .where(eq(users.id, userId));

  return true;
}
