import "server-only";

import { and, asc, count, eq, gt, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities } from "@/db/schema";
import { randomToken, sha256Hex } from "@/lib/mcp/oauth/crypto";
import { McpError, toMcpError } from "@/lib/mcp/errors";
import type { Viewer } from "@/lib/mcp/principal";
import type { VoteChoice } from "@/types";
import { ballots, pendingBallots, votingItems, votings } from "./db/schema";
import {
  validateBallotCast,
  type PersistedBallot,
  type ValidatedBallot,
} from "./ballots";
import {
  currentBallotState,
  recordConfirmedBallot,
} from "./routes/api/ballots/cast.server";

// Pending ballot + email confirmation (BYT-20261117-001 §6).
//
//   create   the MCP `request_ballot_confirmation` action, after the owner
//            clicked "send confirmation email" in the confirm view /
//            fallback page: supersedes any live request for the same
//            (voting, unit, owner), stores the ballot + SHA-256 of a
//            single-use token, 30-minute expiry. Writes NOTHING to
//            mod_voting_ballots.
//   confirm  the email-link page, signed in as the SAME owner: atomic
//            claim (UPDATE … WHERE token AND owner AND pending AND not
//            expired RETURNING), re-run validateBallotCast against current
//            state, require the same ballot hash, persist with
//            confirmationKind='email' via recordConfirmedBallot (the web
//            confirmation gate's writer). The ONLY MCP-originated writer of
//            mod_voting_ballots.
//   cancel   same claim, status → cancelled. Nothing is cast.
//
// No resend exists (voting.md "Counterparts"): an expired link is dead and
// the owner starts over. Expiry is evaluated at read time — no background
// job (multi-replica safe).

export const PENDING_BALLOT_TTL_MS = 30 * 60 * 1000;
/** §7: 3 ballot emails per voting per owner per hour. */
export const BALLOT_EMAILS_PER_HOUR = 3;
const HOUR_MS = 60 * 60 * 1000;

export type PendingBallotRow = typeof pendingBallots.$inferSelect;
export type PendingBallotStatus = PendingBallotRow["status"];

/** First 12 hex chars of the ballot hash — shown in the email and on the page. */
export function shortBallotHash(hash: string): string {
  return hash.slice(0, 12);
}

/** Token grammar of `randomToken(32)` (base64url, 43 chars). */
export function isPendingBallotToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "23505");
}

// ── create ───────────────────────────────────────────────────────────────

export interface CreatedPendingBallot {
  id: string;
  /** Raw single-use token — goes into the email link only, never stored. */
  token: string;
  expiresAt: Date;
}

export async function createPendingBallot(
  v: Pick<ValidatedBallot, "votingId" | "unitId" | "ownerId" | "marked" | "ballotHash">,
  opts: { clientId: string | null; pendingActionId: string | null; locale: string }
): Promise<CreatedPendingBallot> {
  const [{ n }] = await db
    .select({ n: count() })
    .from(pendingBallots)
    .where(
      and(
        eq(pendingBallots.votingId, v.votingId),
        eq(pendingBallots.ownerId, v.ownerId),
        gt(pendingBallots.createdAt, new Date(Date.now() - HOUR_MS))
      )
    );
  if (n >= BALLOT_EMAILS_PER_HOUR) {
    throw new McpError("rate_limited", { reason: "ballot_emails" });
  }

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + PENDING_BALLOT_TTL_MS);

  try {
    const id = await db.transaction(async (tx) => {
      // No-resend rule: the previous live request for the same
      // (voting, unit, owner) dies — expired if it already ran out,
      // superseded otherwise.
      await tx
        .update(pendingBallots)
        .set({
          status: sql`CASE WHEN ${pendingBallots.expiresAt} <= now() THEN 'expired' ELSE 'superseded' END::mod_voting_pending_ballot_status`,
        })
        .where(
          and(
            eq(pendingBallots.votingId, v.votingId),
            eq(pendingBallots.unitId, v.unitId),
            eq(pendingBallots.ownerId, v.ownerId),
            eq(pendingBallots.status, "pending")
          )
        );
      const [row] = await tx
        .insert(pendingBallots)
        .values({
          votingId: v.votingId,
          unitId: v.unitId,
          ownerId: v.ownerId,
          items: v.marked,
          ballotHash: v.ballotHash,
          tokenHash: sha256Hex(token),
          status: "pending",
          expiresAt,
          source: "mcp",
          clientId: opts.clientId,
          pendingActionId: opts.pendingActionId,
          locale: opts.locale.slice(0, 8),
        })
        .returning({ id: pendingBallots.id });
      return row.id;
    });
    return { id, token, expiresAt };
  } catch (err) {
    // A concurrent request for the same (voting, unit, owner) won the
    // one-pending unique index.
    if (isUniqueViolation(err)) throw new McpError("conflict.state_changed");
    throw err;
  }
}

