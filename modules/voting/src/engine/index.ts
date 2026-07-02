import { createHash } from "crypto";

import type {
  MemberResolution,
  QuorumType,
  UnitResolution,
  UnitResolutionBreakdownEntry,
  UnitResolutionRationale,
  VoteChoice,
  VoteWithOwnership,
  VoteWithShare,
  VotingItemResult,
  VotingMethod,
  VotingResults,
} from "@/types";
import {
  ZERO,
  add,
  compare,
  mul,
  rational,
  type Rational,
} from "@/lib/rational";
import {
  computeMemberWeight,
  computeUnitWeight,
  isUnitScoped,
  normalizeVotingMethod,
} from "@/lib/voting-method";
import { getVotingRules, type Country, type CountryVotingRules } from "../rules";
import type { CanonicalVotingMethod } from "@/lib/voting-method";

// ── Public entry point ────────────────────────────────────

export interface CalculateResultsOptions {
  country?: Country;
  totalFlats?: number;
}

/**
 * BYT-20260511-001 entry point. Accepts one row per (voter, unit) with full
 * ownership context. Groups by unit, resolves co-owner disagreements per
 * §14 ods. 4 zák. 182/1993 Z.z. (one vote per unit, majority of shares
 * settles internal disputes, ties → unit abstains), and aggregates.
 */
export function calculateResults(
  votes: VoteWithOwnership[],
  method: VotingMethod = "weighted_by_share",
  quorumType: QuorumType = "simple_all",
  totalPossibleWeight: number = 0,
  options: CalculateResultsOptions = {}
): VotingResults {
  const { country = "sk" } = options;
  const rules = getVotingRules(country);
  const canonical = normalizeVotingMethod(method);

  // Phase 3b: member-scoped methods (one_per_member, custom_weight)
  // bypass §14 ods. 4 co-owner resolution. Each active membership
  // casts one independently-weighted vote.
  if (!isUnitScoped(canonical)) {
    return calculateMemberScopedResults(
      votes,
      canonical,
      quorumType,
      totalPossibleWeight,
      rules
    );
  }

  // 1. Group by unit.
  const byUnit = new Map<string, VoteWithOwnership[]>();
  for (const v of votes) {
    const slot = byUnit.get(v.unitEntityId) ?? [];
    slot.push(v);
    byUnit.set(v.unitEntityId, slot);
  }

  // 2. Resolve each unit.
  const unitBreakdowns: UnitResolution[] = [];
  for (const slot of byUnit.values()) {
    unitBreakdowns.push(resolveUnitVote(slot, canonical));
  }

  // 3. Sum unit-weighted contributions.
  let zaWeight = 0;
  let protiWeight = 0;
  let zdrzalSaWeight = 0;
  let totalWeight = 0;

  for (const u of unitBreakdowns) {
    const w = u.unitWeight;
    totalWeight += w;
    switch (u.resolved) {
      case "za":
        zaWeight += w;
        break;
      case "proti":
        protiWeight += w;
        break;
      case "zdrzal_sa":
        zdrzalSaWeight += w;
        break;
    }
  }

  // 4. CZ per rollam: silence = nesúhlas (non-voters count as "proti").
  if (rules.silenceIsNo && totalPossibleWeight > 0) {
    const nonVotedWeight = totalPossibleWeight - totalWeight;
    if (nonVotedWeight > 0) {
      protiWeight += nonVotedWeight;
      totalWeight = totalPossibleWeight;
    }
  }

  // 5. Apply quorum.
  let passed = false;
  let quorumReached = false;
  switch (quorumType) {
    case "simple_present":
      quorumReached = totalWeight > 0;
      passed = zaWeight > totalWeight / 2;
      break;
    case "simple_all":
      quorumReached = totalPossibleWeight > 0 && zaWeight > totalPossibleWeight / 2;
      passed = quorumReached;
      break;
    case "two_thirds_all":
      quorumReached =
        totalPossibleWeight > 0 && zaWeight >= (totalPossibleWeight * 2) / 3;
      passed = quorumReached;
      break;
    case "all_unanimous":
      quorumReached = totalPossibleWeight > 0 && zaWeight === totalPossibleWeight;
      passed = quorumReached;
      break;
  }

  return {
    za: zaWeight,
    proti: protiWeight,
    zdrzalSa: zdrzalSaWeight,
    total: totalWeight,
    zaPercent: totalWeight > 0 ? (zaWeight / totalWeight) * 100 : 0,
    protiPercent: totalWeight > 0 ? (protiWeight / totalWeight) * 100 : 0,
    zdrzalSaPercent: totalWeight > 0 ? (zdrzalSaWeight / totalWeight) * 100 : 0,
    passed,
    quorumReached,
    quorumType,
    totalPossibleWeight,
    unitBreakdowns,
  };
}

