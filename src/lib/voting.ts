import { createHash } from "crypto";
import type { VoteChoice, VoteWithShare, VotingMethod, VotingResults, QuorumType } from "@/types";
import type { Country } from "@/lib/voting-rules";
import { getVotingRules } from "@/lib/voting-rules";

function getWeight(vote: VoteWithShare, method: VotingMethod): number {
  switch (method) {
    case "per_flat":
      return 1;
    case "per_area":
      return vote.area ?? 1;
    case "per_share":
    default:
      return vote.shareNumerator / vote.shareDenominator;
  }
}

export interface CalculateResultsOptions {
  country?: Country;
  totalFlats?: number;
}

export function calculateResults(
  votes: VoteWithShare[],
  method: VotingMethod = "per_share",
  quorumType: QuorumType = "simple_all",
  totalPossibleWeight: number = 0,
  options: CalculateResultsOptions = {}
): VotingResults {
  const { country = "sk", totalFlats = 0 } = options;
  const rules = getVotingRules(country);

  let zaWeight = 0;
  let protiWeight = 0;
  let zdrzalSaWeight = 0;
  let totalWeight = 0;

  for (const vote of votes) {
    const weight = getWeight(vote, method);
    totalWeight += weight;
    if (vote.choice === "za") zaWeight += weight;
    if (vote.choice === "proti") protiWeight += weight;
    if (vote.choice === "zdrzal_sa") zdrzalSaWeight += weight;
  }

  // CZ per rollam: silence = nesúhlas (non-voters count as "proti")
  if (rules.silenceIsNo && totalPossibleWeight > 0) {
    const nonVotedWeight = totalPossibleWeight - totalWeight;
    if (nonVotedWeight > 0) {
      protiWeight += nonVotedWeight;
      totalWeight = totalPossibleWeight;
    }
  }

  let passed = false;
  let quorumReached = false;

  switch (quorumType) {
    case "simple_present":
      // Passed if za > 50% of voted weight
      quorumReached = totalWeight > 0;
      passed = zaWeight > totalWeight / 2;
      break;
    case "simple_all":
      // Passed if za > 50% of ALL flat weight
      quorumReached = totalPossibleWeight > 0 && zaWeight > totalPossibleWeight / 2;
      passed = quorumReached;
      break;
    case "two_thirds_all":
      // Passed if za >= 66.7% of ALL flat weight
      quorumReached =
        totalPossibleWeight > 0 && zaWeight >= (totalPossibleWeight * 2) / 3;
      passed = quorumReached;
      break;
    case "all_unanimous":
      // Passed only if ALL weight voted za (100%)
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
  };
}

export interface FlatData {
  shareNumerator: number;
  shareDenominator: number;
  area: number | null;
}

export function aggregateFlatsForVoter(
  choice: VoteChoice,
  voterFlats: FlatData[]
): VoteWithShare {
  if (voterFlats.length === 0) {
    return { choice, shareNumerator: 0, shareDenominator: 1, area: null };
  }

  if (voterFlats.length === 1) {
    const f = voterFlats[0];
    return {
      choice,
      shareNumerator: f.shareNumerator,
      shareDenominator: f.shareDenominator,
      area: f.area,
    };
  }

  // Sum share fractions: all denominators are 10000 in this project,
  // but handle general case correctly
  let totalNumerator = 0;
  let commonDenominator = voterFlats[0].shareDenominator;
  const allSameDenom = voterFlats.every(
    (f) => f.shareDenominator === commonDenominator
  );

  if (allSameDenom) {
    for (const f of voterFlats) {
      totalNumerator += f.shareNumerator;
    }
  } else {
    // LCM-based approach for mixed denominators
    commonDenominator = voterFlats.reduce(
      (lcm, f) => lcmOf(lcm, f.shareDenominator),
      1
    );
    for (const f of voterFlats) {
      totalNumerator +=
        f.shareNumerator * (commonDenominator / f.shareDenominator);
    }
  }

  // Sum areas
  const totalArea = voterFlats.reduce((sum, f) => sum + (f.area ?? 0), 0);

  return {
    choice,
    shareNumerator: totalNumerator,
    shareDenominator: commonDenominator,
    area: totalArea > 0 ? totalArea : null,
  };
}

function gcd(a: number, b: number): number {
  while (b) {
    [a, b] = [b, a % b];
  }
  return a;
}

function lcmOf(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

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
