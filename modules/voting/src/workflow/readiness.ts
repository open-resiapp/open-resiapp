// BYT-20261118-002 §8 — "Čo dnes prejde elektronicky" (e-vote readiness).
// Pure: no DB, no i18n; codes + numbers only. For each majority type a
// written vote can use, it builds the hypothetical ballot set "every e-ready
// owner votes ZA" and asks the ENGINE whether it passes — thresholds are
// never re-implemented here.
import type { QuorumType, VoteWithOwnership } from "@/types";
import { calculateResults } from "../engine";
import {
  getAvailableQuorumTypes,
  isElectronicVotingBlocked,
  type Country,
} from "../rules";
import {
  computeMemberWeight,
  computeUnitWeight,
  isUnitScoped,
  type CanonicalVotingMethod,
} from "@/lib/voting-method";

export type ReadinessCode = "REACHABLE" | "NOT_REACHABLE" | "ELECTRONIC_BLOCKED" | "NO_OWNERS";

export interface ReadinessRow {
  quorumType: QuorumType;
  code: ReadinessCode;
  /** Weight the e-ready owners can bring (engine-resolved, conservative per unit). */
  readyWeight: number;
  /** Weight the quorum is measured against (all owners). */
  totalWeight: number;
  readyOwners: number;
  totalOwners: number;
}

export interface ReadinessOwner {
  unitId: string;
  ownerId: string;
  hasEVoteIdentity: boolean;
  unitShareNumerator: number;
  unitShareDenominator: number;
  area: number | null;
  ownerUnitShareNumerator: number;
  ownerUnitShareDenominator: number;
  membershipWeight: number;
}

export interface ReadinessInput {
  country: Country;
  votingMethod: CanonicalVotingMethod;
  owners: ReadinessOwner[];
  /** Board-initiated by default; owners_quarter blocks e-voting in SK. */
  initiatedBy?: "board" | "owners_quarter";
}

/**
 * Majority types evaluated: the written-vote types except `simple_present`
 * (measured against participants, so always "reachable" — meaningless here).
 */
export function readinessQuorumTypes(country: Country): QuorumType[] {
  return getAvailableQuorumTypes(country, "written").filter((q) => q !== "simple_present");
}

export function computeEVoteReadiness(input: ReadinessInput): ReadinessRow[] {
  const { country, votingMethod, owners } = input;
  const types = readinessQuorumTypes(country);
  const unitScoped = isUnitScoped(votingMethod);

  // Total weight: each unit once (unit-scoped) or each membership (member-scoped).
  let totalWeight = 0;
  const seenUnits = new Set<string>();
  for (const o of owners) {
    if (unitScoped) {
      if (seenUnits.has(o.unitId)) continue;
      seenUnits.add(o.unitId);
      totalWeight += computeUnitWeight(
        {
          shareNumerator: o.unitShareNumerator,
          shareDenominator: o.unitShareDenominator,
          area: o.area,
        },
        votingMethod
      );
    } else {
      totalWeight += computeMemberWeight({ membershipWeight: o.membershipWeight }, votingMethod);
    }
  }
  const totalOwners = new Set(owners.map((o) => o.ownerId)).size;
  const readyOwners = new Set(owners.filter((o) => o.hasEVoteIdentity).map((o) => o.ownerId)).size;

  const blocked = isElectronicVotingBlocked(country, "written", input.initiatedBy ?? "board");
  if (owners.length === 0 || blocked) {
    return types.map((q) => ({
      quorumType: q,
      code: owners.length === 0 ? "NO_OWNERS" : "ELECTRONIC_BLOCKED",
      readyWeight: 0,
      totalWeight,
      readyOwners,
      totalOwners,
    }));
  }

  // Conservative unit rule: the engine resolves a unit on the shares that
  // were expressed, so one e-ready 1/2 co-owner would carry the unit alone.
  // For a forecast we count a unit only when its e-ready co-owners hold a
  // strict majority of the unit (the others could otherwise tie / outvote).
  const readyVotes: VoteWithOwnership[] = [];
  if (unitScoped) {
    const byUnit = new Map<string, ReadinessOwner[]>();
    for (const o of owners) {
      const slot = byUnit.get(o.unitId) ?? [];
      slot.push(o);
      byUnit.set(o.unitId, slot);
    }
    for (const slot of byUnit.values()) {
      const ready = slot.filter((o) => o.hasEVoteIdentity);
      const readyShare = ready.reduce(
        (s, o) => s + o.ownerUnitShareNumerator / (o.ownerUnitShareDenominator || 1),
        0
      );
      if (readyShare <= 0.5 + 1e-12) continue;
      for (const o of ready) readyVotes.push(toVote(o));
    }
  } else {
    for (const o of owners) if (o.hasEVoteIdentity) readyVotes.push(toVote(o));
  }

  return types.map((q) => {
    const r = calculateResults(readyVotes, votingMethod, q, totalWeight, { country });
    return {
      quorumType: q,
      code: r.passed ? "REACHABLE" : "NOT_REACHABLE",
      readyWeight: r.za,
      totalWeight,
      readyOwners,
      totalOwners,
    };
  });
}

function toVote(o: ReadinessOwner): VoteWithOwnership {
  return {
    unitEntityId: o.unitId,
    userId: o.ownerId,
    userName: null,
    choice: "za",
    unitShareNumerator: o.unitShareNumerator,
    unitShareDenominator: o.unitShareDenominator,
    area: o.area,
    ownerUnitShareNumerator: o.ownerUnitShareNumerator,
    ownerUnitShareDenominator: o.ownerUnitShareDenominator,
    membershipWeight: o.membershipWeight,
  };
}
