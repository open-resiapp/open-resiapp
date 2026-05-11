// BYT-20260508-003 (easy-import): canonical row shape shared by every
// adapter (CSV, XLSX, paste-from-LV) and consumed by the validator + seeder.
//
// One row = one (unit, owner) pair. Hierarchy is implicit via repeated
// parent fields. Empty strings denote "not provided" — Zod converts them
// to undefined in the parse step.

export type CountryCode = "sk" | "cz";

export type VotingMethod = "per_share" | "per_flat" | "per_area";

export type StructureVariant =
  | "community_unit"
  | "community_entrance_unit"
  | "community_block_entrance_unit";

export interface ImportRow {
  // community-level (must repeat identically on every row)
  community_name: string;
  community_address: string;
  community_ico?: string;
  country: CountryCode;
  voting_method: VotingMethod;
  supisne_cislo?: string;

  // hierarchy (depending on structure)
  block_name?: string;
  entrance_label?: string;

  // unit-level
  unit_number: string;
  unit_floor: number;
  unit_area_m2?: number;
  unit_share_numerator: number;
  unit_share_denominator: number;

  // owner-level (per row)
  owner_name: string;
  owner_address?: string;
  owner_email?: string;
  owner_phone?: string;
  owner_unit_share_numerator: number;
  owner_unit_share_denominator: number;
}

export interface ImportError {
  // 1-based row index in the source spreadsheet/grid; 0 means file-level error.
  row: number;
  // Column key as in ImportRow (e.g. "owner_email"), or null for cross-row.
  column: keyof ImportRow | null;
  code: string;
  message: string;
}

export interface ImportSummary {
  totalRows: number;
  communityName: string;
  blocks: number;
  entrances: number;
  units: number;
  ownersNew: number;
  ownersMatched: number;
  totalUnitShare: { num: string; den: string };
  perUnitOwnerShareOK: boolean;
}

export interface ImportPreview {
  ok: boolean;
  summary: ImportSummary | null;
  errors: ImportError[];
  rows: ImportRow[];
}
