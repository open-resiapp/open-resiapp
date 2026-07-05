// Ročné vyúčtovanie settlement engine (BYT-20260512-002 Phase 4) — pure
// functions, no DB. Computes the per-unit statement the statute requires
// (SK §7b zák. 182/1993; CZ §7 zák. 67/2013): skutočné náklady per
// service, prijaté zálohy, rozdiel.
//
// Cost-allocation rule (decision 2026-07-05, documented in WORK_LOG):
// each service's ACTUAL yearly cost is split across units proportionally
// to their PRESCRIBED amounts for that service in the period. This reuses
// the allocation-basis snapshots frozen at publish time (scope rule: no
// retro-alteration when share/area/persons changed mid-year) and equals a
// direct key-based split whenever the key inputs were stable. Meter-based
// water/heat splits (vyhláška 269/2015) arrive with the Phase 6 engine.
//
// Sum preservation (invariant 10): per service, unit cost shares sum
// exactly to the actual cost; a unit's rozdiel is costShare − advances.

import { splitByWeights } from "./allocation";

export interface SettlementServiceInput {
  serviceCategoryId: string;
  /** Actual yearly cost booked for the service (non-voided expenses). */
  actualCostCents: number;
  /** Per unit: prescribed total for the year (assessment sum). */
  prescribedByUnit: Record<string, number>;
  /** Per unit: advances received (allocations against the assessments). */
  advancesByUnit: Record<string, number>;
}

export interface SettlementServiceLine {
  serviceCategoryId: string;
  prescribedCents: number;
  advancesCents: number;
  costShareCents: number;
  /** costShare − advances; positive = owner pays (nedoplatok). */
  differenceCents: number;
}

export interface UnitSettlement {
  unitEntityId: string;
  services: SettlementServiceLine[];
  totalCostCents: number;
  totalAdvancesCents: number;
  /** Positive = nedoplatok (owner pays), negative = preplatok. */
  totalDifferenceCents: number;
}

export interface SettlementResult {
  units: UnitSettlement[];
  perService: {
    serviceCategoryId: string;
    actualCostCents: number;
    prescribedCents: number;
    advancesCents: number;
  }[];
  totalDifferenceCents: number;
}

export function computeSettlement(input: {
  unitIds: string[];
  services: SettlementServiceInput[];
}): SettlementResult {
  const { unitIds, services } = input;
  if (unitIds.length === 0) {
    throw new Error("accounting: settlement needs units");
  }
  for (const service of services) {
    if (service.actualCostCents < 0) {
      throw new Error(
        `accounting: negative cost for ${service.serviceCategoryId}`
      );
    }
  }

  const unitMap = new Map<string, UnitSettlement>(
    unitIds.map((id) => [
      id,
      {
        unitEntityId: id,
        services: [],
        totalCostCents: 0,
        totalAdvancesCents: 0,
        totalDifferenceCents: 0,
      },
    ])
  );

  const perService: SettlementResult["perService"] = [];

  for (const service of services) {
    const prescribedTotal = unitIds.reduce(
      (s, id) => s + (service.prescribedByUnit[id] ?? 0),
      0
    );
    const advancesTotal = unitIds.reduce(
      (s, id) => s + (service.advancesByUnit[id] ?? 0),
      0
    );

    // Cost shares proportional to prescription. A service where nothing
    // was prescribed but money was spent cannot be split by this rule —
    // fall back to an equal split (and the wizard must surface it).
    const weights = unitIds.map((id) => ({
      id,
      weight:
        prescribedTotal > 0 ? service.prescribedByUnit[id] ?? 0 : 1,
    }));
    const shares =
      service.actualCostCents > 0
        ? splitByWeights(service.actualCostCents, weights)
        : unitIds.map((id) => ({ id, amountCents: 0 }));
    const shareByUnit = new Map(shares.map((s) => [s.id, s.amountCents]));

    for (const id of unitIds) {
      const unit = unitMap.get(id)!;
      const prescribed = service.prescribedByUnit[id] ?? 0;
      const advances = service.advancesByUnit[id] ?? 0;
      const costShare = shareByUnit.get(id) ?? 0;
      const line: SettlementServiceLine = {
        serviceCategoryId: service.serviceCategoryId,
        prescribedCents: prescribed,
        advancesCents: advances,
        costShareCents: costShare,
        differenceCents: costShare - advances,
      };
      unit.services.push(line);
      unit.totalCostCents += costShare;
      unit.totalAdvancesCents += advances;
      unit.totalDifferenceCents += line.differenceCents;
    }

    perService.push({
      serviceCategoryId: service.serviceCategoryId,
      actualCostCents: service.actualCostCents,
      prescribedCents: prescribedTotal,
      advancesCents: advancesTotal,
    });
  }

  const units = [...unitMap.values()];
  return {
    units,
    perService,
    totalDifferenceCents: units.reduce(
      (s, u) => s + u.totalDifferenceCents,
      0
    ),
  };
}
