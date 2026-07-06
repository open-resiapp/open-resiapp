// Heat / TÚV cost split engine — vyhláška č. 269/2015 Sb. ve znění
// 376/2021 Sb. (CZ-mandatory; SK optional per zák. 657/2004, vyhl.
// 240/2016). Pure functions, no DB — same testable shape as the other
// engines. Feeds computeSettlement() as a pre-computed per-unit cost split
// for metered services (SVC_HEAT, SVC_WATER_HOT).
//
// The rule (§3–§4):
//   1. Total service cost splits into a ZÁKLADNÍ složka (basic, by
//      započitatelná podlahová plocha) and a SPOTŘEBNÍ složka (consumption,
//      by indicator / hot-water-meter readings). The basic share is
//      configurable within the statutory band (30–50 % teplo, 30 % TÚV
//      after 376/2021); we take it as a parameter.
//   2. KOREKCE (§4): each unit's cost per m² of započitatelná plocha must
//      not deviate below −20 % or above +100 % of the building average
//      (total cost / total plocha). Units outside are clamped to the
//      boundary; the freed/added amount is redistributed among the
//      still-in-band units proportionally to their consumption. Iterated
//      until every remaining unit is in band.
//
// ⚠️ VERIFY BEFORE PRODUCTION: the correction's redistribution basis and
// iteration are the standard rozúčtovatel interpretation of §4, but have
// NOT been checked against an official MMR worked example. Confirm against
// a real vyúčtování before any statement is sent (spec open question,
// Phase 6 was gated on MMR fixtures).

import { splitByWeights } from "./allocation";

export interface HeatUnitInput {
  unitId: string;
  /** Započitatelná podlahová plocha ×1000 (integer milli-m²). */
  areaMilliM2: number;
  /**
   * Consumption reading ×1000: indicator náměr (teplo) or hot-water m³
   * (TÚV) for the period. 0 = no consumption recorded for this unit.
   */
  consumptionMilli: number;
}

export interface HeatSplitOptions {
  /** Základní složka in percent (e.g. 40). Statutory band, per service. */
  basicSharePct: number;
  /** Lower correction bound, percent of building avg cost/m² (default −20). */
  correctionMinPct?: number;
  /** Upper correction bound, percent of building avg cost/m² (default +100). */
  correctionMaxPct?: number;
  /** Apply the §4 correction (default true; off for a raw split). */
  applyCorrection?: boolean;
}

export interface HeatUnitResult {
  unitId: string;
  basicCents: number;
  consumptionCents: number;
  /** basic + consumption before correction. */
  rawCents: number;
  /** After §4 correction; Σ finalCents === totalCostCents exactly. */
  finalCents: number;
  /** Clamped to a correction boundary. */
  corrected: boolean;
}

export interface HeatSplitResult {
  units: HeatUnitResult[];
  totalCostCents: number;
  basicCostCents: number;
  consumptionCostCents: number;
  /** Building average cost per m² ×1000 (cents per milli-m²·1000), for the PDF. */
  avgCostPerM2Cents: number;
}

