import "server-only";
// BYT-20261117-002 Phase 6: shared ballot validation + the confirmed
// electronic write path.
//
// docs/domain/voting.md: "An electronic vote is never accepted on the basis
// of an authenticated session alone. The voter must perform an active
// confirming action within a short, single-use window (clicked
// email-confirmation link or passkey assertion)."
//
// The confirmation proof is a stateless signed token (src/lib/signed-token)
// bound to (voter, voting, unit, ballot digest, prior-ballot state,
// issued-at). Single use is guaranteed by the ballot row itself — see
// `recordConfirmedBallot` — plus a revocation marker written when a ballot
// is withdrawn or deleted (the unit's state then returns to "no ballot", so
// a token minted before the first vote would otherwise match again).
//
// Paper ballots are locked for owners: an owner can neither overwrite nor
// withdraw a ballot the board recorded from a signed paper ballot, and the
// owner path never deletes ballot photos.
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships } from "@/db/schema";
import {
  votings,
  votingItems,
  ballots,
  ballotItemVotes,
  ballotPhotos,
} from "@modules/voting/src/db/schema";
import { recordVotingEvent } from "@modules/voting/src/events";
import {
  computeBallotHash,
  computeItemAuditHash,
} from "@modules/voting/src/engine";
import { isElectronicVotingBlocked } from "@modules/voting/src/rules";
import { ownershipSnapshot } from "@modules/voting/src/ballot-snapshot.server";
import { VOTING_ROLES } from "@modules/voting/src/voting-roles";
import { getCommunityRoot } from "@/lib/legacy-compat";
import {
  revokeTokensIssuedBefore,
  tokensRevokedAt,
} from "@/lib/signed-token.server";
import { MAX_VOTE_TOKEN_TTL_MS } from "@/lib/webauthn";
import type { Country, VoteChoice } from "@/types";

export const VALID_CHOICES: VoteChoice[] = ["za", "proti", "zdrzal_sa"];

/** Stable error codes of the electronic cast path (mapped to VoteCast.errors.*). */
export type CastErrorCode =
  | "UNAUTHORIZED"
  | "BALLOT_CONFLICT"
  | "FORBIDDEN"
  | "INVALID_REQUEST"
  | "RATE_LIMITED"
  | "VOTING_NOT_ACTIVE"
  | "VOTING_ENDED"
  | "ELECTRONIC_NOT_ALLOWED"
  | "NOT_UNIT_OWNER"
  | "UNIT_OUT_OF_SCOPE"
  | "INVALID_ITEM"
  | "INVALID_CHOICE"
  | "DUPLICATE_ITEM"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_INVALID"
  | "CONFIRMATION_EXPIRED"
  | "CONFIRMATION_MISMATCH"
  | "CONFIRMATION_SUPERSEDED"
  | "CONFIRMATION_UNAVAILABLE"
  | "NO_PASSKEY"
  | "PASSKEY_PENDING"
  | "PASSKEY_NOT_FOUND"
  | "PASSKEY_VERIFICATION_FAILED"
  | "PAPER_BALLOT_LOCKED"
  | "BALLOT_NOT_FOUND"
  | "NO_EMAIL"
  | "EMAIL_UNAVAILABLE";

export interface CastFailure {
  ok: false;
  code: CastErrorCode;
  status: number;
  /** Pre-Phase-6 Slovak message — returned verbatim on the paper path so its behaviour is unchanged. */
  legacyMessage: string;
  /** Machine-readable detail for callers that map the code further (MCP). */
  detail?: Record<string, unknown>;
}

function fail(
  code: CastErrorCode,
  status: number,
  legacyMessage: string = code,
  detail?: Record<string, unknown>
): CastFailure {
  return detail ? { ok: false, code, status, legacyMessage, detail } : { ok: false, code, status, legacyMessage };
}

export interface MarkedChoice {
  itemId: string;
  choice: VoteChoice;
}

export interface ValidCast {
  ok: true;
  voting: typeof votings.$inferSelect;
  country: Country;
  marked: MarkedChoice[];
  ballotHash: string;
}

/**
 * Eligibility + content checks shared by every cast path — web routes and
 * the MCP ballot path (modules/voting/src/ballots.ts validateBallotCast
 * maps the failures to McpError) — in the same order the pre-Phase-6 POST
 * ran them. `electronic` adds the electronic-only rules (statutory e-voting
 * block, voting window end). Eligibility is ALWAYS an active OWNER
 * membership on the unit (2026-11-18 review: the web path used to accept
 * any active membership, tenants included) — web, paper and MCP identical.
 */
