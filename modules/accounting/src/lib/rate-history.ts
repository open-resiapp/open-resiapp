import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { interestRateHistory } from "../db/schema";
import type { RateEntry } from "../sanctions/interest";
import { ECB_MRO_RATES, CNB_REPO_RATES } from "../seeds/interest-rates";

// Rate-history loader for the úroky-z-omeškania engine. The engine stays a
// pure function of a RateEntry[]; this layer sources that array by MERGING:
//   - the code constants (seeds/interest-rates.ts) — the historical baseline
//     that guarantees full coverage even before the cron has ever run
//   - the interest_rate_history table — observations the rate-sync cron
//     appends over time; a DB row WINS over a seed row with the same date
// so a corrected/newer official value overrides the compiled-in one.

export type RateSeries = "ecb_mro" | "cnb_repo";

const SEED: Record<RateSeries, RateEntry[]> = {
  ecb_mro: ECB_MRO_RATES,
  cnb_repo: CNB_REPO_RATES,
};

export function seriesForCountry(country: "sk" | "cz"): RateSeries {
  return country === "cz" ? "cnb_repo" : "ecb_mro";
}

export async function loadRateHistory(
  series: RateSeries
): Promise<RateEntry[]> {
  const rows = await db
    .select({
      validFrom: interestRateHistory.validFrom,
      rateMilliPct: interestRateHistory.rateMilliPct,
    })
    .from(interestRateHistory)
    .where(eq(interestRateHistory.series, series));

  const byDate = new Map<string, number>();
  for (const e of SEED[series]) byDate.set(e.validFrom, e.ratePct);
  for (const r of rows) byDate.set(r.validFrom, r.rateMilliPct / 1000); // DB wins

  return [...byDate.entries()]
    .map(([validFrom, ratePct]) => ({ validFrom, ratePct }))
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}
