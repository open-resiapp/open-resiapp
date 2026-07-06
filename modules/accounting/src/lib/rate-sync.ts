import "server-only";

import { db } from "@/db";
import { interestRateHistory } from "../db/schema";
import {
  RATE_SOURCES,
  fetchLatestRate,
  type RateSourceConfig,
} from "./rate-sync-format";

// Rate-sync cron job (BYT-20260512-002 Phase 5, AC: "current ECB/ČNB repo
// always available"). Fetches each series' latest observation and appends it
// to interest_rate_history; the (series, valid_from) unique index makes it
// idempotent — re-running the same day inserts nothing. One source failing
// never blocks the other. Triggered by POST /api/cron/accounting-rates with
// the shared CRON_SECRET.

export interface RateSyncItem {
  series: string;
  ok: boolean;
  inserted: boolean;
  validFrom?: string;
  ratePct?: number;
  error?: string;
}

export async function syncRates(opts?: {
  fetchImpl?: typeof fetch;
}): Promise<RateSyncItem[]> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const out: RateSyncItem[] = [];

  for (const src of RATE_SOURCES) {
    // ČNB endpoint is confirmed via env (placeholder in the config).
    const url =
      src.series === "cnb_repo" && process.env.CNB_REPO_CSV_URL
        ? process.env.CNB_REPO_CSV_URL
        : src.url;
    const config: RateSourceConfig = { ...src, url };

    try {
      const rate = await fetchLatestRate(config, fetchImpl);
      const inserted = await db
        .insert(interestRateHistory)
        .values({
          series: src.series,
          validFrom: rate.validFrom,
          rateMilliPct: Math.round(rate.ratePct * 1000),
          source: config.url.slice(0, 200),
        })
        .onConflictDoNothing()
        .returning({ id: interestRateHistory.id });
      out.push({
        series: src.series,
        ok: true,
        inserted: inserted.length > 0,
        validFrom: rate.validFrom,
        ratePct: rate.ratePct,
      });
    } catch (err) {
      out.push({
        series: src.series,
        ok: false,
        inserted: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}
