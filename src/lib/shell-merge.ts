import "server-only";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  boardMembers,
  communityNotificationsSent,
  communityPosts,
  communityResponses,
  consentRecords,
  coreModuleGrants,
  directoryEntries,
  documents,
  entityAuditLog,
  eventRsvps,
  invitations,
  memberships,
  notificationPreferences,
  pairingRequests,
  posts,
  pushSubscriptions,
  registrationTokens,
  users,
} from "@/db/schema";
import { mandates, ballots, votings } from "@modules/voting/src/db/schema";
import { recordEntityAudit } from "@/lib/entity-audit";

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
 *   and shell's is dropped (the share already belongs to target).
 * - Every FK to users.id originating from a content/audit/membership
 *   table is re-pointed shell → target. Without this, `users.id`
 *   delete would fail (most FKs are restrict-style) or silently set
 *   to null (for votes/posts, that'd orphan the data).
 * - Shell row is deleted last.
 * - Audit entry `user.merge_shell` records (shellId, targetId).
 *
 * Vote `auditHash` includes the original shell UUID — after merge the
 * hash no longer verifies. Spec §Notes acknowledges this; the trade-off
 * is documented as an open question. For now, the hash is preserved
 * as-is (no recompute) so the original chain stays inspectable, at
 * the cost of failing the verify step until a follow-up adds a
 * `merged_from_user_id` column.
 */
export async function mergeShellIntoUser(
  shellUserId: string,
  targetUserId: string,
  actorUserId: string
): Promise<MergeResult> {
  if (shellUserId === targetUserId) {
    throw new ShellMergeError(
      "same_user",
      "Shell and target are the same user"
    );
  }

  return db.transaction(async (tx) => {
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

    const shellMemberships = await tx
      .select({ id: memberships.id, entityId: memberships.entityId })
      .from(memberships)
      .where(eq(memberships.userId, shellUserId));

    let moved = 0;
    let skipped = 0;
    for (const m of shellMemberships) {
      const [conflict] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, targetUserId),
            eq(memberships.entityId, m.entityId)
          )
        );
      if (conflict) {
        // Target already has membership at this entity. Drop shell's row,
        // record in audit.
        await tx.delete(memberships).where(eq(memberships.id, m.id));
        skipped += 1;
      } else {
        await tx
          .update(memberships)
          .set({ userId: targetUserId })
          .where(eq(memberships.id, m.id));
        moved += 1;
      }
    }

    // Voting module (ballots, mandates)
    await tx
      .update(ballots)
      .set({ ownerId: targetUserId })
      .where(eq(ballots.ownerId, shellUserId));
    await tx
      .update(ballots)
      .set({ recordedById: targetUserId })
      .where(eq(ballots.recordedById, shellUserId));
    await tx
      .update(mandates)
      .set({ fromOwnerId: targetUserId })
      .where(eq(mandates.fromOwnerId, shellUserId));
    await tx
      .update(mandates)
      .set({ toOwnerId: targetUserId })
      .where(eq(mandates.toOwnerId, shellUserId));
    await tx
      .update(mandates)
      .set({ verifiedByAdminId: targetUserId })
      .where(eq(mandates.verifiedByAdminId, shellUserId));
    await tx
      .update(votings)
      .set({ createdById: targetUserId })
      .where(eq(votings.createdById, shellUserId));
    await tx
      .update(votings)
      .set({ voteCounterId: targetUserId })
      .where(eq(votings.voteCounterId, shellUserId));

    // Content
    await tx
      .update(posts)
      .set({ authorId: targetUserId })
      .where(eq(posts.authorId, shellUserId));
    await tx
      .update(documents)
      .set({ uploadedById: targetUserId })
      .where(eq(documents.uploadedById, shellUserId));
    await tx
      .update(communityPosts)
      .set({ authorId: targetUserId })
      .where(eq(communityPosts.authorId, shellUserId));
    await tx
      .update(communityResponses)
      .set({ authorId: targetUserId })
      .where(eq(communityResponses.authorId, shellUserId));

    // RSVPs (unique constraint on (post, user) — handle conflict by
    // dropping shell row if both exist).
    const shellRsvps = await tx
      .select({ id: eventRsvps.id, postId: eventRsvps.postId })
      .from(eventRsvps)
      .where(eq(eventRsvps.userId, shellUserId));
    for (const r of shellRsvps) {
      const [conflict] = await tx
        .select({ id: eventRsvps.id })
        .from(eventRsvps)
        .where(
          and(
            eq(eventRsvps.userId, targetUserId),
            eq(eventRsvps.postId, r.postId)
          )
        );
      if (conflict) {
        await tx.delete(eventRsvps).where(eq(eventRsvps.id, r.id));
      } else {
        await tx
          .update(eventRsvps)
          .set({ userId: targetUserId })
          .where(eq(eventRsvps.id, r.id));
      }
    }

    // Notifications + preferences (notificationPreferences has UNIQUE on
    // userId — drop shell's if target already has one).
    const [shellPrefs] = await tx
      .select({ id: notificationPreferences.id })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, shellUserId));
    if (shellPrefs) {
      const [targetPrefs] = await tx
        .select({ id: notificationPreferences.id })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.userId, targetUserId));
      if (targetPrefs) {
        await tx
          .delete(notificationPreferences)
          .where(eq(notificationPreferences.id, shellPrefs.id));
      } else {
        await tx
          .update(notificationPreferences)
          .set({ userId: targetUserId })
          .where(eq(notificationPreferences.id, shellPrefs.id));
      }
    }

    // Directory entries (UNIQUE on userId — same pattern).
    const [shellDir] = await tx
      .select({ id: directoryEntries.id })
      .from(directoryEntries)
      .where(eq(directoryEntries.userId, shellUserId));
    if (shellDir) {
      const [targetDir] = await tx
        .select({ id: directoryEntries.id })
        .from(directoryEntries)
        .where(eq(directoryEntries.userId, targetUserId));
      if (targetDir) {
        await tx
          .delete(directoryEntries)
          .where(eq(directoryEntries.id, shellDir.id));
      } else {
        await tx
          .update(directoryEntries)
          .set({ userId: targetUserId })
          .where(eq(directoryEntries.id, shellDir.id));
      }
    }

    // Plain FK re-points (no unique-conflict surface).
    await tx
      .update(pushSubscriptions)
      .set({ userId: targetUserId })
      .where(eq(pushSubscriptions.userId, shellUserId));
    await tx
      .update(consentRecords)
      .set({ userId: targetUserId })
      .where(eq(consentRecords.userId, shellUserId));
    await tx
      .update(communityNotificationsSent)
      .set({ recipientId: targetUserId })
      .where(eq(communityNotificationsSent.recipientId, shellUserId));
    await tx
      .update(communityNotificationsSent)
      .set({ subjectUserId: targetUserId })
      .where(eq(communityNotificationsSent.subjectUserId, shellUserId));
    await tx
      .update(communityNotificationsSent)
      .set({ responderId: targetUserId })
      .where(eq(communityNotificationsSent.responderId, shellUserId));
    await tx
      .update(boardMembers)
      .set({ userId: targetUserId })
      .where(eq(boardMembers.userId, shellUserId));
    await tx
      .update(coreModuleGrants)
      .set({ grantedById: targetUserId })
      .where(eq(coreModuleGrants.grantedById, shellUserId));
    await tx
      .update(entityAuditLog)
      .set({ actorUserId: targetUserId })
      .where(eq(entityAuditLog.actorUserId, shellUserId));
    await tx
      .update(invitations)
      .set({ usedByUserId: targetUserId })
      .where(eq(invitations.usedByUserId, shellUserId));
    await tx
      .update(invitations)
      .set({ createdById: targetUserId })
      .where(eq(invitations.createdById, shellUserId));
    // invitations.targetShellUserId for THIS shell: leave them — they
    // cascade-delete with the shell row below.
    await tx
      .update(registrationTokens)
      .set({ createdById: targetUserId })
      .where(eq(registrationTokens.createdById, shellUserId));
    await tx
      .update(pairingRequests)
      .set({ createdById: targetUserId })
      .where(eq(pairingRequests.createdById, shellUserId));

    // Delete shell. invitations.targetShellUserId rows for this shell
    // cascade-delete (FK cascade). Everything else has been moved.
    await tx.delete(users).where(eq(users.id, shellUserId));

    recordEntityAudit({
      action: "user.merge_shell",
      actorUserId,
      entityId: null,
      before: { shellUserId, shellName: shell.name },
      after: { targetUserId, movedMemberships: moved, skippedMemberships: skipped },
    });

    return { movedMemberships: moved, skippedMemberships: skipped };
  });
}
