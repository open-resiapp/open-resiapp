import { createHash } from "crypto";
import type { VoteChoice, VoteWithShare, VotingMethod, VotingResults } from "@/types";

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

export function calculateResults(
  votes: VoteWithShare[],
  method: VotingMethod = "per_share"
): VotingResults {
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

  return {
    za: zaWeight,
    proti: protiWeight,
    zdrzalSa: zdrzalSaWeight,
    total: totalWeight,
    zaPercent: totalWeight > 0 ? (zaWeight / totalWeight) * 100 : 0,
    protiPercent: totalWeight > 0 ? (protiWeight / totalWeight) * 100 : 0,
    zdrzalSaPercent: totalWeight > 0 ? (zdrzalSaWeight / totalWeight) * 100 : 0,
    passed: zaWeight > totalWeight / 2,
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
  choice: string,
  timestamp: Date
): string {
  const data = `${votingId}${ownerId}${choice}${timestamp.toISOString()}`;
  return createHash("sha256").update(data).digest("hex");
}