export async function validateCast(input: {
  votingId: string;
  flatId: string;
  voterId: string;
  incoming: unknown;
  electronic: boolean;
}): Promise<ValidCast | CastFailure> {
  const { votingId, flatId, voterId, electronic } = input;
  const incoming: unknown[] = Array.isArray(input.incoming) ? input.incoming : [];

  const [voting] = await db
    .select()
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!voting || voting.status !== "active") {
    return fail("VOTING_NOT_ACTIVE", 400, "Hlasovanie nie je aktívne", { exists: Boolean(voting) });
  }
  // Voting window (electronic only — a paper ballot received in time may be
  // entered by the counter after the deadline, as before).
  if (electronic && Date.now() > voting.endsAt.getTime()) {
    return fail("VOTING_ENDED", 400, "Hlasovanie nie je aktívne");
  }

  const root = await getCommunityRoot();
  const country = (root?.country ?? "sk") as Country;
  if (electronic && isElectronicVotingBlocked(country, voting.votingType, voting.initiatedBy)) {
    return fail(
      "ELECTRONIC_NOT_ALLOWED",
      400,
      voting.votingType === "meeting"
        ? "Elektronické hlasovanie nie je povolené pre hlasovanie na schôdzi"
        : "Elektronické hlasovanie nie je povolené pre hlasovanie iniciované štvrtinou vlastníkov",
      { reason: voting.votingType === "meeting" ? "meeting" : "owners_quarter" }
    );
  }

  // Ownership: the voter must hold an active OWNER membership on the unit.
  const [ownerFlat] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, voterId),
        eq(memberships.entityId, flatId),
        eq(memberships.status, "active"),
        inArray(memberships.role, [...VOTING_ROLES])
      )
    )
    .limit(1);
  if (!ownerFlat) {
    return fail("NOT_UNIT_OWNER", 400, "Vlastník nevlastní tento byt");
  }

  // Scope: the flat must sit within the voting's subtree.
  if (voting.entityId) {
    const [flatRow] = await db
      .select({ flatPath: entities.path })
      .from(entities)
      .where(eq(entities.id, flatId))
      .limit(1);
    const [scopeRow] = await db
      .select({ scopePath: entities.path })
      .from(entities)
      .where(eq(entities.id, voting.entityId))
      .limit(1);
    if (flatRow && scopeRow && !flatRow.flatPath.startsWith(scopeRow.scopePath)) {
      return fail("UNIT_OUT_OF_SCOPE", 403, "Tento byt nie je v hlasovanom rozsahu");
    }
  }

  // Item choices. Unmarked items are allowed by the domain (silence rule) —
  // they produce no ballot_item_vote row. The owner UI requires an explicit
  // choice per item; paper ballots may legitimately leave items blank.
  const items = await db
    .select({ id: votingItems.id })
    .from(votingItems)
    .where(eq(votingItems.votingId, votingId));
  const validItemIds = new Set(items.map((i) => i.id));

  const marked: MarkedChoice[] = [];
  const seen = new Set<string>();
  for (const raw of incoming) {
    const it = (raw ?? {}) as { itemId?: unknown; choice?: unknown };
    const itemId = typeof it.itemId === "string" ? it.itemId : "";
    const choice = it.choice as VoteChoice;
    if (!itemId || !validItemIds.has(itemId)) {
      return fail("INVALID_ITEM", 400, "Neplatná položka hlasovania");
    }
    if (!VALID_CHOICES.includes(choice)) {
      return fail("INVALID_CHOICE", 400, "Neplatná voľba");
    }
    if (seen.has(itemId)) {
      return fail("DUPLICATE_ITEM", 400, "Duplicitná voľba pre položku");
    }
    seen.add(itemId);
    marked.push({ itemId, choice });
  }

  return { ok: true, voting, country, marked, ballotHash: computeBallotHash(marked) };
}

/**
 * The unit's current ballot state for this voter, as epoch ms of its
 * `recordedAt`, or 0 when there is no ballot. Bound into every confirmation
 * token as `pb` ("prior ballot").
 */
export async function currentBallotState(
  votingId: string,
  flatId: string,
  ownerId: string
): Promise<number> {
  const row = await currentBallot(votingId, flatId, ownerId);
  return row ? row.recordedAtMs : 0;
}

