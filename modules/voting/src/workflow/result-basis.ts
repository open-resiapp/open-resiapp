// 2026-11-18 review — "ZA 80 %" next to "NESCHVÁLENÉ".
//
// The engine's zaPercent / protiPercent / zdrzalSaPercent are shares of the
// weight that took part in the tally (cast ballots; CZ per rollam also counts
// silence as "proti"). The *_all quorums however judge the za weight against
// the weight of ALL owners in scope (SK §14b ods. 1–2, 6 zák. 182/1993 Z.z.:
// "väčšina hlasov všetkých vlastníkov"), and simple_present against the
// weight present (§14b ods. 4). Showing only the "of cast" figure next to the
// verdict reads as a contradiction.
//
// This pure, client-safe helper derives the numbers the verdict was actually
// decided on — it does NOT change the pass/fail math (engine/index.ts
// finalizeTally stays the only authority); it re-states its basis.
import type { QuorumType, VotingResults } from "@/types";

/** What the za weight is compared against for this quorum type. */
export type ResultBasisKind = "all" | "present" | "cast";

/** Threshold wording key — mirrors engine/index.ts finalizeTally comparisons. */
export type ThresholdKind =
  | "more_than_half" // exceeds(za, basis / 2)
  | "at_least_two_thirds" // atLeast(za, basis * 2/3)
  | "at_least_four_fifths" // atLeast(za, basis * 4/5)
  | "all"; // isWholeWeight(za, basis)

export interface ResultBasis {
  kind: ResultBasisKind;
  threshold: ThresholdKind;
  /** Weight the threshold is applied to. */
  basisWeight: number;
  /** Weight needed by the rule (the boundary; "more_than_half" needs strictly more). */
  thresholdWeight: number;
  /** Weight counted in the tally (`total`: cast ballots; CZ per rollam incl. silence). */
  countedWeight: number;
  /** All possible weight in scope (frozen at close). */
  totalPossibleWeight: number;
  /** Shares of the basis weight, 0..100. */
  zaOfBasisPct: number;
  protiOfBasisPct: number;
  zdrzalSaOfBasisPct: number;
  /** Threshold as a percentage of the basis (50, 66.67, 80, 100). */
  thresholdPct: number;
}

const THRESHOLD: Record<QuorumType, { kind: ResultBasisKind | "present_or_cast"; threshold: ThresholdKind; ratio: number }> = {
  simple_present: { kind: "present_or_cast", threshold: "more_than_half", ratio: 1 / 2 },
  simple_all: { kind: "all", threshold: "more_than_half", ratio: 1 / 2 },
  two_thirds_all: { kind: "all", threshold: "at_least_two_thirds", ratio: 2 / 3 },
  four_fifths_all: { kind: "all", threshold: "at_least_four_fifths", ratio: 4 / 5 },
  all_unanimous: { kind: "all", threshold: "all", ratio: 1 },
};

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

export function resultBasis(r: VotingResults): ResultBasis {
  const rule = THRESHOLD[r.quorumType] ?? THRESHOLD.simple_all;
  let kind: ResultBasisKind;
  let basisWeight: number;
  if (rule.kind === "all") {
    kind = "all";
    basisWeight = r.totalPossibleWeight;
  } else if (r.presence) {
    // Meeting: present weight (prezenčná listina ∪ cast ballots).
    kind = "present";
    basisWeight = r.presence.weight;
  } else {
    // Written vote: owners who took part in the vote (engine uses `total`).
    kind = "cast";
    basisWeight = r.total;
  }
  return {
    kind,
    threshold: rule.threshold,
    basisWeight,
    thresholdWeight: basisWeight * rule.ratio,
    countedWeight: r.total,
    totalPossibleWeight: r.totalPossibleWeight,
    zaOfBasisPct: pctOf(r.za, basisWeight),
    protiOfBasisPct: pctOf(r.proti, basisWeight),
    zdrzalSaOfBasisPct: pctOf(r.zdrzalSa, basisWeight),
    thresholdPct: rule.ratio * 100,
  };
}
