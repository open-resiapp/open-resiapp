import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships } from "@/db/schema";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { hasPermission } from "@/lib/permissions";
import { McpError, validationError } from "@/lib/mcp/errors";
import type { Viewer } from "@/lib/mcp/principal";
import type { Country, UserRole, VoteChoice } from "@/types";
import { votings, votingItems, ballots, ballotItemVotes, ballotPhotos } from "./db/schema";
import { computeBallotHash, computeItemAuditHash } from "./engine";
import { isElectronicVotingBlocked } from "./rules";

// Ballot cast, split in two (BYT-20261117-001 §3/§6):
//   1. validateBallotCast — every rule (permission, voting active, electronic
//      allowed, ownership, scope, items/choices) + the ballot hash. Writes
//      nothing, so the MCP path can show the ballot and send a confirmation
//      email before anything is stored.
//   2. persistConfirmedBallot — the write (upsert-supersede), unchanged from
//      the original POST /api/ballots transaction.
// After the merge with BYT-20261117-002 Phase 6, electronic ballots are
// written only by routes/api/ballots/cast.server.ts `recordConfirmedBallot`
// (web passkey / e-mail link, and the MCP email-link confirm via
// pending-ballots.ts). persistConfirmedBallot refuses an electronic ballot
// without a confirmation kind — a session alone never records a vote.

export const VALID_CHOICES: VoteChoice[] = ["za", "proti", "zdrzal_sa"];

export interface IncomingItemChoice {
  itemId?: unknown;
  choice?: unknown;
}

export interface BallotCastInput {
  votingId: string;
  unitId: string;
  items: IncomingItemChoice[];
  /**
   * Paper ballot recorded by a vote counter / admin on behalf of `ownerId`.
   * Omitted = electronic ballot cast by the actor themself.
   */
  paper?: { ownerId: string };
  /**
   * Require an active OWNER membership on the unit (MCP ballot path). The
   * web route keeps its historical "any active membership" rule.
   */
  requireOwnerMembership?: boolean;
}

export interface ValidatedBallot {
  voting: typeof votings.$inferSelect;
  votingId: string;
  unitId: string;
  ownerId: string;
  voteType: "electronic" | "paper";
  marked: { itemId: string; choice: VoteChoice }[];
  ballotHash: string;
}

/**
 * Validates a ballot without writing. Throws McpError:
 *   forbidden (details.kind = "paper" | "electronic"), not_found,
 *   voting_not_active, electronic_blocked (details.reason = "meeting" |
 *   "owners_quarter"), not_unit_owner, unit_out_of_scope,
 *   validation.itemId, validation.choice, validation.items (duplicate).
 */
export async function validateBallotCast(
  actor: Viewer,
  input: BallotCastInput
): Promise<ValidatedBallot> {
  const isPaper = Boolean(input.paper);
  const voterId = input.paper ? input.paper.ownerId : actor.userId;

  // Permission.
  if (isPaper) {
    if (!hasPermission(actor.role as UserRole, "recordPaperVote")) {
      throw new McpError("forbidden", { kind: "paper" });
    }
  } else if (!hasPermission(actor.role as UserRole, "vote")) {
    throw new McpError("forbidden", { kind: "electronic" });
  }

  const [voting] = await db
    .select()
    .from(votings)
    .where(eq(votings.id, input.votingId))
    .limit(1);
  if (!voting || voting.status !== "active") {
    throw new McpError("voting_not_active", { exists: Boolean(voting) });
  }

  const root = await getCommunityRoot();
  const country = (root?.country ?? "sk") as Country;
  if (
    !isPaper &&
    isElectronicVotingBlocked(country, voting.votingType, voting.initiatedBy)
  ) {
    throw new McpError("electronic_blocked", {
      reason: voting.votingType === "meeting" ? "meeting" : "owners_quarter",
    });
  }

  // Ownership: the voter must hold an active membership on the unit.
  const ownershipConds = [
    eq(memberships.userId, voterId),
    eq(memberships.entityId, input.unitId),
    eq(memberships.status, "active"),
  ];
  if (input.requireOwnerMembership) {
    ownershipConds.push(eq(memberships.role, "owner"));
  }
  const [ownerFlat] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(and(...ownershipConds))
    .limit(1);
  if (!ownerFlat) throw new McpError("not_unit_owner");

  // Scope: the unit must sit within the voting's subtree.
  if (voting.entityId) {
    const [flatRow] = await db
      .select({ flatPath: entities.path })
      .from(entities)
      .where(eq(entities.id, input.unitId))
      .limit(1);
    const [scopeRow] = await db
      .select({ scopePath: entities.path })
      .from(entities)
      .where(eq(entities.id, voting.entityId))
      .limit(1);
    if (flatRow && scopeRow && !flatRow.flatPath.startsWith(scopeRow.scopePath)) {
      throw new McpError("unit_out_of_scope");
    }
  }

  // Validate item choices against this voting's items. Unmarked items are
  // allowed (silence/abstain per jurisdiction rule) — no ballot_item_vote row.
  const items = await db
    .select({ id: votingItems.id })
    .from(votingItems)
    .where(eq(votingItems.votingId, input.votingId));
  const validItemIds = new Set(items.map((i) => i.id));

  const marked: { itemId: string; choice: VoteChoice }[] = [];
  const seen = new Set<string>();
  for (const it of input.items) {
    const itemId = typeof it.itemId === "string" ? it.itemId : "";
    const choice = it.choice as VoteChoice;
    if (!itemId || !validItemIds.has(itemId)) throw validationError("itemId");
    if (!VALID_CHOICES.includes(choice)) throw validationError("choice");
    if (seen.has(itemId)) {
      throw validationError("items", { reason: "duplicate_item" });
    }
    seen.add(itemId);
    marked.push({ itemId, choice });
  }

  return {
    voting,
    votingId: input.votingId,
    unitId: input.unitId,
    ownerId: voterId,
    voteType: isPaper ? "paper" : "electronic",
    marked,
    ballotHash: computeBallotHash(marked),
  };
}

