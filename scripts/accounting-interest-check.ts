/**
 * BYT-20260512-002 Phase 5 — interest-engine check
 * (run: `pnpm test:accounting-interest`).
 *
 * Pure-function checks against hand-computed references:
 *   - SK: rate = ECB MRO at delay start + 5 pp, simple, days/365
 *   - CZ: rate = ČNB repo at the half-year start of delay + 8 pp
 *   - day counting: delay starts the day AFTER the due date
 *   - per-item half-up rounding to the cent
 */
import {
  baseRateAt,
  computeInterest,
  daysLate,
  halfYearStart,
  lawfulRatePct,
} from "@modules/accounting/src/sanctions/interest";
import {
  ECB_MRO_RATES,
  CNB_REPO_RATES,
} from "@modules/accounting/src/seeds/interest-rates";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("rate history lookup");
check(
  "picks the latest effective rate",
  baseRateAt(ECB_MRO_RATES, new Date("2024-01-15T00:00:00Z")) === 4.5
);
check(
  "exact effective day counts",
  baseRateAt(ECB_MRO_RATES, new Date("2024-06-12T00:00:00Z")) === 4.25
);
try {
  baseRateAt(ECB_MRO_RATES, new Date("2010-01-01T00:00:00Z"));
  failures++;
  console.error("  FAIL pre-history throws — did not throw");
} catch {
  console.log("  ok  pre-history throws");
}

console.log("day counting");
check(
  "due today → 0 days",
  daysLate(new Date("2026-07-04T00:00:00Z"), new Date("2026-07-04T23:00:00Z")) === 0
);
check(
  "one day late",
  daysLate(new Date("2026-07-04T00:00:00Z"), new Date("2026-07-05T01:00:00Z")) === 1
);
check(
  "31 days across a month",
  daysLate(new Date("2026-01-31T00:00:00Z"), new Date("2026-03-03T00:00:00Z")) === 31
);

console.log("anchoring rules");
check(
  "CZ anchors to half-year start",
  halfYearStart(new Date("2026-09-15T00:00:00Z")).toISOString().slice(0, 10) ===
    "2026-07-01"
);
// SK: delay starting 2024-01-15 → ECB 4.50 + 5 = 9.5 %.
check(
  "SK rate = ECB at delay start + 5pp",
  lawfulRatePct("sk", ECB_MRO_RATES, new Date("2024-01-15T00:00:00Z")) === 9.5
);
// CZ: delay starting 2024-09-30 → half-year start 2024-07-01 → repo at
// 2024-07-01 = 4.75 (effective 2024-06-28) + 8 = 12.75 %.
check(
  "CZ rate = repo at half-year start + 8pp",
  lawfulRatePct("cz", CNB_REPO_RATES, new Date("2024-09-30T00:00:00Z")) === 12.75
);

console.log("hand-computed reference (SK)");
{
  // 500.00 € due 2024-12-31, computed as of 2025-03-31.
  // Delay starts 2025-01-01 → ECB rate 3.15 (eff. 2024-12-18) + 5 = 8.15 %.
  // Days: 2025-01-01..2025-03-31 = 90 days.
  // Interest = 50000 × 8.15 × 90 / (100 × 365) = 1004.79… ≈ 1005 cents.
  const result = computeInterest({
    country: "sk",
    history: ECB_MRO_RATES,
    items: [
      { id: "a", amountCents: 50000, dueDate: new Date("2024-12-31T00:00:00Z") },
    ],
    asOf: new Date("2025-03-31T00:00:00Z"),
  });
  const line = result.lines[0];
  check("days = 90", line.days === 90, String(line.days));
  check("rate = 8.15", line.ratePct === 8.15, String(line.ratePct));
  check(
    "interest = 10.05 € (±0.01 AC)",
    line.interestCents === 1005,
    String(line.interestCents)
  );
}

console.log("hand-computed reference (CZ)");
{
  // 10 000 CZK due 2024-08-15, as of 2024-12-31.
  // Delay starts 2024-08-16 → half-year 2024-07-01 → repo 4.75 + 8 = 12.75 %.
  // Days: 2024-08-16..2024-12-31 = 137 days? Aug 16..31 = 15… count:
  // from due 08-15 → (12-31 minus 08-15) = 138 days.
  // Interest = 1000000 × 12.75 × 138 / 36500 = 48205.47… ≈ 48205 cents.
  const result = computeInterest({
    country: "cz",
    history: CNB_REPO_RATES,
    items: [
      { id: "b", amountCents: 1000000, dueDate: new Date("2024-08-15T00:00:00Z") },
    ],
    asOf: new Date("2024-12-31T00:00:00Z"),
  });
  const line = result.lines[0];
  check("days = 138", line.days === 138, String(line.days));
  check("interest = 482.05", line.interestCents === 48205, String(line.interestCents));
}

console.log("edge cases");
{
  const notLate = computeInterest({
    country: "sk",
    history: ECB_MRO_RATES,
    items: [
      { id: "c", amountCents: 10000, dueDate: new Date("2026-12-31T00:00:00Z") },
    ],
    asOf: new Date("2026-07-05T00:00:00Z"),
  });
  check(
    "not-yet-due item yields zero",
    notLate.lines[0].interestCents === 0 && notLate.totalInterestCents === 0
  );
  const multi = computeInterest({
    country: "sk",
    history: ECB_MRO_RATES,
    items: [
      { id: "x", amountCents: 50000, dueDate: new Date("2024-12-31T00:00:00Z") },
      { id: "y", amountCents: 50000, dueDate: new Date("2024-12-31T00:00:00Z") },
    ],
    asOf: new Date("2025-03-31T00:00:00Z"),
  });
  check(
    "total = sum of per-item roundings",
    multi.totalInterestCents === 2010
  );
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll interest checks passed.");