export function computeHeatSplit(
  totalCostCents: number,
  units: HeatUnitInput[],
  opts: HeatSplitOptions
): HeatSplitResult {
  if (totalCostCents < 0) {
    throw new Error("accounting: negative heat cost");
  }
  if (units.length === 0) {
    throw new Error("accounting: heat split needs units");
  }
  const { basicSharePct } = opts;
  if (basicSharePct < 0 || basicSharePct > 100) {
    throw new Error("accounting: basicSharePct must be 0..100");
  }
  const areaSum = units.reduce((s, u) => s + u.areaMilliM2, 0);
  if (areaSum <= 0) {
    throw new Error("accounting: total započitatelná plocha must be > 0");
  }
  const consumptionSum = units.reduce((s, u) => s + u.consumptionMilli, 0);

  // 1. Split total into basic + consumption components (integer cents).
  const basicCostCents = Math.round((totalCostCents * basicSharePct) / 100);
  const consumptionCostCents = totalCostCents - basicCostCents;

  // 2. Distribute each component (sum-preserving).
  const basicByUnit = new Map(
    splitByWeights(
      basicCostCents,
      units.map((u) => ({ id: u.unitId, weight: u.areaMilliM2 }))
    ).map((s) => [s.id, s.amountCents])
  );
  // Consumption splits by readings; with no readings at all it falls back
  // to plocha (vyhláška: absent metering → basic-style split).
  const consumptionByUnit = new Map(
    splitByWeights(
      consumptionCostCents,
      units.map((u) => ({
        id: u.unitId,
        weight: consumptionSum > 0 ? u.consumptionMilli : u.areaMilliM2,
      }))
    ).map((s) => [s.id, s.amountCents])
  );

  const raw = new Map<string, number>();
  for (const u of units) {
    raw.set(
      u.unitId,
      (basicByUnit.get(u.unitId) ?? 0) + (consumptionByUnit.get(u.unitId) ?? 0)
    );
  }

  const applyCorrection = opts.applyCorrection ?? true;
  const final = new Map(raw);
  const corrected = new Set<string>();

  if (applyCorrection) {
    const minPct = opts.correctionMinPct ?? -20;
    const maxPct = opts.correctionMaxPct ?? 100;
    // Boundary cost for unit i simplifies to
    //   bound = (1 + pct/100) · totalCost · A_i / ΣA
    // because (building avg cost/m²) · A_i = totalCost · A_i / ΣA.
    const boundFor = (areaMilli: number, pct: number) =>
      Math.round(
        (((100 + pct) / 100) * (totalCostCents * areaMilli)) / areaSum
      );

    // Single pass (§4): clamp each unit to its band; the net freed/consumed
    // "pool" is redistributed among the units that were IN band, by their
    // consumption. Σ result === total exactly (clamped sum + pool = Σraw).
    // A single pass matches common rozúčtovatel practice; on pathological
    // multi-violation inputs a redistributed unit may land marginally out
    // of band — flagged for review, never unbalanced (see file caveat).
    const clampedMap = new Map<string, number>();
    let pool = 0;
    const free: HeatUnitInput[] = [];
    for (const u of units) {
      const r = raw.get(u.unitId)!;
      const lo = boundFor(u.areaMilliM2, minPct);
      const hi = boundFor(u.areaMilliM2, maxPct);
      let c = r;
      if (r < lo) c = lo;
      else if (r > hi) c = hi;
      else free.push(u);
      clampedMap.set(u.unitId, c);
      if (c !== r) corrected.add(u.unitId);
      pool += r - c; // >0: capper freed money; <0: floor consumed money
    }

    for (const u of units) final.set(u.unitId, clampedMap.get(u.unitId)!);

    if (pool !== 0) {
      const weights = free.map((u) => ({
        id: u.unitId,
        weight: consumptionSum > 0 ? u.consumptionMilli : u.areaMilliM2,
      }));
      const totalW = weights.reduce((s, w) => s + w.weight, 0);
      if (free.length > 0 && totalW > 0) {
        // Signed, sum-preserving: split |pool| then re-apply the sign.
        const sign = pool < 0 ? -1 : 1;
        const shares = splitByWeights(Math.abs(pool), weights);
        for (const s of shares) {
          final.set(s.id, final.get(s.id)! + sign * s.amountCents);
        }
      } else {
        // No in-band unit (or zero weight) to absorb the pool — park it on
        // the largest-area unit so the sum still ties out exactly.
        const largest = units.reduce((b, u) =>
          u.areaMilliM2 > b.areaMilliM2 ? u : b
        );
        final.set(largest.unitId, final.get(largest.unitId)! + pool);
      }
    }
  }

  const result: HeatUnitResult[] = units.map((u) => ({
    unitId: u.unitId,
    basicCents: basicByUnit.get(u.unitId) ?? 0,
    consumptionCents: consumptionByUnit.get(u.unitId) ?? 0,
    rawCents: raw.get(u.unitId) ?? 0,
    finalCents: final.get(u.unitId) ?? 0,
    corrected: corrected.has(u.unitId),
  }));

  return {
    units: result,
    totalCostCents,
    basicCostCents,
    consumptionCostCents,
    avgCostPerM2Cents: Math.round((totalCostCents * 1000) / areaSum),
  };
}
