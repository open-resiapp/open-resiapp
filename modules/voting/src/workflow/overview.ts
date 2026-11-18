// BYT-20261118-002 §5 — management view for the board (step "Priebeh").
// Pure: no DB, no i18n. Uses the engine read-only; never re-implements
// thresholds (canStillPass asks calculateResults on a hypothetical ballot set).
import type { QuorumType, VoteChoice, VoteWithOwnership } from "@/types";
import { calculateResults, resolveUnitVote } from "../engine";
import type { Country } from "../rules";
import type { CanonicalVotingMethod } from "@/lib/voting-method";

export type UnitItemStatus =
  | "resolved_for"
  | "resolved_against"
  | "resolved_abstain"
  | "incomplete" // some co-owner has not cast a ballot yet
  | "no_valid_vote"; // no ballot, or the ballot(s) left this question unmarked
export type Channel = "electronic" | "paper" | "mixed" | "none";
export type PassOutlook = "passed" | "reachable" | "unreachable";

export interface OverviewEligible {
  unitId: string;
  unitLabel: string;
  ownerId: string;
  ownerName: string | null;
  /** Owner's weight for the voting method (participation.ts). */
  weight: number;
  unitShareNumerator: number | null;
  unitShareDenominator: number | null;
  area?: number | null;
  ownerUnitShareNumerator: number;
  ownerUnitShareDenominator: number;
  membershipWeight?: number;
}

export interface OverviewBallot {
  entityId: string;
  ownerId: string;
  ownerName: string | null;
  voteType: string;
  recordedAt: string;
  choices: { itemId: string; choice: string }[];
}

export interface OverviewInput {
  country: Country;
  votingMethod: CanonicalVotingMethod;
  totalPossibleWeight: number;
  items: { id: string; quorumType: QuorumType }[];
  eligible: OverviewEligible[];
  ballots: OverviewBallot[];
}

export interface OwnerLine {
  ownerId: string;
  ownerName: string | null;
  shareNumerator: number;
  shareDenominator: number;
  choice: VoteChoice | null;
  channel: "electronic" | "paper" | null;
  recordedAt: string | null;
}

export interface UnitLine {
  unitId: string;
  unitLabel: string;
  status: UnitItemStatus;
  channel: Channel;
  owners: OwnerLine[];
}

export interface ItemOverview {
  itemId: string;
  units: UnitLine[];
}

const RESOLVED: Record<VoteChoice, UnitItemStatus> = {
  za: "resolved_for",
  proti: "resolved_against",
  zdrzal_sa: "resolved_abstain",
};

function key(unitId: string, ownerId: string) {
  return `${unitId}:${ownerId}`;
}

function toVote(e: OverviewEligible | undefined, b: { entityId: string; ownerId: string; ownerName: string | null }, choice: VoteChoice): VoteWithOwnership {
  return {
    unitEntityId: b.entityId,
    userId: b.ownerId,
    userName: b.ownerName,
    choice,
    unitShareNumerator: e?.unitShareNumerator ?? 0,
    unitShareDenominator: e?.unitShareDenominator ?? 1,
    area: e?.area ?? null,
    ownerUnitShareNumerator: e?.ownerUnitShareNumerator ?? 1,
    ownerUnitShareDenominator: e?.ownerUnitShareDenominator ?? 1,
    membershipWeight: e?.membershipWeight ?? 1,
  };
}

