// BYT-20260508-003 (easy-import): canonical row shape shared by every
// adapter (CSV, XLSX, paste-from-LV) and consumed by the validator + seeder.
//
// One row = one (unit, owner) pair. Hierarchy is implicit via repeated
// parent fields. Empty strings denote "not provided" — Zod converts them
// to undefined in the parse step.

import type { UnitType } from "@/lib/unit-type";

export type CountryCode = "sk" | "cz";

/**
 * Import-side voting method. The three legacy HOA values plus the two
 * member-scoped canonical methods (src/lib/voting-method.ts) so non-HOA
 * templates can be bootstrapped. Canonical aliases (weighted_by_share,
 * one_per_unit) are accepted by the validator and mapped to the legacy form.
 */
export type VotingMethod =
  | "per_share"
  | "per_flat"
  | "per_area"
  | "one_per_member"
  | "custom_weight";

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
  /**
   * Floor: -5..60 (suterén / "1. PP" → -1, "n. PP" → -n, prízemie → 0).
   * Optional for non-flat units (garage, nebytový priestor, other).
   */
  unit_floor?: number;
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
  /** Rodné priezvisko from the LV ("r. Štolc") — never part of the name. */
  owner_birth_name?: string;
  /** IČO of a legal-entity owner (družstvo, obec, s.r.o.) from the LV. */
  owner_ico?: string;
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
  /** Stable code — the UI maps it to `Import.errors.<code>` (i18n). */
  code: string;
  /** English developer fallback only; never shown when the code is known. */
  message: string;
  /** Interpolation values for the i18n message (`Import.errors.<code>`). */
  params?: Record<string, string | number>;
}

/** A warning the admin must explicitly acknowledge before the commit. */
export type ImportWarning = ImportError;

/**
 * One person owning several units inside one import (same normalised name +
 * address, or same e-mail / IČO). The seeder creates ONE user per group
 * unless the admin split it (`splitOwnerGroups`).
 */
export interface OwnerGroup {
  key: string;
  name: string;
  /** 1-based grid rows that belong to this person. */
  rows: number[];
  /** Human unit labels ("1 / 12", "NP 3"). */
  units: string[];
}

// ── LV parse report ──────────────────────────────────────

export type LvSkipReason =
  /** Owner-like row without a "a/b" share at its end. */
  | "no_share"
  /** Share 0, or numerator above the denominator. */
  | "share_invalid"
  /** Owner record glued to LV metadata that could not be separated. */
  | "unreadable"
  /** No unit sections ("Vchod (číslo)") — the LV lists the whole building. */
  | "no_unit_sections"
  /** An owner of the whole building (e.g. a družstvo) — no unit to attach to. */
  | "building_owner";

export interface LvSkippedEntry {
  /** Poradové číslo of the LV part-B row, when it could be read. */
  lvRow: number | null;
  /** Shortened source text, for the admin to find it on the LV. */
  text: string;
  reason: LvSkipReason;
}

export interface LvParseReport {
  recognisedOwners: number;
  recognisedUnits: number;
  skipped: LvSkippedEntry[];
}

export interface ImportSummary {
  totalRows: number;
  communityName: string;
  blocks: number;
  entrances: number;
  units: number;
  /** Owner accounts the seeder will CREATE (one per owner group). */
  ownersNew: number;
  /** Owner groups matched to an existing account by e-mail. */
  ownersMatched: number;
  totalUnitShare: { num: string; den: string };
  perUnitOwnerShareOK: boolean;
  /** Append mode: units already in the community (with owners → skipped). */
  unitsExisting?: number;
  unitsSkipped?: number;
  /** Append mode: existing units' share + this import's share. */
  communityShareWithExisting?: { num: string; den: string };
}

export interface ImportPreview {
  ok: boolean;
  summary: ImportSummary | null;
  errors: ImportError[];
  rows: ImportRow[];
  /** Non-blocking findings the admin must acknowledge (optional: back-compat). */
  warnings?: ImportWarning[];
  /** Same person owning several units in this import. */
  ownerGroups?: OwnerGroup[];
  /** Append mode: human labels of units skipped because they have owners. */
  skippedUnits?: string[];
}