/** The voter's current ballot for the unit (or null). */
export async function currentBallot(
  votingId: string,
  flatId: string,
  ownerId: string
): Promise<{ recordedAtMs: number; voteType: string; ballotHash: string } | null> {
  const [row] = await db
    .select({
      recordedAt: ballots.recordedAt,
      voteType: ballots.voteType,
      ballotHash: ballots.ballotHash,
    })
    .from(ballots)
    .where(
      and(
        eq(ballots.votingId, votingId),
        eq(ballots.entityId, flatId),
        eq(ballots.ownerId, ownerId)
      )
    )
    .limit(1);
  return row
    ? { recordedAtMs: row.recordedAt.getTime(), voteType: row.voteType, ballotHash: row.ballotHash }
    : null;
}

/** Revocation scope of every confirmation token for one (voting, unit, owner). */
export function ballotTokenScope(votingId: string, flatId: string, ownerId: string): string {
  return `ballot:${votingId}:${flatId}:${ownerId}`;
}

/** Epoch ms of the latest withdrawal / deletion of this ballot (0 = never). */
export function ballotTokensRevokedAt(
  votingId: string,
  flatId: string,
  ownerId: string
): Promise<number> {
  return tokensRevokedAt(db, ballotTokenScope(votingId, flatId, ownerId));
}

/**
 * Digest a withdraw confirmation is bound to: the exact ballot being
 * withdrawn (its content commitment), so a withdraw token can never confirm
 * a vote (different purpose key too) nor withdraw a different ballot.
 */
export function withdrawDigest(votingId: string, flatId: string, ballotHash: string): string {
  return createHash("sha256")
    .update(`withdraw|${votingId}|${flatId}|${ballotHash}`, "utf8")
    .digest("hex");
}

/** Claims carried by a vote confirmation token (passkey challenge or e-mail link). */
export interface VoteConfirmClaims {
  /** voter (user id) */
  u: string;
  /** voting id */
  v: string;
  /** unit (entity) id */
  e: string;
  /** ballot digest = computeBallotHash(marked) */
  d: string;
  /** prior ballot state (currentBallotState at issue time) */
  pb: number;
  /** e-mail tokens only: the choices themselves, so the link page can state them */
  c?: [string, VoteChoice][];
  /** e-mail tokens only: voter locale for the receipt */
  l?: string;
  /** e-mail vote tokens of the inline first-vote flow: pending passkey row id to activate */
  k?: string;
  /** … and its WebAuthn credential id (activation is bound to both) */
  kc?: string;
}

export type ConfirmationMethod = "passkey" | "email";

