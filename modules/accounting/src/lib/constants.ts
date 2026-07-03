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
