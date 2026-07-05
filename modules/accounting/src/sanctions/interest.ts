// Úroky z omeškania engine (BYT-20260512-002 Phase 5) — pure functions,
// no DB. Read-only calculator: auto-booking is NEVER default (spec
// decision — when to book the interest is the chairman's call).
//
// Legal formulas:
//   SK — nariadenie vlády SR č. 87/1995 Z.z. §3: zákonný úrok z omeškania
//        = základná sadzba ECB (main refinancing operations) platná k
//        PRVÉMU DŇU omeškania + 5 percentuálnych bodov. The rate FIXES at
//        delay start for the whole delay (per §3 second sentence variant
//        used for spotrebiteľské vzťahy; verify current wording before
//        locking the AC fixture — spec open question).
//   CZ — nařízení vlády č. 351/2013 Sb. §2: repo sazba ČNB platná k
//        prvnímu dni kalendářního pololetí, v němž došlo k prodlení,
//        + 8 procentních bodů; fixed for the whole delay.
//   Both compute SIMPLE per-day interest (SK case law per §517 ods. 2 OZ;
//   spec Notes) — amount × rate × days/365, days counted from the day
//   AFTER the due date through the target date inclusive.

export interface RateEntry {
  /** ISO date the central-bank rate became effective. */
  validFrom: string;
  /** Central-bank base rate in percent (e.g. 4.5). */
  ratePct: number;
}

export type SanctionCountry = "sk" | "cz";

const SURCHARGE_PP: Record<SanctionCountry, number> = { sk: 5, cz: 8 };

/** The central-bank rate effective on `date` (latest validFrom <= date). */
export function baseRateAt(history: RateEntry[], date: Date): number {
  let current: RateEntry | null = null;
  for (const entry of [...history].sort((a, b) =>
    a.validFrom.localeCompare(b.validFrom)
  )) {
    if (new Date(`${entry.validFrom}T00:00:00Z`) <= date) current = entry;
    else break;
  }
  if (!current) {
    throw new Error(
      `accounting: no interest-rate history covers ${date.toISOString()}`
    );
  }
  return current.ratePct;
}

/** First day of the half-year containing `date` (CZ anchoring rule). */
export function halfYearStart(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() < 6 ? 0 : 6;
  return new Date(Date.UTC(year, month, 1));
}

/**
 * The statutory annual rate for a delay starting at `delayStart`
 * (= day after due date). SK anchors to the delay start itself; CZ to
 * the first day of that half-year.
 */
export function lawfulRatePct(
  country: SanctionCountry,
  history: RateEntry[],
  delayStart: Date
): number {
  const anchor = country === "cz" ? halfYearStart(delayStart) : delayStart;
  return baseRateAt(history, anchor) + SURCHARGE_PP[country];
}

/** Whole days from the day AFTER dueDate through asOf, >= 0. */
export function daysLate(dueDate: Date, asOf: Date): number {
  const DAY = 24 * 3600 * 1000;
  const due = Date.UTC(
    dueDate.getUTCFullYear(),
    dueDate.getUTCMonth(),
    dueDate.getUTCDate()
  );
  const target = Date.UTC(
    asOf.getUTCFullYear(),
    asOf.getUTCMonth(),
    asOf.getUTCDate()
  );
  return Math.max(0, Math.floor((target - due) / DAY));
}

export interface OverdueItem {
  id: string;
  amountCents: number;
  dueDate: Date;
}

export interface InterestLine {
  id: string;
  amountCents: number;
  dueDate: string;
  days: number;
  ratePct: number;
  interestCents: number;
}

/**
 * Simple interest per item: amount × rate% × days / 365, rounded half-up
 * to the cent per item (matches manual reference computations; sum of
 * per-item roundings is the legally claimable total).
 */
export function computeInterest(input: {
  country: SanctionCountry;
  history: RateEntry[];
  items: OverdueItem[];
  asOf: Date;
}): { lines: InterestLine[]; totalInterestCents: number } {
  const lines = input.items.map((item) => {
    const days = daysLate(item.dueDate, input.asOf);
    // Delay starts the day after the due date.
    const delayStart = new Date(item.dueDate.getTime() + 24 * 3600 * 1000);
    const ratePct = days > 0
      ? lawfulRatePct(input.country, input.history, delayStart)
      : 0;
    const interestCents =
      days > 0
        ? Math.round((item.amountCents * ratePct * days) / (100 * 365))
        : 0;
    return {
      id: item.id,
      amountCents: item.amountCents,
      dueDate: item.dueDate.toISOString().slice(0, 10),
      days,
      ratePct,
      interestCents,
    };
  });
  return {
    lines,
    totalInterestCents: lines.reduce((s, l) => s + l.interestCents, 0),
  };
}
