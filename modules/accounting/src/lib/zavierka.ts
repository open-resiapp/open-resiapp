import "server-only";

import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, auditLog } from "../db/schema";
import { votingItems, votings } from "@modules/voting/src/db/schema";
import { getItemPassedMap } from "@modules/voting/src/results";

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
//   - fix 2026-11-18: the vote is PICKED from a list, never typed as an ID.
//     Eligible = an item of a CLOSED voting of this dom whose result is
//     PUBLISHED (§14a ods. 9 zák. 182/1993 — resultPublishedAt) and which
//     PASSED (the voting module's own tally, getItemPassedMap). The server
//     re-checks all of it; each failure has a stable code.

/** Stable approval error codes — the route maps them to i18n. */
export type ZavierkaErrorCode =
  | "VOTE_REQUIRED"
  | "PERIOD_NOT_FOUND"
  | "ALREADY_APPROVED"
  | "NOT_PUBLISHED"
  | "VOTE_NOT_FOUND"
  | "VOTE_NOT_CLOSED"
  | "RESULT_NOT_PUBLISHED"
  | "ITEM_NOT_PASSED";

export class ZavierkaError extends Error {
  readonly code: ZavierkaErrorCode;
  constructor(code: ZavierkaErrorCode) {
    super(code);
    this.name = "ZavierkaError";
    this.code = code;
  }
}

export function isZavierkaError(err: unknown): err is ZavierkaError {
  return err instanceof ZavierkaError;
}

export interface EligibleZavierkaItem {
  votingItemId: string;
  votingTitle: string;
  itemIdx: number;
  itemTitle: string;
  endsAt: string;
  resultPublishedAt: string;
}

/** How many most-recent published votings the picker considers. */
const ELIGIBLE_VOTINGS_LIMIT = 20;

/**
 * Items the závierka may be approved with: PASSED items of CLOSED votings of
 * this dom whose result is PUBLISHED. Newest voting first.
 */
export async function listEligibleZavierkaItems(
  entityId: string
): Promise<EligibleZavierkaItem[]> {
  const published = await db
    .select({
      id: votings.id,
      title: votings.title,
      endsAt: votings.endsAt,
      resultPublishedAt: votings.resultPublishedAt,
    })
    .from(votings)
    .where(
      and(
        eq(votings.entityId, entityId),
        eq(votings.status, "closed"),
        isNotNull(votings.resultPublishedAt)
      )
    )
    .orderBy(desc(votings.resultPublishedAt))
    .limit(ELIGIBLE_VOTINGS_LIMIT);
  if (published.length === 0) return [];

  const items = await db
    .select({
      id: votingItems.id,
      votingId: votingItems.votingId,
      idx: votingItems.idx,
      title: votingItems.title,
    })
    .from(votingItems)
    .where(inArray(votingItems.votingId, published.map((v) => v.id)))
    .orderBy(asc(votingItems.idx));

  const out: EligibleZavierkaItem[] = [];
  for (const v of published) {
    const passed = await getItemPassedMap(v.id);
    if (!passed) continue;
    for (const item of items.filter((i) => i.votingId === v.id)) {
      if (!passed.get(item.id)) continue;
      out.push({
        votingItemId: item.id,
        votingTitle: v.title,
        itemIdx: item.idx,
        itemTitle: item.title,
        endsAt: v.endsAt.toISOString(),
        resultPublishedAt: v.resultPublishedAt!.toISOString(),
      });
    }
  }
  return out;
}

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
 * be published and a PASSED item of a CLOSED zhromaždenie vote of this dom
 * with a PUBLISHED result (AC 423). Throws ZavierkaError codes. Stamps
 * the period closed with the vote + actor; posts no journal entry (AC 521).
 * Idempotent-safe: an already-closed period refuses (re-approval is not a
 * thing — the year is done).
 */
export async function approveZavierka(input: {
  entityId: string;
  year: number;
  votingItemId: string;
  actorId: string;
  /** Appended to the statutory justification, e.g. "MCP: Claude". */
  justification?: string | null;
}): Promise<void> {
  if (!input.votingItemId?.trim()) throw new ZavierkaError("VOTE_REQUIRED");

  // The vote must be an item of a CLOSED voting of THIS dom, with the result
  // PUBLISHED, and the item must have PASSED. Checked before the period
  // lock — the tally is a read of frozen closed-voting data.
  const [vote] = await db
    .select({
      status: votings.status,
      votingId: votings.id,
      resultPublishedAt: votings.resultPublishedAt,
    })
    .from(votingItems)
    .innerJoin(votings, eq(votingItems.votingId, votings.id))
    .where(
      and(
        eq(votingItems.id, input.votingItemId),
        eq(votings.entityId, input.entityId)
      )
    );
  // Missing and foreign look the same — no cross-community probing.
  if (!vote) throw new ZavierkaError("VOTE_NOT_FOUND");
  if (vote.status !== "closed") throw new ZavierkaError("VOTE_NOT_CLOSED");
  if (!vote.resultPublishedAt) throw new ZavierkaError("RESULT_NOT_PUBLISHED");
  const passed = await getItemPassedMap(vote.votingId);
  if (!passed?.get(input.votingItemId)) throw new ZavierkaError("ITEM_NOT_PASSED");

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
    if (!period) throw new ZavierkaError("PERIOD_NOT_FOUND");
    if (period.status === "closed") throw new ZavierkaError("ALREADY_APPROVED");
    // The settlement must be published first — approving accounts that have
    // not been closed to the owners is meaningless.
    if (period.status !== "published") throw new ZavierkaError("NOT_PUBLISHED");

    // Belt-and-braces re-check under the transaction (the voting module
    // refuses a reopen once the result is published — §14a ods. 9 zák.
    // 182/1993: zápisnica a výsledok hlasovania sa zverejňujú do 7 dní).
    const [still] = await tx
      .select({ status: votings.status, resultPublishedAt: votings.resultPublishedAt })
      .from(votings)
      .where(eq(votings.id, vote.votingId))
      .for("share");
    if (!still || still.status !== "closed") throw new ZavierkaError("VOTE_NOT_CLOSED");
    if (!still.resultPublishedAt) throw new ZavierkaError("RESULT_NOT_PUBLISHED");

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
      justification: input.justification
        ? `Schválenie účtovnej závierky ${input.year} zhromaždením (${input.justification})`
        : `Schválenie účtovnej závierky ${input.year} zhromaždením`,
    });
  });
}