export interface PersistBallotOptions {
  /** Paper ballots: the recorder (vote counter / admin). */
  recordedById?: string | null;
  mandateId?: string | null;
  photoUrls?: string[];
  /**
   * How the owner actively confirmed the ballot. Only the email-link
   * confirm route (MCP path, §6) sets 'email'; omitted = no confirmation
   * step (legacy web cast / paper) → stored as NULL.
   */
  confirmationKind?: "email" | null;
}

export interface PersistedBallot {
  ballotId: string;
  ballotHash: string;
  recordedAt: Date;
  superseded: boolean;
}

/**
 * Writes a validated ballot. A re-submitted ballot for the same (voting,
 * unit, owner) supersedes (not appends) the prior one. Callers MUST have run
 * `validateBallotCast` (MCP: re-run it at confirm time — state may change).
 */
export async function persistConfirmedBallot(
  v: ValidatedBallot,
  opts: PersistBallotOptions = {}
): Promise<PersistedBallot> {
  const isPaper = v.voteType === "paper";
  if (!isPaper && !opts.confirmationKind) {
    // docs/domain/voting.md: never on an authenticated session alone.
    throw new McpError("forbidden", { kind: "electronic", reason: "confirmation_required" });
  }
  const recordedAt = new Date();
  const confirmedAt = opts.confirmationKind ? recordedAt : null;
  const photoUrls = opts.photoUrls ?? [];

  const [existing] = await db
    .select({ id: ballots.id })
    .from(ballots)
    .where(
      and(
        eq(ballots.votingId, v.votingId),
        eq(ballots.entityId, v.unitId),
        eq(ballots.ownerId, v.ownerId)
      )
    )
    .limit(1);

  const ballotId = await db.transaction(async (tx) => {
    let bId: string;
    if (existing) {
      bId = existing.id;
      await tx
        .update(ballots)
        .set({
          voteType: v.voteType,
          recordedById: isPaper ? opts.recordedById ?? null : null,
          mandateId: opts.mandateId || null,
          ballotHash: v.ballotHash,
          confirmationKind: opts.confirmationKind ?? null,
          confirmedAt,
          recordedAt,
        })
        .where(eq(ballots.id, bId));
      await tx.delete(ballotItemVotes).where(eq(ballotItemVotes.ballotId, bId));
      await tx.delete(ballotPhotos).where(eq(ballotPhotos.ballotId, bId));
    } else {
      const [created] = await tx
        .insert(ballots)
        .values({
          votingId: v.votingId,
          entityId: v.unitId,
          ownerId: v.ownerId,
          voteType: v.voteType,
          recordedById: isPaper ? opts.recordedById ?? null : null,
          mandateId: opts.mandateId || null,
          ballotHash: v.ballotHash,
          confirmationKind: opts.confirmationKind ?? null,
          confirmedAt,
          recordedAt,
        })
        .returning({ id: ballots.id });
      bId = created.id;
    }

    if (v.marked.length > 0) {
      await tx.insert(ballotItemVotes).values(
        v.marked.map((m) => ({
          ballotId: bId,
          itemId: m.itemId,
          choice: m.choice,
          itemAuditHash: computeItemAuditHash({
            votingId: v.votingId,
            itemId: m.itemId,
            entityId: v.unitId,
            ownerId: v.ownerId,
            choice: m.choice,
            recordedAt,
          }),
        }))
      );
    }

    if (photoUrls.length > 0) {
      await tx.insert(ballotPhotos).values(
        photoUrls.map((url, idx) => ({ ballotId: bId, storageKey: url, idx }))
      );
    }

    return bId;
  });

  return {
    ballotId,
    ballotHash: v.ballotHash,
    recordedAt,
    superseded: Boolean(existing),
  };
}