/** The email could not be sent → the request is dead (nothing to click). */
export async function markPendingBallotFailed(id: string, code: string): Promise<void> {
  await db
    .update(pendingBallots)
    .set({ status: "failed", failureCode: code.slice(0, 64) })
    .where(and(eq(pendingBallots.id, id), eq(pendingBallots.status, "pending")));
}

// ── read (email-link page) ───────────────────────────────────────────────

export type PendingBallotLookup =
  | { kind: "own"; row: PendingBallotRow }
  | { kind: "other_owner" }
  | { kind: "missing" };

/**
 * The request behind an email token, as `userId` may see it. Another
 * owner's request is reported WITHOUT its content (`other_owner`). A
 * pending row past its expiry is reported — and stored — as expired.
 */
export async function lookupPendingBallot(
  token: string,
  userId: string
): Promise<PendingBallotLookup> {
  if (!isPendingBallotToken(token)) return { kind: "missing" };
  const [row] = await db
    .select()
    .from(pendingBallots)
    .where(eq(pendingBallots.tokenHash, sha256Hex(token)))
    .limit(1);
  if (!row) return { kind: "missing" };
  if (row.ownerId !== userId) return { kind: "other_owner" };
  if (row.status === "pending" && row.expiresAt.getTime() <= Date.now()) {
    await expireIfDue(row.id);
    return { kind: "own", row: { ...row, status: "expired" } };
  }
  return { kind: "own", row };
}

async function expireIfDue(id: string): Promise<void> {
  await db
    .update(pendingBallots)
    .set({ status: "expired" })
    .where(
      and(
        eq(pendingBallots.id, id),
        eq(pendingBallots.status, "pending"),
        lte(pendingBallots.expiresAt, sql`now()`)
      )
    );
}

export interface BallotItemLine {
  idx: number;
  itemId: string;
  title: string;
  /** null = the owner left the item unmarked (jurisdiction silence rule). */
  choice: VoteChoice | null;
}

export interface BallotDescription {
  votingTitle: string;
  votingEndsAt: Date;
  unitName: string;
  /** Every item of the voting in ballot order, with the chosen option. */
  items: BallotItemLine[];
}

/** Human-readable ballot: voting + unit names and every item with its choice. */
export async function describeBallot(
  votingId: string,
  unitId: string,
  marked: readonly { itemId: string; choice: VoteChoice }[]
): Promise<BallotDescription | null> {
  const [[voting], [unit], items] = await Promise.all([
    db
      .select({ title: votings.title, endsAt: votings.endsAt })
      .from(votings)
      .where(eq(votings.id, votingId))
      .limit(1),
    db
      .select({ name: entities.name })
      .from(entities)
      .where(eq(entities.id, unitId))
      .limit(1),
    db
      .select({ id: votingItems.id, idx: votingItems.idx, title: votingItems.title })
      .from(votingItems)
      .where(eq(votingItems.votingId, votingId))
      .orderBy(asc(votingItems.idx)),
  ]);
  if (!voting || !unit) return null;
  const choices = new Map(marked.map((m) => [m.itemId, m.choice]));
  return {
    votingTitle: voting.title,
    votingEndsAt: voting.endsAt,
    unitName: unit.name,
    items: items.map((it) => ({
      idx: it.idx,
      itemId: it.id,
      title: it.title,
      choice: choices.get(it.id) ?? null,
    })),
  };
}

// ── decide (email-link page) ─────────────────────────────────────────────

function claimWhere(token: string, ownerId: string) {
  return and(
    eq(pendingBallots.tokenHash, sha256Hex(token)),
    eq(pendingBallots.ownerId, ownerId),
    eq(pendingBallots.status, "pending"),
    gt(pendingBallots.expiresAt, sql`now()`)
  );
}

/**
 * Explains a failed claim: another owner's token → forbidden; unknown,
 * used, cancelled, superseded or expired → action_expired (no resend).
 */
async function explainMiss(token: string, ownerId: string): Promise<McpError> {
  if (!isPendingBallotToken(token)) return new McpError("action_expired");
  const [row] = await db
    .select({ id: pendingBallots.id, ownerId: pendingBallots.ownerId })
    .from(pendingBallots)
    .where(eq(pendingBallots.tokenHash, sha256Hex(token)))
    .limit(1);
  if (row && row.ownerId !== ownerId) return new McpError("forbidden");
  if (row) await expireIfDue(row.id);
  return new McpError("action_expired");
}

/** Codes that keep their meaning at confirm; anything else is state drift. */
const CONFIRM_PASSTHROUGH = new Set([
  "forbidden",
  "voting_not_active",
  "electronic_blocked",
  "not_unit_owner",
  "unit_out_of_scope",
]);

export interface ConfirmedPendingBallot extends PersistedBallot {
  pendingBallotId: string;
  votingId: string;
  pendingActionId: string | null;
}

/**
 * Casts the ballot behind `token` for `owner` (the signed-in user — the
 * caller has already checked `assertActive`). Throws McpError:
 * action_expired, forbidden, voting_not_active, electronic_blocked,
 * not_unit_owner, unit_out_of_scope, conflict.state_changed, internal.
 */
