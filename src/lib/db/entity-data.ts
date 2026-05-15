// BYT-20260515-001 Phase 2b dual-write helpers.
//
// These map camelCase API body fields to the canonical jsonb keys
// stored on entities.data. Reads (legacy-compat + per-route jsonb
// extracts) use the same keys; this file is the single source of
// truth for the input → jsonb shape mapping.
//
// The functions return plain objects suitable for `JSON.stringify`
// into a `${...}::jsonb` SQL literal:
//
//   sql`${entities.data} || ${JSON.stringify(rootDataPatch(body))}::jsonb`

export function rootDataPatch(input: {
  address?: unknown;
  ico?: unknown;
  votingMethod?: unknown;
  country?: unknown;
  governanceModel?: unknown;
  legalNotice?: unknown;
  communityCrossEntranceVisible?: unknown;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.address !== undefined) out.address = input.address;
  if (input.ico !== undefined) out.ico = input.ico;
  if (input.votingMethod !== undefined) out.voting_method = input.votingMethod;
  if (input.country !== undefined) out.country = input.country;
  if (input.governanceModel !== undefined) out.governance_model = input.governanceModel;
  if (input.legalNotice !== undefined) out.legal_notice = input.legalNotice;
  if (input.communityCrossEntranceVisible !== undefined) {
    out.community_cross_entrance_visible = input.communityCrossEntranceVisible;
  }
  return out;
}

export function unitDataPatch(input: {
  flatNumber?: unknown;
  floor?: unknown;
  shareNumerator?: unknown;
  shareDenominator?: unknown;
  area?: unknown;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (input.flatNumber !== undefined) out.flat_number = input.flatNumber;
  if (input.floor !== undefined) out.floor = input.floor;
  if (input.shareNumerator !== undefined) out.share_numerator = input.shareNumerator;
  if (input.shareDenominator !== undefined) out.share_denominator = input.shareDenominator;
  if (input.area !== undefined) out.area_m2 = input.area;
  return out;
}
