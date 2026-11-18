// Client-safe constants shared by module UI, API routes and server libs.
// No server imports here (project rule: server-only modules split from
// client-safe constants).

export const ALLOCATION_KEYS = [
  "share",
  "area_m2",
  "persons",
  "flat_count_equal",
  "fixed",
] as const;

export type AllocationKey = (typeof ALLOCATION_KEYS)[number];

/** Variabilný symbol — 1-10 digits (SK/CZ bank standard). */
export const VS_RE = /^\d{1,10}$/;

/**
 * How a non-fixed fee-schedule row's rateCents is read:
 *   - "total": dom-wide monthly total, split across units by the key
 *   - "per_unit": cents per m² (area_m2) or per person (persons) per month
 */
export const RATE_MODES = ["total", "per_unit"] as const;
export type RateMode = (typeof RATE_MODES)[number];

/** Keys for which a per-unit rate (€/m², €/person) is meaningful. */
export const PER_UNIT_RATE_KEYS: readonly AllocationKey[] = ["area_m2", "persons"];

/** Stable error code: per_unit rate mode on a key that has no unit measure. */
export const ERR_RATE_MODE_KEY = "rate_mode_key_unsupported";
