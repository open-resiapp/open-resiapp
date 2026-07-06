// Ročné vyúčtovanie statutory deadlines (BYT-20260512-002, AC 418/419).
// PURE + client-safe (no server-only/DB) so the dashboard, the vyúčtovanie
// page and the golden check all share one source of truth.
//
//   SK — §8a ods. 2 zák. 182/1993 Z.z.: vyúčtovanie za rok Y najneskôr do
//        31. mája roku Y+1. §8a ods. 4 sankcia pri nedodržaní.
//   CZ — §7 ods. 1 zák. 67/2013 Sb.: nejpozději do 4 měsíců od skončení
//        zúčtovacího období (kalendárny rok) → 30. apríla roku Y+1.
//
// The window: we surface an alert 30 days before the deadline, and flag the
// sanction once it has passed.

type Country = "sk" | "cz";

export interface VyuctovanieDeadline {
  /** The settlement (accounting) year this deadline governs. */
  year: number;
  /** ISO date (YYYY-MM-DD) of the statutory deadline. */
  deadline: string;
  /** Whole days from `asOf` to the deadline; negative once past. */
  daysUntil: number;
  /** Within 30 days before the deadline, or already past → worth surfacing. */
  alertActive: boolean;
  /** Deadline has passed without publishing → statutory sanction applies. */
  sanctionActive: boolean;
}

const DAY_MS = 24 * 3600 * 1000;

/** The statutory deadline DATE for settling `year`, per country. */
export function vyuctovanieDeadlineDate(country: Country, year: number): Date {
  // SK: 31 May Y+1; CZ: 30 April Y+1 (4 months after the 31 Dec period end).
  return country === "cz"
    ? new Date(Date.UTC(year + 1, 3, 30)) // April = month 3
    : new Date(Date.UTC(year + 1, 4, 31)); // May = month 4
}

/** UTC midnight of a date — day math ignores time-of-day. */
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function vyuctovanieDeadline(
  country: Country,
  settlementYear: number,
  asOf: Date
): VyuctovanieDeadline {
  const deadline = vyuctovanieDeadlineDate(country, settlementYear);
  const daysUntil = Math.floor(
    (utcMidnight(deadline) - utcMidnight(asOf)) / DAY_MS
  );
  return {
    year: settlementYear,
    deadline: deadline.toISOString().slice(0, 10),
    daysUntil,
    alertActive: daysUntil <= 30,
    sanctionActive: daysUntil < 0,
  };
}
