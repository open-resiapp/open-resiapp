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

type ApproveResult = { ok: true } | { ok: false; error: ApproveRegistrationError };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Thrown inside the standalone approve transaction to roll it back. */
class ApproveRollback extends Error {
  constructor(public result: ApproveResult) {
    super("approve_rollback");
  }
}

/**
 * Activates a pending user with `role`; with `flatId` also creates an active
 * membership on that unit. Flat is optional: no flat → a flatless community
 * member (status 'active'), no membership.
 *
 * The activating UPDATE is conditional on `status = 'pending'`, so a user
 * decided elsewhere meanwhile yields `not_found` and nothing is written.
 * Pass `tx` to run inside the caller's transaction (merge + approve); on a
 * non-ok result the caller must roll its transaction back.
 */
export async function approvePendingRegistration(
  input: {
    userId: string;
    flatId: string | null;
    role: string;
  },
  tx?: Tx
): Promise<ApproveResult> {
  const { userId, role } = input;
  const flatId = input.flatId;
  const hasFlat = typeof flatId === "string" && flatId.length > 0;

  if (!REGISTRATION_APPROVE_ROLES.includes(role as UserRole)) {
    return { ok: false, error: "invalid_role" };
  }

  const run = async (q: Tx): Promise<ApproveResult> => {
    const [pending] = await q
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.status, "pending")))
      .limit(1);

    if (!pending) return { ok: false, error: "not_found" };

    if (hasFlat) {
      // Phase 9.1d: existence check via the housing_unit entity.
      const [flat] = await q
        .select({ id: entities.id })
        .from(entities)
        .where(and(eq(entities.id, flatId), eq(entities.kind, "unit")))
        .limit(1);

      if (!flat) return { ok: false, error: "flat_not_found" };
    }

    const activated = await q
      .update(users)
      .set({
        status: "active",
        role: role as UserRole,
        emailVerifiedAt: pending.emailVerifiedAt ?? new Date(),
      })
      .where(and(eq(users.id, userId), eq(users.status, "pending")))
      .returning({ id: users.id });
    // Decided elsewhere between the read and the write.
    if (activated.length === 0) return { ok: false, error: "not_found" };

    // Phase 9.1d: memberships single source of truth — userFlats /
    // users.flatId writes removed. Skip entirely when no flat was chosen.
    if (hasFlat) {
      await q
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
    return { ok: true };
  };

  if (tx) return run(tx);

  try {
    return await db.transaction(async (own) => {
      const res = await run(own);
      if (!res.ok) throw new ApproveRollback(res);
      return res;
    });
  } catch (err) {
    if (err instanceof ApproveRollback) return err.result;
    throw err;
  }
}

/** Marks a pending user rejected and blocks login. False when not pending. */
export async function rejectPendingRegistration(userId: string): Promise<boolean> {
  const rejected = await db
    .update(users)
    .set({ status: "rejected", isActive: false })
    .where(and(eq(users.id, userId), eq(users.status, "pending")))
    .returning({ id: users.id });

  return rejected.length > 0;
}
