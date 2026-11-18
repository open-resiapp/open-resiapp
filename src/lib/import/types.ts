// BYT-20260508-003 (easy-import): canonical row shape shared by every
// adapter (CSV, XLSX, paste-from-LV) and consumed by the validator + seeder.
//
// One row = one (unit, owner) pair. Hierarchy is implicit via repeated
// parent fields. Empty strings denote "not provided" — Zod converts them
// to undefined in the parse step.

import type { UnitType } from "@/lib/unit-type";

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
  community_dic?: string;
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
  /**
   * Typ priestoru (src/lib/unit-type.ts). The LV parser fills it from the
   * "Číslo bytu" / "Číslo nebytového priestoru" label; empty = unclassified
   * (read as "flat"). Never affects voting weight (SK §14(3)).
   */
  unit_type?: UnitType;

  // owner-level (per row)
  owner_name: string;
  owner_address?: string;
  owner_email?: string;
  owner_phone?: string;
  owner_unit_share_numerator: number;
  owner_unit_share_denominator: number;

  // BYT-20261118-003: LV part-B facts, persisted on the membership for the
  // informative ownership checks. Only the LV parser fills them; manual /
  // CSV rows may leave them empty.
  /** Poradové číslo of the owner row on the LV (BSM spouses share one). */
  lv_ordinal?: number;
  /** "bsm" for bezpodielové spoluvlastníctvo manželov; empty otherwise. */
  ownership_form?: "bsm";
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
