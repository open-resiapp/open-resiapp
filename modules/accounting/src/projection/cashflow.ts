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

// ── Per-pool projection (AC 484) ───────────────────────

export interface PoolSeriesInput {
  /** okruh key — "fpuo" | "svc". */
  pool: string;
  openingCents: number;
  months: ProjectionMonthInput[];
}

export interface PoolProjection {
  pool: string;
  openingCents: number;
  months: ProjectionMonth[];
}

export interface PooledCashflowProjection {
  collectionRate: number;
  /** Σ of the pool openings — the whole dom's net owner-money position. */
  openingCents: number;
  /** Dom-wide total per month = element-wise Σ of the pools (sum-preserving). */
  months: ProjectionMonth[];
  pools: PoolProjection[];
}

/**
 * Projects each pool (FPÚO / služby) independently from its own opening +
 * per-month inflow/outflow, then derives the dom-wide total as the
 * element-wise sum of the pools. Because each pool closing is linear in its
 * inflows/outflows, Σ(pool closings) equals the total closing exactly — the
 * total is built by summing, never re-rounded, so the pools always tie out
 * to the total (no drift). All pools must share the same month order/length.
 */
export function projectPools(input: {
  collectionRate: number;
  pools: PoolSeriesInput[];
}): PooledCashflowProjection {
  const rate = Math.min(1, Math.max(0, input.collectionRate));
  const pools: PoolProjection[] = input.pools.map((p) => {
    const projected = projectCashflow({
      openingCents: p.openingCents,
      collectionRate: rate,
      months: p.months,
    });
    return {
      pool: p.pool,
      openingCents: p.openingCents,
      months: projected.months,
    };
  });

  const openingCents = pools.reduce((s, p) => s + p.openingCents, 0);
  const monthCount = pools[0]?.months.length ?? 0;
  const months: ProjectionMonth[] = [];
  for (let i = 0; i < monthCount; i++) {
    const ref = pools[0].months[i];
    let predpisCents = 0;
    let expenseCents = 0;
    let expectedInflowCents = 0;
    let closingCents = 0;
    let estimated = false;
    for (const p of pools) {
      const m = p.months[i];
      predpisCents += m.predpisCents;
      expenseCents += m.expenseCents;
      expectedInflowCents += m.expectedInflowCents;
      closingCents += m.closingCents;
      estimated = estimated || m.estimated;
    }
    months.push({
      month: ref.month,
      year: ref.year,
      predpisCents,
      expenseCents,
      expectedInflowCents,
      closingCents,
      estimated,
    });
  }

  return { collectionRate: rate, openingCents, months, pools };
}
