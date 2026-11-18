// Fault category seed catalog (BYT-20261118-004, Decisions 7). PURE.
// The FULL catalog lives here and lands before any code that seeds or
// reads it (src/lib/categories.server.ts). Each slug has a label at
// `Faults.category.<slug>` in sk/en/cs. Board-added categories use
// custom slugs (`custom-<uuid>`) and `custom_name` instead.

export const FAULT_CATEGORY_SLUGS = [
  "elevator",
  "water_plumbing",
  "heating",
  "electrical",
  "lighting",
  "doors_locks_intercom",
  "roof_facade",
  "cleaning",
  "common_areas",
  "other",
] as const;

export type FaultCategorySlug = (typeof FAULT_CATEGORY_SLUGS)[number];

export function isSeedCategorySlug(s: string): s is FaultCategorySlug {
  return (FAULT_CATEGORY_SLUGS as readonly string[]).includes(s);
}