// ── Member-scoped resolution (Phase 3b) ──────────────────

/**
 * BYT-20260515-001 Phase 3b: member-scoped tally.
 *
 * Used by `one_per_member` and `custom_weight` voting modes. No unit
 * grouping — each active membership casts exactly one vote weighted
 * by `computeMemberWeight()`. If a member appears in `votes` more than
 * once (paper/electronic double entry, replays), the latest row by
 * insertion order wins.
 */
function calculateMemberScopedResults(
  votes: VoteWithOwnership[],
  method: CanonicalVotingMethod,
  quorumType: QuorumType,
  totalPossibleWeight: number,
  rules: CountryVotingRules
): VotingResults {
  // Last-write-wins per voter.
  const byVoter = new Map<string, VoteWithOwnership>();
  for (const v of votes) byVoter.set(v.userId, v);

  let zaWeight = 0;
  let protiWeight = 0;
  let zdrzalSaWeight = 0;
  let totalWeight = 0;
  const memberBreakdowns: MemberResolution[] = [];

  for (const v of byVoter.values()) {
    const weight = computeMemberWeight(
      { membershipWeight: v.membershipWeight ?? 1 },
      method
    );
    totalWeight += weight;
    switch (v.choice) {
      case "za":
        zaWeight += weight;
        break;
      case "proti":
        protiWeight += weight;
        break;
      case "zdrzal_sa":
        zdrzalSaWeight += weight;
        break;
    }
    memberBreakdowns.push({
      userId: v.userId,
      userName: v.userName,
      choice: v.choice,
      weight,
    });
  }

  // CZ per rollam: silence counts as opposition.
  if (rules.silenceIsNo && totalPossibleWeight > 0) {
    const nonVoted = totalPossibleWeight - totalWeight;
    if (nonVoted > 0) {
      protiWeight += nonVoted;
      totalWeight = totalPossibleWeight;
    }
  }

  // Same quorum types as unit-scoped.
  let passed = false;
  let quorumReached = false;
  switch (quorumType) {
    case "simple_present":
      quorumReached = totalWeight > 0;
      passed = zaWeight > totalWeight / 2;
      break;
    case "simple_all":
      quorumReached =
        totalPossibleWeight > 0 && zaWeight > totalPossibleWeight / 2;
      passed = quorumReached;
      break;
    case "two_thirds_all":
      quorumReached =
        totalPossibleWeight > 0 && zaWeight >= (totalPossibleWeight * 2) / 3;
      passed = quorumReached;
      break;
    case "all_unanimous":
      quorumReached =
        totalPossibleWeight > 0 && zaWeight === totalPossibleWeight;
      passed = quorumReached;
      break;
  }

  return {
    za: zaWeight,
    proti: protiWeight,
    zdrzalSa: zdrzalSaWeight,
    total: totalWeight,
    zaPercent: totalWeight > 0 ? (zaWeight / totalWeight) * 100 : 0,
    protiPercent: totalWeight > 0 ? (protiWeight / totalWeight) * 100 : 0,
    zdrzalSaPercent: totalWeight > 0 ? (zdrzalSaWeight / totalWeight) * 100 : 0,
    passed,
    quorumReached,
    quorumType,
    totalPossibleWeight,
    memberBreakdowns,
  };
}

