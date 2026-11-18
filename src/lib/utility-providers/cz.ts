import type { UtilityProvider } from "./index";

// TODO: Czech data set (ČEZ Distribuce, EG.D, PREdistribuce, GasNet, water
// operators) — separate verification pass against official sites. Until then
// the page shows a neutral empty state; never fall back to SK providers.
export const CZ_PROVIDERS: readonly UtilityProvider[] = [];
