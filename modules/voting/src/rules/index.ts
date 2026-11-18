import type { QuorumType } from "@/types";

export type Country = "sk" | "cz";

export interface CountryVotingRules {
  // Per rollam
  perRollamMinDays: number | null;
  silenceIsNo: boolean;

  // Fallback quorum (náhradná schôdza / náhradné zhromaždenie)
  fallbackQuorum: number;

  // Meeting quorum: share of ALL votes the owners present must hold (strictly
  // more than) for the meeting to decide at all. SK: none — §14b ods. 4 is
  // measured against those present. CZ §1206 ods. 2: majority of all votes.
  // TODO(decision): CZ §1210 náhradní shromáždění (fallbackQuorum 0.4) — no
  // substitute-meeting flag exists on votings yet, so it is not applied.
  meetingQuorumShare: number | null;

  // E-voting restrictions
  ownersQuarterBlocksElectronic: boolean;
  meetingBlocksElectronic: boolean;

  // Repeated vote escalation (SK only)
  repeatedVoteEscalation: boolean;

  // §14b ods. 4 (SK): "majority of owners present at the meeting OR who took
  // part in the written vote" — simple_present is valid for written votes.
  // CZ per rollam (§1211 OZ) counts against all owners, so it is not.
  simplePresentInWritten: boolean;

  // Available quorum types (directly selectable). Escalated types reachable
  // only through a repeated vote (four_fifths_all) are NOT listed here.
  availableQuorumTypes: QuorumType[];
}

const SK_RULES: CountryVotingRules = {
  perRollamMinDays: null,
  silenceIsNo: false,
  fallbackQuorum: 0.5,
  meetingQuorumShare: null,
  ownersQuarterBlocksElectronic: true,
  meetingBlocksElectronic: true,
  repeatedVoteEscalation: true,
  simplePresentInWritten: true,
  // all_unanimous: §14b ods. 3 (consent of all owners).
  availableQuorumTypes: [
    "simple_present",
    "simple_all",
    "two_thirds_all",
    "all_unanimous",
  ],
};

const CZ_RULES: CountryVotingRules = {
  perRollamMinDays: 15,
  silenceIsNo: true,
  fallbackQuorum: 0.4,
  meetingQuorumShare: 0.5,
  ownersQuarterBlocksElectronic: false,
  meetingBlocksElectronic: true,
  repeatedVoteEscalation: false,
  simplePresentInWritten: false,
  availableQuorumTypes: [
    "simple_present",
    "simple_all",
    "two_thirds_all",
    "all_unanimous",
  ],
};

const RULES: Record<Country, CountryVotingRules> = {
  sk: SK_RULES,
  cz: CZ_RULES,
};

export function getVotingRules(country: Country): CountryVotingRules {
  return RULES[country] ?? SK_RULES;
}

/**
 * Quorum types a voting item may use for the given country and voting type.
 * SK: every type for both meeting and written votes — §14b ods. 4 measures
 * "simple_present" against owners present at the meeting OR who took part in
 * the written vote. CZ: "simple_present" only at a meeting (per rollam counts
 * against all owners, §1211 OZ). Pure.
 */
export function getAvailableQuorumTypes(
  country: Country,
  votingType: string
): QuorumType[] {
  const rules = getVotingRules(country);
  const types = rules.availableQuorumTypes;
  return votingType === "meeting" || rules.simplePresentInWritten
    ? types
    : types.filter((q) => q !== "simple_present");
}

/** Stable codes of the repeated-vote escalation (UI maps them to VotingWorkflow.errors.*). */
export type RepeatEscalationErrorCode =
  | "REPEAT_ESCALATION_UNSUPPORTED" // country has no §14b ods. 6 rule (CZ)
  | "REPEAT_ESCALATION_NOT_APPLICABLE"; // base category has no escalation (unanimity)

/**
 * SK §14b ods. 6 zák. 182/1993: a decision on the SAME matter within one
 * year of a valid vote needs a stricter majority. `base` is the category of
 * the original matter:
 *   §14b ods. 1 (simple_all)       → two-thirds of all  (two_thirds_all)
 *   §14b ods. 2 (two_thirds_all)   → four-fifths of all (four_fifths_all)
 *   §14b ods. 4 (simple_present)   → majority of all    (simple_all)
 *   §14b ods. 3 (all_unanimous)    → no escalation (already unanimous)
 * Pure; returns a code, never prose.
 */
export function escalateRepeatedQuorum(
  country: Country,
  base: QuorumType
):
  | { ok: true; quorumType: QuorumType }
  | { ok: false; code: RepeatEscalationErrorCode } {
  if (!getVotingRules(country).repeatedVoteEscalation) {
    return { ok: false, code: "REPEAT_ESCALATION_UNSUPPORTED" };
  }
  switch (base) {
    case "simple_all":
      return { ok: true, quorumType: "two_thirds_all" };
    case "two_thirds_all":
      return { ok: true, quorumType: "four_fifths_all" };
    case "simple_present":
      return { ok: true, quorumType: "simple_all" };
    default:
      return { ok: false, code: "REPEAT_ESCALATION_NOT_APPLICABLE" };
  }
}

/**
 * Quorum types the voting form offers for "this repeats a decision made in
 * the last 12 months" (base categories that escalate). Empty when the
 * country has no escalation rule. Pure.
 */
export function getRepeatableQuorumTypes(
  country: Country,
  votingType: string
): QuorumType[] {
  return getAvailableQuorumTypes(country, votingType).filter(
    (q) => escalateRepeatedQuorum(country, q).ok
  );
}

/**
 * Validates per rollam end date against country minimum duration.
 * Returns null if valid, or the minimum required Date if invalid.
 */
export function validatePerRollamDuration(
  country: Country,
  startsAt: Date,
  endsAt: Date
): Date | null {
  const rules = getVotingRules(country);
  if (rules.perRollamMinDays === null) return null;

  const minEnd = new Date(startsAt);
  minEnd.setDate(minEnd.getDate() + rules.perRollamMinDays);

  if (endsAt < minEnd) return minEnd;
  return null;
}

/**
 * Returns whether electronic voting should be blocked for the given
 * country + voting configuration.
 */
export function isElectronicVotingBlocked(
  country: Country,
  votingType: string,
  initiatedBy: string
): boolean {
  const rules = getVotingRules(country);

  if (rules.meetingBlocksElectronic && votingType === "meeting") return true;
  if (rules.ownersQuarterBlocksElectronic && initiatedBy === "owners_quarter")
    return true;

  return false;
}
