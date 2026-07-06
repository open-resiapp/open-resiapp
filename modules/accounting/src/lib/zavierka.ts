import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, auditLog } from "../db/schema";
import { votingItems, votings } from "@modules/voting/src/db/schema";

// Účtovná závierka approval (BYT-20260512-002, AC 423/521).
//
// The annual accounts are approved by the zhromaždenie/shromáždění, not the
// board alone (§7c ods. 9 zák. 182/1993 SK, §1208 NOZ CZ). This records that
// approval against the year's period:
//   - it is BLOCKED until (a) the settlement is published for the year and
//     (b) a CLOSED zhromaždenie vote for this dom is supplied — no vote, no
//     approval (AC 423);
//   - it is an APPROVAL action, performed by the chairman (requireApprover),
//     and posts NOTHING to the ledger — separation of duties (AC 521). It
//     only stamps the period closed with the approving vote + actor.

export interface ZavierkaStatus {
  year: number;
  /** Period lifecycle — "published" means the settlement is done, approval
   *  is possible; "closed" means the závierka is approved. */
  periodStatus: "missing" | "open" | "reconciling" | "published" | "closed";
  approved: boolean;
  approvedAt: string | null;
  votingItemId: string | null;
  /** True once the settlement is published — approval is unblocked. */
  canApprove: boolean;
}

export async function getZavierkaStatus(
  entityId: string,
  year: number
): Promise<ZavierkaStatus> {
  const [period] = await db
    .select({
      status: accountingPeriods.status,
      approvedAt: accountingPeriods.zavierkaApprovedAt,
      votingItemId: accountingPeriods.zavierkaVotingItemId,
    })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        eq(accountingPeriods.year, year)
      )
    );
  if (!period) {
    return {
      year,
      periodStatus: "missing",
      approved: false,
      approvedAt: null,
      votingItemId: null,
      canApprove: false,
    };
  }
  return {
    year,
    periodStatus: period.status,
    approved: period.status === "closed" && period.approvedAt !== null,
    approvedAt: period.approvedAt?.toISOString() ?? null,
    votingItemId: period.votingItemId,
    canApprove: period.status === "published",
  };
}

/**
 * Approves the annual účtovná závierka for `year`. Requires the settlement to
 * be published and a CLOSED zhromaždenie vote for this dom (AC 423). Stamps
 * the period closed with the vote + actor; posts no journal entry (AC 521).
 * Idempotent-safe: an already-closed period refuses (re-approval is not a
 * thing — the year is done).
 */
export async function approveZavierka(input: {
  entityId: string;
  year: number;
  votingItemId: string;
  actorId: string;
}): Promise<void> {
  if (!input.votingItemId?.trim()) {
    throw new Error(
      "accounting: závierka approval requires the recorded zhromaždenie vote"
    );
  }

  await db.transaction(async (tx) => {
    const [period] = await tx
      .select({ id: accountingPeriods.id, status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.entityId, input.entityId),
          eq(accountingPeriods.year, input.year)
        )
      )
      .for("update");
    if (!period) throw new Error("accounting: period not found");
    if (period.status === "closed") {
      throw new Error("accounting: závierka for this year is already approved");
    }
    // The settlement must be published first — approving accounts that have
    // not been closed to the owners is meaningless.
    if (period.status !== "published") {
      throw new Error(
        "accounting: publish the vyúčtovanie before approving the závierka"
      );
    }

    // The supplied vote must be a CLOSED voting that belongs to THIS dom —
    // the recorded zhromaždenie resolution. A missing / foreign / still-open
    // vote cannot unblock the approval.
    const [vote] = await tx
      .select({ status: votings.status })
      .from(votingItems)
      .innerJoin(votings, eq(votingItems.votingId, votings.id))
      .where(
        and(
          eq(votingItems.id, input.votingItemId),
          eq(votings.entityId, input.entityId)
        )
      );
    if (!vote) {
      throw new Error(
        "accounting: the referenced vote does not belong to this community"
      );
    }
    if (vote.status !== "closed") {
      throw new Error(
        "accounting: the zhromaždenie vote must be closed before the závierka is approved"
      );
    }

    await tx
      .update(accountingPeriods)
      .set({
        status: "closed",
        closedAt: new Date(),
        zavierkaApprovedAt: new Date(),
        zavierkaApprovedById: input.actorId,
        zavierkaVotingItemId: input.votingItemId,
      })
      .where(eq(accountingPeriods.id, period.id));

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "approve",
      tableName: "mod_accounting_periods",
      recordId: period.id,
      after: {
        zavierkaApproved: true,
        year: input.year,
        votingItemId: input.votingItemId,
      },
      justification: `Schválenie účtovnej závierky ${input.year} zhromaždením`,
    });
  });
}
