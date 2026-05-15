// BYT-20260515-001 Phase 3: voting method dispatch.
//
// Voting methods are stored on the community root as
// `entities.data.voting_method`. The Slovak HOA flow (zák. 182/1993)
// originally used three values — `per_share`, `per_flat`, `per_area`
// — encoded as a Postgres enum on the legacy `housing_root_data`
// table. The multi-kind community spec generalizes these into four
// canonical methods that other templates (garden, garage, street, …)
// can also use:
//
//   weighted_by_share  — per-unit weight = share_numerator/denominator
//                        (legacy alias: per_share)
//   one_per_unit       — per-unit weight = 1
//                        (legacy alias: per_flat)
//   per_area           — per-unit weight = area_m2
//                        (HOA-specific, no canonical rename)
//   one_per_member     — per-MEMBER weight = 1; no unit grouping
//                        (garden plots, hunting associations, …)
//   custom_weight      — per-MEMBER weight = memberships.weight
//                        (admin-defined; coworking, sports clubs, …)
//
// The unit-scoped methods reuse the existing §14 ods. 4 co-owner
// resolution; the member-scoped methods skip unit grouping and count
// each active membership independently.

export type CanonicalVotingMethod =
  | "weighted_by_share"
  | "one_per_unit"
  | "per_area"
  | "one_per_member"
  | "custom_weight";

export type LegacyVotingMethod = "per_share" | "per_flat" | "per_area";

export type VotingMethod = CanonicalVotingMethod | LegacyVotingMethod;

export const CANONICAL_VOTING_METHODS: CanonicalVotingMethod[] = [
  "weighted_by_share",
  "one_per_unit",
  "per_area",
  "one_per_member",
  "custom_weight",
];

const LEGACY_TO_CANONICAL: Record<LegacyVotingMethod, CanonicalVotingMethod> = {
  per_share: "weighted_by_share",
  per_flat: "one_per_unit",
  per_area: "per_area",
};

/**
 * Map any stored value (legacy or canonical) to its canonical form.
 * Unknown values fall back to `weighted_by_share` — matches the
 * pre-2026-05 default behaviour and surfaces obviously bad config
 * via vote results rather than runtime crashes.
 */
export function normalizeVotingMethod(raw: string | null | undefined): CanonicalVotingMethod {
  if (!raw) return "weighted_by_share";
  if (raw in LEGACY_TO_CANONICAL) {
    return LEGACY_TO_CANONICAL[raw as LegacyVotingMethod];
  }
  if ((CANONICAL_VOTING_METHODS as string[]).includes(raw)) {
    return raw as CanonicalVotingMethod;
  }
  return "weighted_by_share";
}

/**
 * Unit-scoped methods bucket votes by unit and apply §14 ods. 4
 * co-owner resolution. Member-scoped methods skip the bucketing and
 * count each active membership independently.
 */
export function isUnitScoped(method: CanonicalVotingMethod): boolean {
  switch (method) {
    case "weighted_by_share":
    case "one_per_unit":
    case "per_area":
      return true;
    case "one_per_member":
    case "custom_weight":
      return false;
  }
}

export interface UnitWeightInput {
  shareNumerator: number;
  shareDenominator: number;
  area: number | null;
}

/**
 * Weight a single unit contributes to the total. Used both when
 * summing the unit's resolved vote (engine) and when computing
 * `totalPossibleWeight` over the voting's scope (votes route).
 *
 * Member-scoped methods MUST NOT call this — they have no notion of
 * unit weight; throwing here protects against accidental misuse.
 */
export function computeUnitWeight(
  unit: UnitWeightInput,
  method: CanonicalVotingMethod
): number {
  switch (method) {
    case "weighted_by_share":
      return unit.shareNumerator / unit.shareDenominator;
    case "one_per_unit":
      return 1;
    case "per_area":
      return unit.area ?? 1;
    case "one_per_member":
    case "custom_weight":
      throw new Error(
        `computeUnitWeight: method "${method}" is member-scoped — use computeMemberWeight instead.`
      );
  }
}

export interface MemberWeightInput {
  /** Stored on memberships.weight; used by `custom_weight` mode. */
  membershipWeight: number;
}

/**
 * Weight a single active membership contributes to the total in
 * member-scoped voting modes. Unit-scoped methods MUST NOT call this.
 */
export function computeMemberWeight(
  member: MemberWeightInput,
  method: CanonicalVotingMethod
): number {
  switch (method) {
    case "one_per_member":
      return 1;
    case "custom_weight":
      return member.membershipWeight;
    case "weighted_by_share":
    case "one_per_unit":
    case "per_area":
      throw new Error(
        `computeMemberWeight: method "${method}" is unit-scoped — use computeUnitWeight instead.`
      );
  }
}