class TxAbort extends Error {
  constructor(readonly code: CastErrorCode, readonly status: number) {
    super(code);
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Lock order shared by every ballot write: voting row FOR SHARE, then the
 * ballot row FOR UPDATE. Closing a voting updates the voting row, so it
 * waits for in-flight casts and every cast after it sees the new status.
 * `enforceDeadline: false` = board / counter writes (paper ballots received
 * in time may be entered after endsAt, and the board corrects a reopened
 * voting) — status must still be active.
 */
export async function lockActiveVoting(
  tx: Tx,
  votingId: string,
  opts: { enforceDeadline?: boolean } = {}
): Promise<void> {
  const [v] = await tx
    .select({ status: votings.status, endsAt: votings.endsAt })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1)
    .for("share");
  if (!v || v.status !== "active") throw new TxAbort("VOTING_NOT_ACTIVE", 400);
  if (opts.enforceDeadline !== false && Date.now() > v.endsAt.getTime()) {
    throw new TxAbort("VOTING_ENDED", 400);
  }
}

export function isUniqueViolation(err: unknown): boolean {
  // drizzle ≥0.44 wraps the driver error in `cause`.
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/** TxAbort / unique-violation → CastFailure (null = rethrow). */
export function txFailure(
  err: unknown,
  uniqueCode: CastErrorCode = "CONFIRMATION_SUPERSEDED"
): CastFailure | null {
  if (err instanceof TxAbort) return fail(err.code, err.status);
  // Lost the race for the first insert on the unique index.
  if (isUniqueViolation(err)) return fail(uniqueCode, 409);
  return null;
}

/**
 * Write a confirmed electronic ballot. Replay / single-use rules, checked
 * under a row lock in the same transaction as the write:
 *   1. the unit's ballot state must still equal the token's `pb`
 *      (a ballot recorded, changed or withdrawn after the token was issued
 *      invalidates the token);
 *   2. a token issued at or before the stored ballot's recordedAt is stale;
 *   3. the new recordedAt is strictly later than the token's issued-at, so the
 *      ballot just written invalidates the token that wrote it — and every
 *      other token issued before it — by rules 1 and 2;
 *   4. a token issued at or before the latest withdrawal / board deletion of
 *      this ballot is stale (revocation marker).
 * The voting is re-read FOR SHARE in the same transaction (still active,
 * deadline not passed). A paper ballot is never overwritten from here.
 * A concurrent first insert loses on the (voting, unit, owner) unique index.
 */
export async function recordConfirmedBallot(input: {
  votingId: string;
  flatId: string;
  voterId: string;
  marked: MarkedChoice[];
  ballotHash: string;
  claims: VoteConfirmClaims & { iat: number };
  method: ConfirmationMethod;
  /**
   * Passkey: the WebAuthn proof. E-mail: a function of the final recordedAt
   * (BYT-20261118-009 §5 — the HMAC binds the confirmation time, which is
   * only chosen inside this transaction).
   */
  signature: string | null | ((recordedAt: Date) => string);
}): Promise<
  | { ok: true; ballotId: string; recordedAt: Date; superseded: boolean }
  | CastFailure
> {
  const { votingId, flatId, voterId, marked, ballotHash, claims, method } = input;
  try {
    return await db.transaction(async (tx) => {
      await lockActiveVoting(tx, votingId);
      const [existing] = await tx
        .select({ id: ballots.id, recordedAt: ballots.recordedAt, voteType: ballots.voteType })
        .from(ballots)
        .where(
          and(
            eq(ballots.votingId, votingId),
            eq(ballots.entityId, flatId),
            eq(ballots.ownerId, voterId)
          )
        )
        .limit(1)
        .for("update");

      if (existing?.voteType === "paper") throw new TxAbort("PAPER_BALLOT_LOCKED", 409);
      const existingMs = existing ? existing.recordedAt.getTime() : 0;
      if (existingMs !== claims.pb) throw new TxAbort("CONFIRMATION_SUPERSEDED", 409);
      if (existing && claims.iat <= existingMs) {
        throw new TxAbort("CONFIRMATION_SUPERSEDED", 409);
      }
      const revokedAt = await tokensRevokedAt(tx, ballotTokenScope(votingId, flatId, voterId));
      if (claims.iat <= revokedAt) throw new TxAbort("CONFIRMATION_SUPERSEDED", 409);

      const recordedAt = new Date(Math.max(Date.now(), claims.iat + 1));
      const snapshot = await ownershipSnapshot(tx, flatId, voterId);
      const values = {
        ...snapshot,
        voteType: "electronic" as const,
        recordedById: null,
        mandateId: null,
        ballotHash,
        signature:
          typeof input.signature === "function" ? input.signature(recordedAt) : input.signature,
        confirmationKind: method,
        confirmedAt: recordedAt,
        recordedAt,
      };

      let bId: string;
      if (existing) {
        bId = existing.id;
        // Electronic → electronic only (paper is locked above), so there
        // are no ballot photos to touch.
        await tx.update(ballots).set(values).where(eq(ballots.id, bId));
        await tx.delete(ballotItemVotes).where(eq(ballotItemVotes.ballotId, bId));
      } else {
        const [created] = await tx
          .insert(ballots)
          .values({ votingId, entityId: flatId, ownerId: voterId, ...values })
          .returning({ id: ballots.id });
        bId = created.id;
      }

      if (marked.length > 0) {
        await tx.insert(ballotItemVotes).values(
          marked.map((m) => ({
            ballotId: bId,
            itemId: m.itemId,
            choice: m.choice,
            itemAuditHash: computeItemAuditHash({
              votingId,
              itemId: m.itemId,
              entityId: flatId,
              ownerId: voterId,
              choice: m.choice,
              recordedAt,
            }),
          }))
        );
      }
      return {
        ok: true as const,
        ballotId: bId,
        recordedAt,
        superseded: Boolean(existing),
      };
    });
  } catch (err) {
    const f = txFailure(err);
    if (f) return f;
    throw err;
  }
}

/**
 * Owner withdrawal of an electronic ballot, confirmed by a passkey assertion
 * or an e-mail link bound to `withdrawDigest` of exactly this ballot and to
 * its state (`pb`). Same lock order and voting re-validation as a cast.
 * Writes the revocation marker in the same transaction, so every
 * confirmation token issued before the withdrawal is dead afterwards.
 */
export async function withdrawConfirmedBallot(input: {
  votingId: string;
  flatId: string;
  voterId: string;
  claims: VoteConfirmClaims & { iat: number };
}): Promise<{ ok: true; withdrawnAt: Date } | CastFailure> {
  const { votingId, flatId, voterId, claims } = input;
  try {
    return await db.transaction(async (tx) => {
      await lockActiveVoting(tx, votingId);
      const [existing] = await tx
        .select({
          id: ballots.id,
          recordedAt: ballots.recordedAt,
          voteType: ballots.voteType,
          ballotHash: ballots.ballotHash,
        })
        .from(ballots)
        .where(
          and(
            eq(ballots.votingId, votingId),
            eq(ballots.entityId, flatId),
            eq(ballots.ownerId, voterId)
          )
        )
        .limit(1)
        .for("update");
      if (!existing) throw new TxAbort("BALLOT_NOT_FOUND", 404);
      if (existing.voteType === "paper") throw new TxAbort("PAPER_BALLOT_LOCKED", 409);
      if (existing.recordedAt.getTime() !== claims.pb) {
        throw new TxAbort("CONFIRMATION_SUPERSEDED", 409);
      }
      if (claims.d !== withdrawDigest(votingId, flatId, existing.ballotHash)) {
        throw new TxAbort("CONFIRMATION_MISMATCH", 400);
      }
      const withdrawnAt = new Date(Math.max(Date.now(), claims.iat + 1));
      // ballot_item_votes cascade; electronic ballots have no photos.
      await tx.delete(ballots).where(eq(ballots.id, existing.id));
      await revokeTokensIssuedBefore(
        tx,
        ballotTokenScope(votingId, flatId, voterId),
        withdrawnAt,
        MAX_VOTE_TOKEN_TTL_MS
      );
      return { ok: true as const, withdrawnAt };
    });
  } catch (err) {
    const f = txFailure(err);
    if (f) return f;
    throw err;
  }
}

/**
 * Board / counter deletion of someone's ballot (DELETE with ownerId). No
 * owner confirmation, but it invalidates every confirmation token issued
 * before it, exactly like an owner withdrawal. Returns false when there was
 * no ballot.
 */
export async function deleteBallotAsBoard(input: {
  votingId: string;
  flatId: string;
  ownerId: string;
}): Promise<{ ok: true } | CastFailure> {
  const { votingId, flatId, ownerId } = input;
  try {
    return await db.transaction(async (tx) => {
      // Same lock order as every ballot write; status re-checked on the
      // locked row (no deadline — the board corrects until close).
      await lockActiveVoting(tx, votingId, { enforceDeadline: false });
      const [existing] = await tx
        .select({ id: ballots.id })
        .from(ballots)
        .where(
          and(
            eq(ballots.votingId, votingId),
            eq(ballots.entityId, flatId),
            eq(ballots.ownerId, ownerId)
          )
        )
        .limit(1)
        .for("update");
      if (!existing) throw new TxAbort("BALLOT_NOT_FOUND", 404);
      // ballot_item_votes + ballot_photos cascade on ballot delete.
      await tx.delete(ballots).where(eq(ballots.id, existing.id));
      await revokeTokensIssuedBefore(
        tx,
        ballotTokenScope(votingId, flatId, ownerId),
        new Date(),
        MAX_VOTE_TOKEN_TTL_MS
      );
      return { ok: true as const };
    });
  } catch (err) {
    const f = txFailure(err, "BALLOT_CONFLICT");
    if (f) return f;
    throw err;
  }
}

/**
 * Board / counter write of a PAPER ballot (create or supersede). One
 * transaction, the lock order of every ballot write: voting row FOR SHARE
 * (status re-checked on the locked row; no deadline — a paper ballot
 * received in time may be entered after endsAt), then the ballot row FOR
 * UPDATE. A lost first-insert race maps to BALLOT_CONFLICT (409).
 * §14a ods. 7: paper beats electronic — the replaced e-ballot leaves a
 * `ballot_superseded` audit trace (its commitment only, no choices).
 */
export async function recordPaperBallot(input: {
  votingId: string;
  flatId: string;
  voterId: string;
  actorId: string;
  mandateId: string | null;
  marked: MarkedChoice[];
  ballotHash: string;
  photoUrls: string[];
}): Promise<
  | { ok: true; ballotId: string; recordedAt: Date; superseded: boolean }
  | CastFailure
> {
  const { votingId, flatId, voterId, marked, ballotHash } = input;
  const recordedAt = new Date();
  try {
    return await db.transaction(async (tx) => {
      await lockActiveVoting(tx, votingId, { enforceDeadline: false });
      const [existing] = await tx
        .select({ id: ballots.id, voteType: ballots.voteType, ballotHash: ballots.ballotHash })
        .from(ballots)
        .where(
          and(
            eq(ballots.votingId, votingId),
            eq(ballots.entityId, flatId),
            eq(ballots.ownerId, voterId)
          )
        )
        .limit(1)
        .for("update");

      const paperValues = {
        voteType: "paper" as const,
        recordedById: input.actorId,
        mandateId: input.mandateId || null,
        ballotHash,
        // A paper ballot replaces any electronic confirmation metadata.
        signature: null,
        confirmationKind: null,
        confirmedAt: null,
        recordedAt,
      };
      // Ownership frozen at cast time (results never move on a later ownership change).
      const snapshot = await ownershipSnapshot(tx, flatId, voterId);
      let bId: string;
      if (existing) {
        bId = existing.id;
        if (existing.voteType === "electronic") {
          await recordVotingEvent(tx, {
            votingId,
            kind: "ballot_superseded",
            actorId: input.actorId,
            payload: { ballotHash: existing.ballotHash, unitId: flatId, ownerId: voterId },
          });
        }
        await tx.update(ballots).set({ ...paperValues, ...snapshot }).where(eq(ballots.id, bId));
        await tx.delete(ballotItemVotes).where(eq(ballotItemVotes.ballotId, bId));
        await tx.delete(ballotPhotos).where(eq(ballotPhotos.ballotId, bId));
      } else {
        const [created] = await tx
          .insert(ballots)
          .values({ votingId, entityId: flatId, ownerId: voterId, ...paperValues, ...snapshot })
          .returning({ id: ballots.id });
        bId = created.id;
      }

      if (marked.length > 0) {
        await tx.insert(ballotItemVotes).values(
          marked.map((m) => ({
            ballotId: bId,
            itemId: m.itemId,
            choice: m.choice,
            itemAuditHash: computeItemAuditHash({
              votingId,
              itemId: m.itemId,
              entityId: flatId,
              ownerId: voterId,
              choice: m.choice,
              recordedAt,
            }),
          }))
        );
      }
      if (input.photoUrls.length > 0) {
        await tx.insert(ballotPhotos).values(
          input.photoUrls.map((url, idx) => ({ ballotId: bId, storageKey: url, idx }))
        );
      }
      return { ok: true as const, ballotId: bId, recordedAt, superseded: Boolean(existing) };
    });
  } catch (err) {
    const f = txFailure(err, "BALLOT_CONFLICT");
    if (f) return f;
    throw err;
  }
}

/** Human description of a ballot: voting title, unit number, items in ballot order. */
export async function describeBallot(
  votingId: string,
  flatId: string,
  marked: MarkedChoice[]
): Promise<{
  votingTitle: string;
  endsAt: Date;
  flatNumber: string;
  items: { idx: number; title: string; choice: VoteChoice }[];
}> {
  const [voting] = await db
    .select({ title: votings.title, endsAt: votings.endsAt })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  const [flat] = await db
    .select({ flatNumber: sql<string | null>`${entities.data}->>'flat_number'`, name: entities.name })
    .from(entities)
    .where(eq(entities.id, flatId))
    .limit(1);
  const itemRows = await db
    .select({ id: votingItems.id, idx: votingItems.idx, title: votingItems.title })
    .from(votingItems)
    .where(eq(votingItems.votingId, votingId))
    .orderBy(votingItems.idx);
  const byId = new Map(marked.map((m) => [m.itemId, m.choice]));
  return {
    votingTitle: voting?.title ?? "",
    endsAt: voting?.endsAt ?? new Date(0),
    flatNumber: flat?.flatNumber || flat?.name || "",
    items: itemRows
      .filter((i) => byId.has(i.id))
      .map((i) => ({ idx: i.idx, title: i.title, choice: byId.get(i.id)! })),
  };
}

/** Check that a verified token is bound to exactly this ballot. */
export function claimsMatch(
  claims: VoteConfirmClaims,
  expected: { voterId: string; votingId: string; flatId: string; ballotHash: string }
): boolean {
  return (
    claims.u === expected.voterId &&
    claims.v === expected.votingId &&
    claims.e === expected.flatId &&
    claims.d === expected.ballotHash
  );
}