// ── Per-unit resolution ──────────────────────────────────

/**
 * Resolve a single unit's vote from its co-owners' expressed choices.
 *
 * Algorithm (matches §14 ods. 4 + §139 ods. 2 OZ):
 *  1. Single owner → that's the unit's vote.
 *  2. All co-owners unanimous → that choice.
 *  3. Majority of expressed unit-shares → that choice.
 *  4. Tie among top choices → ZDRŽAL SA.
 *  5. Less than 100% expressed → still resolved on expressed shares
 *     (a non-voting co-owner does not block the rest from forming a vote).
 *
 * All comparisons run in exact rational arithmetic so 1/2 vs 1/2 is detected
 * as a true tie regardless of denominators.
 */
export function resolveUnitVote(
  votes: VoteWithOwnership[],
  method: VotingMethod
): UnitResolution {
  if (votes.length === 0) {
    throw new Error("resolveUnitVote: empty votes");
  }
  const first = votes[0];
  const unitWeight = getUnitWeight(first, method);

  const breakdown: UnitResolutionBreakdownEntry[] = votes.map((v) => ({
    userId: v.userId,
    userName: v.userName,
    choice: v.choice,
    ownerShareNumerator: v.ownerUnitShareNumerator,
    ownerShareDenominator: v.ownerUnitShareDenominator,
  }));

  const hasMultipleOwners = votes.length > 1;

  if (votes.length === 1) {
    return {
      unitEntityId: first.unitEntityId,
      resolved: first.choice,
      rationale: "single_owner",
      breakdown,
      unitWeight,
      hasMultipleOwners,
    };
  }

  // Sum shares by choice.
  const sums: Record<VoteChoice, Rational> = {
    za: ZERO,
    proti: ZERO,
    zdrzal_sa: ZERO,
  };
  for (const v of votes) {
    const share = rational(v.ownerUnitShareNumerator, v.ownerUnitShareDenominator);
    sums[v.choice] = add(sums[v.choice], share);
  }

  // Identify the max share among present choices.
  const entries: Array<[VoteChoice, Rational]> = (
    Object.entries(sums) as Array<[VoteChoice, Rational]>
  ).filter(([, r]) => r.num !== 0n);
  if (entries.length === 0) {
    // Should never happen — vote rows imply at least one choice.
    return {
      unitEntityId: first.unitEntityId,
      resolved: "zdrzal_sa",
      rationale: "no_quorum_within_unit",
      breakdown,
      unitWeight,
      hasMultipleOwners,
    };
  }

  entries.sort((a, b) => compare(b[1], a[1]));
  const topShare = entries[0][1];
  const tiedAtTop = entries.filter(([, r]) => compare(r, topShare) === 0);

  if (tiedAtTop.length > 1) {
    return {
      unitEntityId: first.unitEntityId,
      resolved: "zdrzal_sa",
      rationale: "tie_abstain",
      breakdown,
      unitWeight,
      hasMultipleOwners,
    };
  }

  const resolved = entries[0][0];
  const rationale: UnitResolutionRationale =
    entries.length === 1 ? "unanimous" : "majority_share";

  return {
    unitEntityId: first.unitEntityId,
    resolved,
    rationale,
    breakdown,
    unitWeight,
    hasMultipleOwners,
  };
}

function getUnitWeight(v: VoteWithOwnership, method: VotingMethod): number {
  return computeUnitWeight(
    {
      shareNumerator: v.unitShareNumerator,
      shareDenominator: v.unitShareDenominator,
      area: v.area,
    },
    normalizeVotingMethod(method)
  );
}

// ── Legacy / single-owner aggregation helpers ─────────────

/**
 * Pre-existing helper retained for the case where one user owns several
 * single-owner units and the caller wants their combined share displayed.
 *
 * For multi-owner unit handling, prefer feeding raw VoteWithOwnership rows
 * to `calculateResults` so the engine groups by unit and applies the
 * §14 ods. 4 resolution rules.
 */
