import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { mergeShellTx } from "@/lib/user-merge.server";
import { recordEntityAudit } from "@/lib/entity-audit";
import { approvePendingRegistration } from "@/lib/registration-review.server";

export class ShellMergeError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "ShellMergeError";
  }
}

interface MergeResult {
  movedMemberships: number;
  skippedMemberships: number; // already-claimed conflicts
}

/**
 * Transactionally merge a shell user into a real (target) user.
 *
 * - Memberships move; on (target, entity) conflict, target's row wins
 *   and shell's is ended with end_reason 'merged' (history kept).
 * - Every FK to users.id originating from a content/audit/membership
 *   table is re-pointed shell → target. Without this, `users.id`
 *   delete would fail (most FKs are restrict-style) or silently set
 *   to null (for votes/posts, that'd orphan the data).
 * - Shell row is deleted last (or kept as a tombstone when a retained
 *   record — a closed-voting duplicate ballot — is left on it).
 * - Audit entry `user.merge_shell` records (shellId, targetId).
 *
 * With `approvePendingAsOwner`, the target (a pending self-registration) is
 * approved as owner in the SAME transaction; when it is no longer pending
 * the whole merge rolls back with ShellMergeError("state_changed").
 *
 * Vote `itemAuditHash` includes the original shell UUID — the merge keeps
 * it in `mod_voting_ballots.hash_owner_id` (BYT-20261118-007), so the hash
 * still verifies with COALESCE(hash_owner_id, owner_id).
 */
export async function mergeShellIntoUser(
  shellUserId: string,
  targetUserId: string,
  actorUserId: string,
  opts: { approvePendingAsOwner?: boolean } = {}
): Promise<MergeResult> {
  if (shellUserId === targetUserId) {
    throw new ShellMergeError(
      "same_user",
      "Shell and target are the same user"
    );
  }

  const result = await db.transaction(async (tx) => {
    const [shell] = await tx
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        status: users.status,
        name: users.name,
      })
      .from(users)
      .where(eq(users.id, shellUserId));

    if (!shell) throw new ShellMergeError("shell_missing", "Shell user not found");
    if (shell.passwordHash !== null || shell.email !== null) {
      throw new ShellMergeError(
        "not_shell",
        "Source user has already been claimed"
      );
    }
    if (shell.status !== "pending") {
      throw new ShellMergeError(
        "not_pending",
        "Shell user is not in pending status"
      );
    }

    const [target] = await tx
      .select({
        id: users.id,
        email: users.email,
        passwordHash: users.passwordHash,
        status: users.status,
      })
      .from(users)
      .where(eq(users.id, targetUserId));

    if (!target) {
      throw new ShellMergeError("target_missing", "Target user not found");
    }
    if (target.passwordHash === null) {
      throw new ShellMergeError(
        "target_shell",
        "Target is also a shell user — cannot merge"
      );
    }

    // BYT-20261118-007: every FK to users.id is moved by the user-FK
    // registry (src/lib/user-fk-registry.ts) — accounting authorship,
    // passkeys, MCP, faults … were silently missed by the old hand list.
    // A membership the target already holds is ENDED ('merged'), not
    // deleted, so ownership history survives. The shell row is deleted when
    // nothing retained is left on it, otherwise kept as a tombstone.
    const merged = await mergeShellTx(tx, shellUserId, targetUserId, actorUserId);
    if (merged.blocked) {
      throw new ShellMergeError(merged.blocked, "Both accounts voted for the same unit in an open voting");
    }
    const moved = merged.moved;
    const skipped = merged.ended;

    if (opts.approvePendingAsOwner) {
      const approved = await approvePendingRegistration(
        { userId: targetUserId, flatId: null, role: "owner" },
        tx
      );
      // Throwing rolls the merge back with the failed approval.
      if (!approved.ok) {
        throw new ShellMergeError("state_changed", "Target is no longer a pending registration");
      }
    }

    return { shellName: shell.name, movedMemberships: moved, skippedMemberships: skipped };
  });

  // Audited only after the transaction committed (a rolled-back merge
  // must not leave a user.merge_shell entry behind).
  recordEntityAudit({
    action: "user.merge_shell",
    actorUserId,
    entityId: null,
    before: { shellUserId, shellName: result.shellName },
    after: {
      targetUserId,
      movedMemberships: result.movedMemberships,
      skippedMemberships: result.skippedMemberships,
    },
  });

  return { movedMemberships: result.movedMemberships, skippedMemberships: result.skippedMemberships };
}
