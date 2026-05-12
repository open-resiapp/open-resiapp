import { createHash } from "crypto";

import type {
  QuorumType,
  UnitResolution,
  UnitResolutionBreakdownEntry,
  UnitResolutionRationale,
  VoteChoice,
  VoteWithOwnership,
  VoteWithShare,
  VotingMethod,
  VotingResults,
} from "@/types";
import {
  ZERO,
  add,
  compare,
  mul,
  rational,
  toFloat,
  type Rational,
} from "@/lib/rational";
import { getVotingRules, type Country } from "../rules";

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
  method: VotingMethod = "per_share",
  quorumType: QuorumType = "simple_all",
  totalPossibleWeight: number = 0,
  options: CalculateResultsOptions = {}
): VotingResults {
  const { country = "sk" } = options;
  const rules = getVotingRules(country);

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
    unitBreakdowns.push(resolveUnitVote(slot, method));
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
  switch (method) {
    case "per_flat":
      return 1;
    case "per_area":
      return v.area ?? 1;
    case "per_share":
    default:
      return toFloat(rational(v.unitShareNumerator, v.unitShareDenominator));
  }
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

// ── Audit hashing (unchanged) ─────────────────────────────

export function generateAuditHash(
  votingId: string,
  ownerId: string,
  flatId: string,
  choice: string,
  timestamp: Date
): string {
  const secret = process.env.NEXTAUTH_SECRET || "";
  const data = `${votingId}${ownerId}${flatId}${choice}${timestamp.toISOString()}${secret}`;
  return createHash("sha256").update(data).digest("hex");
}
