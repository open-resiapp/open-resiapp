// Central-bank rate fetch + parse (PURE, client-safe — no server-only/DB, so
// the golden check exercises the exact parser the cron runs). The DB upsert
// lives in rate-sync.ts. Injectable fetch mirrors the Fio connector: tests
// pass a mock, production passes global fetch — zero network in the suite.
//
// ⚠️ VERIFY BEFORE ENABLING THE CRON: the ECB series key is the documented
// MRO fixed rate; the ČNB endpoint + column names still need confirmation
// against ČNB's ARAD export (override via CNB_REPO_CSV_URL). Wrong series →
// wrong lawful interest, so Filip must confirm both before scheduling.

export interface FetchedRate {
  /** ISO date the rate became effective (YYYY-MM-DD). */
  validFrom: string;
  /** Central-bank base rate in percent (e.g. 2.15). */
  ratePct: number;
}

export interface RateSourceConfig {
  series: "ecb_mro" | "cnb_repo";
  url: string;
  dateHeader: string;
  valueHeader: string;
  delimiter?: string;
}

export const RATE_SOURCES: RateSourceConfig[] = [
  {
    series: "ecb_mro",
    // ECB Data Portal — main refinancing operations fixed rate, latest obs.
    url: "https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.MRR_FR.LEV?lastNObservations=1&format=csvdata",
    dateHeader: "TIME_PERIOD",
    valueHeader: "OBS_VALUE",
    delimiter: ",",
  },
  {
    series: "cnb_repo",
    // ČNB two-week repo rate — set the real ARAD CSV export via
    // CNB_REPO_CSV_URL; headers here are placeholders pending confirmation.
    url: "",
    dateHeader: "DATE",
    valueHeader: "VALUE",
    delimiter: ";",
  },
];

/** "YYYY-MM-DD" | "DD.MM.YYYY" → "YYYY-MM-DD"; null on anything else. */
function normalizeDate(s: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

/** Parse a rate CSV; returns the MOST RECENT observation (max validFrom). */
export function parseRateCsv(
  csv: string,
  dateHeader: string,
  valueHeader: string,
  delimiter = ","
): FetchedRate {
  const text = csv.replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) throw new Error("rate csv: no data rows");

  const cell = (line: string) =>
    line.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ""));
  const header = cell(lines[0]);
  const di = header.indexOf(dateHeader);
  const vi = header.indexOf(valueHeader);
  if (di < 0 || vi < 0) {
    throw new Error(`rate csv: missing ${dateHeader}/${valueHeader} column`);
  }

  let best: FetchedRate | null = null;
  for (let i = 1; i < lines.length; i++) {
    const cells = cell(lines[i]);
    const rawDate = cells[di];
    const rawVal = cells[vi];
    if (!rawDate || !rawVal) continue;
    const validFrom = normalizeDate(rawDate);
    const ratePct = Number(rawVal.replace(",", "."));
    if (!validFrom || !Number.isFinite(ratePct)) continue;
    if (!best || validFrom > best.validFrom) best = { validFrom, ratePct };
  }
  if (!best) throw new Error("rate csv: no valid observation");
  return best;
}

/** Fetch + parse one series' latest rate via an injected fetch. */
export async function fetchLatestRate(
  config: RateSourceConfig,
  fetchImpl: typeof fetch
): Promise<FetchedRate> {
  if (!config.url) {
    throw new Error(`rate sync: no URL configured for ${config.series}`);
  }
  const res = await fetchImpl(config.url, { headers: { accept: "text/csv" } });
  if (!res.ok) {
    throw new Error(`rate sync: ${config.series} HTTP ${res.status}`);
  }
  const csv = await res.text();
  return parseRateCsv(
    csv,
    config.dateHeader,
    config.valueHeader,
    config.delimiter ?? ","
  );
}