export async function confirmPendingBallot(
  owner: Viewer,
  token: string
): Promise<ConfirmedPendingBallot> {
  if (!isPendingBallotToken(token)) throw new McpError("action_expired");
  const [claimed] = await db
    .update(pendingBallots)
    .set({ status: "confirmed", usedAt: new Date() })
    .where(claimWhere(token, owner.userId))
    .returning();
  if (!claimed) throw await explainMiss(token, owner.userId);

  // Re-validate against CURRENT state (voting may have closed, ownership
  // may have changed, items may differ) — the token binds the ballot, the
  // session binds the person; the hash must still be the emailed one.
  let validated: ValidatedBallot;
  try {
    validated = await validateBallotCast(owner, {
      votingId: claimed.votingId,
      unitId: claimed.unitId,
      items: claimed.items,
      requireOwnerMembership: true,
    });
    if (validated.ballotHash !== claimed.ballotHash) {
      throw new McpError("conflict.state_changed");
    }
  } catch (err) {
    const e = toMcpError(err);
    const code = CONFIRM_PASSTHROUGH.has(e.code) ? e.code : "conflict.state_changed";
    await failClaimed(claimed.id, code);
    throw new McpError(code, { pendingBallotId: claimed.id });
  }

  // Write through the web confirmation gate's writer (BYT-20261117-002
  // Phase 6, routes/api/ballots/cast.server.ts) so both confirmation paths
  // share one set of replay rules, under the same locks: voting row FOR
  // SHARE (still active, deadline not passed), ballot row FOR UPDATE, a
  // paper ballot is never overwritten by the owner, and the request is
  // stale if the ballot was recorded, changed or withdrawn after the
  // request was created (iat = pending row's createdAt). Stores
  // confirmationKind='email' + confirmedAt.
  let persisted: PersistedBallot;
  try {
    const pb = await currentBallotState(validated.votingId, validated.unitId, validated.ownerId);
    const rec = await recordConfirmedBallot({
      votingId: validated.votingId,
      flatId: validated.unitId,
      voterId: validated.ownerId,
      marked: validated.marked,
      ballotHash: validated.ballotHash,
      claims: {
        u: validated.ownerId,
        v: validated.votingId,
        e: validated.unitId,
        d: validated.ballotHash,
        pb,
        iat: claimed.createdAt.getTime(),
      },
      method: "email",
      signature: null,
    });
    if (!rec.ok) {
      const code =
        rec.code === "VOTING_NOT_ACTIVE" || rec.code === "VOTING_ENDED"
          ? "voting_not_active"
          : "conflict.state_changed";
      await failClaimed(claimed.id, code);
      throw new McpError(code, { pendingBallotId: claimed.id, reason: rec.code });
    }
    persisted = {
      ballotId: rec.ballotId,
      ballotHash: validated.ballotHash,
      recordedAt: rec.recordedAt,
      superseded: rec.superseded,
    };
  } catch (err) {
    if (err instanceof McpError) throw err;
    console.error(`[voting] pending ballot ${claimed.id} persist failed:`, err);
    await failClaimed(claimed.id, "internal");
    throw new McpError("internal", { pendingBallotId: claimed.id });
  }

  await db
    .update(pendingBallots)
    .set({ ballotId: persisted.ballotId })
    .where(eq(pendingBallots.id, claimed.id));

  return {
    ...persisted,
    pendingBallotId: claimed.id,
    votingId: claimed.votingId,
    pendingActionId: claimed.pendingActionId,
  };
}

async function failClaimed(id: string, code: string): Promise<void> {
  await db
    .update(pendingBallots)
    .set({ status: "failed", failureCode: code.slice(0, 64) })
    .where(eq(pendingBallots.id, id));
}

/** Owner cancels the request from the email-link page. Nothing is cast. */
export async function cancelPendingBallot(
  owner: Pick<Viewer, "userId">,
  token: string
): Promise<{ pendingBallotId: string; pendingActionId: string | null }> {
  if (!isPendingBallotToken(token)) throw new McpError("action_expired");
  const [row] = await db
    .update(pendingBallots)
    .set({ status: "cancelled", usedAt: new Date() })
    .where(claimWhere(token, owner.userId))
    .returning({ id: pendingBallots.id, pendingActionId: pendingBallots.pendingActionId });
  if (!row) throw await explainMiss(token, owner.userId);
  return { pendingBallotId: row.id, pendingActionId: row.pendingActionId };
}

/** Does the owner already have a stored ballot for this (voting, unit)? */
export async function hasExistingBallot(
  votingId: string,
  unitId: string,
  ownerId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: ballots.id })
    .from(ballots)
    .where(
      and(
        eq(ballots.votingId, votingId),
        eq(ballots.entityId, unitId),
        eq(ballots.ownerId, ownerId)
      )
    )
    .limit(1);
  return Boolean(row);
}
