/**
 * BYT-20260512-002 vyúčtovanie-deadline check (AC 418/419) —
 * `pnpm test:accounting-deadlines`. Self-contained tsx, NO database.
 * Pins the SK 31.05 / CZ 30.04 statutory deadlines, the 30-day alert
 * window and the post-deadline sanction flag.
 */
import {
  vyuctovanieDeadline,
  vyuctovanieDeadlineDate,
} from "@modules/accounting/src/lib/deadlines";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

console.log("deadline dates");
check("SK 2024 → 2025-05-31", iso(vyuctovanieDeadlineDate("sk", 2024)) === "2025-05-31");
check("CZ 2024 → 2025-04-30", iso(vyuctovanieDeadlineDate("cz", 2024)) === "2025-04-30");

console.log("SK window");
{
  // 2024 settlement, deadline 2025-05-31.
  const early = vyuctovanieDeadline("sk", 2024, new Date("2025-01-15T00:00:00Z"));
  check("far out → no alert", !early.alertActive && !early.sanctionActive);
  const near = vyuctovanieDeadline("sk", 2024, new Date("2025-05-10T00:00:00Z"));
  check("21 days out → alert, no sanction", near.alertActive && !near.sanctionActive);
  check("daysUntil counts 21", near.daysUntil === 21, String(near.daysUntil));
  const onDay = vyuctovanieDeadline("sk", 2024, new Date("2025-05-31T00:00:00Z"));
  check("on the day → alert, no sanction (daysUntil 0)",
    onDay.daysUntil === 0 && onDay.alertActive && !onDay.sanctionActive);
  const past = vyuctovanieDeadline("sk", 2024, new Date("2025-06-05T00:00:00Z"));
  check("past → sanction active", past.sanctionActive && past.alertActive);
  check("past daysUntil negative", past.daysUntil === -5, String(past.daysUntil));
}

console.log("CZ window");
{
  const exactly30 = vyuctovanieDeadline("cz", 2024, new Date("2025-03-31T00:00:00Z"));
  check("exactly 30 days → alert", exactly30.daysUntil === 30 && exactly30.alertActive);
  const day31 = vyuctovanieDeadline("cz", 2024, new Date("2025-03-30T00:00:00Z"));
  check("31 days → no alert yet", day31.daysUntil === 31 && !day31.alertActive);
  const past = vyuctovanieDeadline("cz", 2024, new Date("2025-05-01T00:00:00Z"));
  check("past 30.04 → sanction", past.sanctionActive);
}

console.log(
  failures === 0
    ? "\nAll deadline checks passed."
    : `\n${failures} check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
