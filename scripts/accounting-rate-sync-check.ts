/**
 * BYT-20260512-002 rate-sync parser check — `pnpm test:accounting-rate-sync`.
 * Self-contained tsx, NO database, NO network. Guards the pure parser +
 * injected-fetch orchestration the rate cron runs (rate-sync-format.ts):
 *   - ECB-style CSV (comma, ISO dates) → latest observation
 *   - ČNB-style CSV (semicolon, DD.MM.YYYY, decimal comma)
 *   - BOM strip, most-recent selection, malformed-input rejection
 *   - fetchLatestRate: ok payload parses; HTTP error / empty URL throw
 */
import {
  parseRateCsv,
  fetchLatestRate,
  type RateSourceConfig,
} from "@modules/accounting/src/lib/rate-sync-format";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── ECB-style CSV: comma, ISO dates, picks most recent ─────────────────
console.log("ECB-style CSV");
{
  const csv =
    "KEY,FREQ,TIME_PERIOD,OBS_VALUE\n" +
    "FM...,B,2025-04-23,2.40\n" +
    "FM...,B,2025-06-11,2.15\n";
  const r = parseRateCsv(csv, "TIME_PERIOD", "OBS_VALUE", ",");
  check("latest date wins", r.validFrom === "2025-06-11", r.validFrom);
  check("rate parsed", r.ratePct === 2.15, String(r.ratePct));
}

// ── ČNB-style CSV: semicolon, DD.MM.YYYY, decimal comma ────────────────
console.log("ČNB-style CSV");
{
  const csv =
    "DATE;VALUE\n" +
    "07.02.2025;3,75\n" +
    "09.05.2025;3,50\n";
  const r = parseRateCsv(csv, "DATE", "VALUE", ";");
  check("DD.MM.YYYY → ISO", r.validFrom === "2025-05-09", r.validFrom);
  check("decimal comma parsed", r.ratePct === 3.5, String(r.ratePct));
}

// ── BOM + out-of-order rows: still picks max date ──────────────────────
console.log("BOM + unordered");
{
  const csv =
    "﻿TIME_PERIOD,OBS_VALUE\n2024-06-12,4.25\n2023-09-20,4.50\n2024-09-18,3.65\n";
  const r = parseRateCsv(csv, "TIME_PERIOD", "OBS_VALUE", ",");
  check("BOM stripped, max date", r.validFrom === "2024-09-18", r.validFrom);
  check("its value", r.ratePct === 3.65, String(r.ratePct));
}

// ── rejection ──────────────────────────────────────────────────────────
console.log("rejection");
{
  const bad = (fn: () => unknown) => {
    try {
      fn();
      return false;
    } catch {
      return true;
    }
  };
  check("missing column throws",
    bad(() => parseRateCsv("A,B\n1,2\n", "TIME_PERIOD", "OBS_VALUE", ",")));
  check("header only throws",
    bad(() => parseRateCsv("TIME_PERIOD,OBS_VALUE\n", "TIME_PERIOD", "OBS_VALUE", ",")));
  check("no valid observation throws",
    bad(() => parseRateCsv("TIME_PERIOD,OBS_VALUE\nx,y\n", "TIME_PERIOD", "OBS_VALUE", ",")));
}

// ── fetchLatestRate with injected fetch (no network) ───────────────────
console.log("fetchLatestRate");
{
  const cfg: RateSourceConfig = {
    series: "ecb_mro",
    url: "https://example/ecb.csv",
    dateHeader: "TIME_PERIOD",
    valueHeader: "OBS_VALUE",
    delimiter: ",",
  };
  const okFetch = (async () =>
    ({
      ok: true,
      status: 200,
      text: async () => "TIME_PERIOD,OBS_VALUE\n2025-06-11,2.15\n",
    }) as Response) as unknown as typeof fetch;

  const run = async () => {
    const r = await fetchLatestRate(cfg, okFetch);
    check("ok payload parsed", r.validFrom === "2025-06-11" && r.ratePct === 2.15);

    const errFetch = (async () =>
      ({ ok: false, status: 503, text: async () => "" }) as Response) as unknown as typeof fetch;
    let threw = false;
    try {
      await fetchLatestRate(cfg, errFetch);
    } catch {
      threw = true;
    }
    check("HTTP error throws", threw);

    let threw2 = false;
    try {
      await fetchLatestRate({ ...cfg, url: "" }, okFetch);
    } catch {
      threw2 = true;
    }
    check("empty URL throws", threw2);
  };

  void run().then(() => {
    console.log(
      failures === 0
        ? "\nAll rate-sync checks passed."
        : `\n${failures} check(s) FAILED.`
    );
    process.exit(failures === 0 ? 0 : 1);
  });
}
