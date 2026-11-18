// Utility outages directory (BYT-20261118-008). Static, versioned data per
// country — no DB, no fetch to provider sites. Client-safe (types + constants).
// Maintenance: see README.md in this folder (yearly re-check).

import { CZ_PROVIDERS } from "./cz";
import { SK_PROVIDERS } from "./sk";

export const UTILITY_TYPES = ["water", "electricity", "gas", "heat"] as const;
export type UtilityType = (typeof UTILITY_TYPES)[number];

export type ProviderCountry = "sk" | "cz";

export interface UtilityProvider {
  id: string;
  utility: UtilityType;
  /** Proper noun — not translated. */
  name: string;
  /** Official outage-info page, copied from the provider's own site. https:// only. */
  outageUrl: string;
  /** Fault hotline as written on the official site; null when only a web form exists. */
  hotline: string | null;
  /** ISO date (YYYY-MM-DD) the URL/hotline were last checked on the official site. */
  verifiedAt: string;
}

const REGISTRY: Record<ProviderCountry, readonly UtilityProvider[]> = {
  sk: SK_PROVIDERS,
  cz: CZ_PROVIDERS,
};

/** Unknown / missing country falls back to `sk` (same default as the community root). */
export function resolveProviderCountry(country: string | null | undefined): ProviderCountry {
  return country === "cz" ? "cz" : "sk";
}

export function listProviders(country: ProviderCountry): readonly UtilityProvider[] {
  return REGISTRY[country];
}

export function groupByUtility(
  providers: readonly UtilityProvider[]
): Record<UtilityType, UtilityProvider[]> {
  const out: Record<UtilityType, UtilityProvider[]> = {
    water: [],
    electricity: [],
    gas: [],
    heat: [],
  };
  for (const p of providers) out[p.utility].push(p);
  return out;
}

/** `tel:` href for a hotline as written ("0800 121 333" → "tel:0800121333"). */
export function telHref(hotline: string): string {
  return `tel:${hotline.replace(/[^\d+]/g, "")}`;
}

export function isValidTel(hotline: string): boolean {
  return /^\+?\d{6,15}$/.test(hotline.replace(/[\s()-]/g, ""));
}

export const STALE_AFTER_DAYS = 400;
