import type { QuorumType } from "@/types";

export type Country = "sk" | "cz";

export interface CountryVotingRules {
  // Per rollam
  perRollamMinDays: number | null;
  silenceIsNo: boolean;

  // Fallback quorum (náhradná schôdza / náhradné zhromaždenie)
  fallbackQuorum: number;

  // E-voting restrictions
  ownersQuarterBlocksElectronic: boolean;
  meetingBlocksElectronic: boolean;

  // Repeated vote escalation (SK only)
  repeatedVoteEscalation: boolean;

  // Available quorum types
  availableQuorumTypes: QuorumType[];
}

const SK_RULES: CountryVotingRules = {
  perRollamMinDays: null,
  silenceIsNo: false,
  fallbackQuorum: 0.5,
  ownersQuarterBlocksElectronic: true,
  meetingBlocksElectronic: true,
  repeatedVoteEscalation: true,
  availableQuorumTypes: ["simple_present", "simple_all", "two_thirds_all"],
};

const CZ_RULES: CountryVotingRules = {
  perRollamMinDays: 15,
  silenceIsNo: true,
  fallbackQuorum: 0.4,
  ownersQuarterBlocksElectronic: false,
  meetingBlocksElectronic: true,
  repeatedVoteEscalation: false,
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