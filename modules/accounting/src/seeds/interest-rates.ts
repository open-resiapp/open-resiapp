// Central-bank base-rate history for the úroky-z-omeškania engine
// (BYT-20260512-002 Phase 5).
//
// ⚠️ VERIFY BEFORE PRODUCTION: these values were written from memory
// during an autonomous run (knowledge cutoff early 2026) — check the
// official series before any upomienka is sent:
//   SK: ECB main refinancing operations rate — ecb.europa.eu / nbs.sk
//   CZ: ČNB dvoutýdenní repo sazba — cnb.cz
// The spec requires a cron-updated `interest_rate_history` (AC: "current
// ECB/ČNB repo always available") — this static seed is the starting
// point; the update job is a follow-up.

import type { RateEntry } from "../sanctions/interest";

/** ECB main refinancing operations rate (SK anchor). */
export const ECB_MRO_RATES: RateEntry[] = [
  { validFrom: "2016-03-16", ratePct: 0.0 },
  { validFrom: "2022-07-27", ratePct: 0.5 },
  { validFrom: "2022-09-14", ratePct: 1.25 },
  { validFrom: "2022-11-02", ratePct: 2.0 },
  { validFrom: "2022-12-21", ratePct: 2.5 },
  { validFrom: "2023-02-08", ratePct: 3.0 },
  { validFrom: "2023-03-22", ratePct: 3.5 },
  { validFrom: "2023-05-10", ratePct: 3.75 },
  { validFrom: "2023-06-21", ratePct: 4.0 },
  { validFrom: "2023-08-02", ratePct: 4.25 },
  { validFrom: "2023-09-20", ratePct: 4.5 },
  { validFrom: "2024-06-12", ratePct: 4.25 },
  { validFrom: "2024-09-18", ratePct: 3.65 },
  { validFrom: "2024-10-23", ratePct: 3.4 },
  { validFrom: "2024-12-18", ratePct: 3.15 },
  { validFrom: "2025-02-05", ratePct: 2.9 },
  { validFrom: "2025-03-12", ratePct: 2.65 },
  { validFrom: "2025-04-23", ratePct: 2.4 },
  { validFrom: "2025-06-11", ratePct: 2.15 },
];

/** ČNB two-week repo rate (CZ anchor). */
export const CNB_REPO_RATES: RateEntry[] = [
  { validFrom: "2023-12-22", ratePct: 6.75 },
  { validFrom: "2024-02-09", ratePct: 6.25 },
  { validFrom: "2024-03-21", ratePct: 5.75 },
  { validFrom: "2024-05-03", ratePct: 5.25 },
  { validFrom: "2024-06-28", ratePct: 4.75 },
  { validFrom: "2024-08-02", ratePct: 4.5 },
  { validFrom: "2024-09-27", ratePct: 4.25 },
  { validFrom: "2024-11-08", ratePct: 4.0 },
  { validFrom: "2025-02-07", ratePct: 3.75 },
  { validFrom: "2025-05-09", ratePct: 3.5 },
];