/** Per item → per unit → per owner, with status and channel. */
export function buildOverview(input: OverviewInput): ItemOverview[] {
  const ballotByKey = new Map(input.ballots.map((b) => [key(b.entityId, b.ownerId), b]));
  const unitOrder: string[] = [];
  const ownersByUnit = new Map<string, OverviewEligible[]>();
  for (const e of input.eligible) {
    if (!ownersByUnit.has(e.unitId)) {
      ownersByUnit.set(e.unitId, []);
      unitOrder.push(e.unitId);
    }
    ownersByUnit.get(e.unitId)!.push(e);
  }

  return input.items.map((item) => {
    const units: UnitLine[] = unitOrder.map((unitId) => {
      const owners = ownersByUnit.get(unitId)!;
      const lines: OwnerLine[] = owners.map((o) => {
        const b = ballotByKey.get(key(unitId, o.ownerId));
        const c = b?.choices.find((x) => x.itemId === item.id);
        return {
          ownerId: o.ownerId,
          ownerName: o.ownerName,
          shareNumerator: o.ownerUnitShareNumerator,
          shareDenominator: o.ownerUnitShareDenominator,
          choice: (c?.choice as VoteChoice | undefined) ?? null,
          channel: b ? (b.voteType === "paper" ? "paper" : "electronic") : null,
          recordedAt: b?.recordedAt ?? null,
        };
      });
      const channels = new Set(lines.map((l) => l.channel).filter(Boolean));
      const channel: Channel =
        channels.size === 0 ? "none" : channels.size > 1 ? "mixed" : (Array.from(channels)[0] as Channel);
      const expressed = lines.filter((l) => l.choice !== null);
      let status: UnitItemStatus;
      if (expressed.length === 0) status = "no_valid_vote";
      else if (lines.some((l) => l.channel === null)) status = "incomplete";
      else {
        const r = resolveUnitVote(
          expressed.map((l) => {
            const e = owners.find((o) => o.ownerId === l.ownerId);
            return toVote(e, { entityId: unitId, ownerId: l.ownerId, ownerName: l.ownerName }, l.choice!);
          }),
          input.votingMethod
        );
        status = RESOLVED[r.resolved];
      }
      return { unitId, unitLabel: owners[0].unitLabel, status, channel, owners: lines };
    });
    return { itemId: item.id, units };
  });
}

export interface ChannelSplit {
  itemId: string;
  electronic: number;
  paper: number;
  /** electronic + paper — the cast weight of this question. */
  cast: number;
}

/** Raw cast weight per channel (turnout by channel, not the binding tally). */
export function splitByChannel(input: OverviewInput): ChannelSplit[] {
  const weightByKey = new Map(input.eligible.map((e) => [key(e.unitId, e.ownerId), e.weight]));
  return input.items.map((item) => {
    let electronic = 0;
    let paper = 0;
    for (const b of input.ballots) {
      if (!b.choices.some((c) => c.itemId === item.id)) continue;
      const w = weightByKey.get(key(b.entityId, b.ownerId)) ?? 0;
      if (b.voteType === "paper") paper += w;
      else electronic += w;
    }
    return { itemId: item.id, electronic, paper, cast: electronic + paper };
  });
}

/**
 * "passed" ⇔ the engine passes on the actual ballots; otherwise "reachable"
 * ⇔ the engine passes when every owner WITHOUT a ballot votes ZA;
 * else "unreachable".
 */
export function canStillPass(input: OverviewInput): Record<string, PassOutlook> {
  const eligibleByKey = new Map(input.eligible.map((e) => [key(e.unitId, e.ownerId), e]));
  const voted = new Set(input.ballots.map((b) => key(b.entityId, b.ownerId)));
  const out: Record<string, PassOutlook> = {};
  for (const item of input.items) {
    const actual: VoteWithOwnership[] = [];
    for (const b of input.ballots) {
      const c = b.choices.find((x) => x.itemId === item.id);
      if (!c) continue;
      actual.push(toVote(eligibleByKey.get(key(b.entityId, b.ownerId)), b, c.choice as VoteChoice));
    }
    const run = (votes: VoteWithOwnership[]) =>
      calculateResults(votes, input.votingMethod, item.quorumType, input.totalPossibleWeight, {
        country: input.country,
      }).passed;
    if (run(actual)) {
      out[item.id] = "passed";
      continue;
    }
    const hypothetical = [...actual];
    for (const e of input.eligible) {
      if (voted.has(key(e.unitId, e.ownerId))) continue;
      hypothetical.push(toVote(e, { entityId: e.unitId, ownerId: e.ownerId, ownerName: e.ownerName }, "za"));
    }
    out[item.id] = run(hypothetical) ? "reachable" : "unreachable";
  }
  return out;
}
