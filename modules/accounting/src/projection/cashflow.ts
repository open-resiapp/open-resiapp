// Cash-flow projection (BYT-20260512-002 Phase 3) — pure function, no DB.
// Visualization layer only: no postings, no stored numbers (spec:
// "žiaden D/C posting; čisto vizualizačná vrstva"). Answers the
// treasurer's question "can we afford the roof repair now?".

export interface ProjectionMonthInput {
  /** 1-12 month number (display only). */
  month: number;
  year: number;
  /** Prescribed inflow for the month (dom-wide predpis total). */
  predpisCents: number;
  /** Expected outflow (recurring expense estimate + planned one-offs). */
  expenseCents: number;
  /** True when predpis is extrapolated (no published schedule yet). */
  estimated: boolean;
}

export interface ProjectionMonth extends ProjectionMonthInput {
  /** Inflow after the historical collection rate is applied. */
  expectedInflowCents: number;
  closingCents: number;
}

export interface CashflowProjection {
  openingCents: number;
  collectionRate: number;
  months: ProjectionMonth[];
}

/**
 * Rolls the opening cash balance forward: each month adds predpis ×
 * collectionRate and subtracts the expense estimate. All integer-cents
 * arithmetic; the rate application rounds half-up once per month.
 */
export function projectCashflow(input: {
  openingCents: number;
  /** 0..1 — share of prescribed money that historically arrives. */
  collectionRate: number;
  months: ProjectionMonthInput[];
}): CashflowProjection {
  const rate = Math.min(1, Math.max(0, input.collectionRate));
  let balance = input.openingCents;
  const months = input.months.map((m) => {
    const expectedInflowCents = Math.round(m.predpisCents * rate);
    balance += expectedInflowCents - m.expenseCents;
    return { ...m, expectedInflowCents, closingCents: balance };
  });
  return { openingCents: input.openingCents, collectionRate: rate, months };
}

/**
 * Historical collection rate: allocated (paid) / posted (due), bounded to
 * [0, 1]. No history → optimistic 1 (a fresh dom has nothing better).
 */
export function collectionRateFrom(
  dueCents: number,
  paidCents: number
): number {
  if (dueCents <= 0) return 1;
  return Math.min(1, Math.max(0, paidCents / dueCents));
}