export function aggregateFlatsForVoter(
  choice: VoteChoice,
  voterFlats: { shareNumerator: number; shareDenominator: number; area: number | null }[]
): VoteWithShare {
  if (voterFlats.length === 0) {
    return { choice, shareNumerator: 0, shareDenominator: 1, area: null };
  }
  let acc: Rational = ZERO;
  for (const f of voterFlats) {
    acc = add(acc, rational(f.shareNumerator, f.shareDenominator));
  }
  const totalArea = voterFlats.reduce((sum, f) => sum + (f.area ?? 0), 0);
  return {
    choice,
    shareNumerator: Number(acc.num),
    shareDenominator: Number(acc.den),
    area: totalArea > 0 ? totalArea : null,
  };
}

// Suppress an `unused import` warning while keeping `mul` exported-by-rational
// available to any future consumer of this module's internals.
void mul;

// ── Multi-item ballots (BYT-20260609-008) ─────────────────
//
// Per-item resolution + secretless hashing (Option B). The canonical forms
// below MUST match migration 0046 byte-for-byte (both use UTF-8 sha256 hex):
//
//   ballotHash    = sha256( JCS([{itemId, choice}] sorted by itemId) )
//   itemAuditHash = sha256( votingId|itemId|entityId|ownerId|choice|recordedAtISO )
//
// These take NO NEXTAUTH_SECRET (unlike the dropped legacy generateAuditHash)
// so the audit bundle can be verified without server state (docs/domain/voting.md).

/**
 * Commitment over an owner's full set of item choices. Canonicalised as a
 * JSON array sorted by itemId, each element `{"choice":…,"itemId":…}` with
 * keys in lexicographic order and no whitespace — the whole set is what the
 * single signature (passkey/email/paper) binds.
 */
export function computeBallotHash(
  items: { itemId: string; choice: VoteChoice }[]
): string {
  const canonical =
    "[" +
    [...items]
      .sort((a, b) =>
        a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0
      )
      .map(
        (i) =>
          `{"choice":${JSON.stringify(i.choice)},"itemId":${JSON.stringify(
            i.itemId
          )}}`
      )
      .join(",") +
    "]";
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Secretless per-item audit leaf. `recordedAt` is serialised via
 * `Date.toISOString()` (ISO-8601 UTC, millisecond precision) to match the
 * migration's `to_char(..., 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`.
 */
export function computeItemAuditHash(input: {
  votingId: string;
  itemId: string;
  entityId: string;
  ownerId: string;
  choice: VoteChoice;
  recordedAt: Date;
}): string {
  const data = [
    input.votingId,
    input.itemId,
    input.entityId,
    input.ownerId,
    input.choice,
    input.recordedAt.toISOString(),
  ].join("|");
  return createHash("sha256").update(data, "utf8").digest("hex");
}

/**
 * Resolve a multi-item voting: run the existing per-share / member-scoped
 * engine independently for each item, using that item's own quorumType.
 * Returns one VotingItemResult per item — there is no voting-level pass/fail.
 *
 * `votesByItem` maps itemId → the VoteWithOwnership rows cast for that item.
 * Items absent from the map resolve on an empty vote set (no votes cast).
 * The core `calculateResults` is reused unchanged, so a single-item voting
 * produces byte-identical results to the legacy single-question path
 * (guarded by scripts/voting-golden-check.ts).
 */
export function calculateItemResults(
  items: { id: string; quorumType: QuorumType }[],
  votesByItem: Map<string, VoteWithOwnership[]>,
  method: VotingMethod = "weighted_by_share",
  totalPossibleWeight: number = 0,
  options: CalculateResultsOptions = {}
): VotingItemResult[] {
  return items.map((item) => {
    const result = calculateResults(
      votesByItem.get(item.id) ?? [],
      method,
      item.quorumType,
      totalPossibleWeight,
      options
    );
    return { ...result, itemId: item.id };
  });
}
