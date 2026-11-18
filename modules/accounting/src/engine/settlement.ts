// Ročné vyúčtovanie settlement engine (BYT-20260512-002 Phase 4) — pure
// functions, no DB. Computes the per-unit statement the statute requires
// (SK §7b zák. 182/1993; CZ §7 zák. 67/2013): skutočné náklady per
// service, predpísané zálohy, rozdiel.
//
// SETTLEMENT BASIS (fix 2026-11-18): the result of the vyúčtovanie is
//   výsledok = cost share − PRESCRIBED advances
// — the same number the ledger books in postSettlementClose (Dr 325 by the
// prescription, Cr 5xx by the cost, Dr 311 / Cr 379 by the per-unit rozdiel).
// Unpaid advances (arrears) are NOT part of the result: they stay open as
// receivables on the original monthly assessments and are reported on the
// statement as a separate "z toho neuhradené" line. Settling against PAID
// advances (the pre-fix rule) counted arrears twice — once on the open
// assessment and again inside the settlement nedoplatok.
//
// COST SPLIT (fix 2026-11-18): each service's real cost is split by the
// service's real key, not proportionally to the prescription:
//   - metered (teplo/TÚV, vyhláška 269/2015): costShareByUnit, from heat.ts
//   - share / area_m2 / persons / flat_count_equal: weightsByUnit, built by
//     the caller from the year's data (assessment snapshots; person-months
//     from the reading round)
//   - fixed: no physical key exists — the cost is split proportionally to
//     the fixed prescriptions (the only basis the zmluva gives)
// Every split is integer-cent largest-remainder (splitByWeights), so per
// service the unit shares sum exactly to the cost (invariant 10).

import { splitByWeights } from "./allocation";

/** Stable engine error codes — the caller maps them to i18n. */
export type SettlementEngineErrorCode =
  | "SETTLEMENT_NO_UNITS"
  | "SETTLEMENT_NEGATIVE_COST"
  | "SETTLEMENT_METERED_SPLIT_MISMATCH"
  | "SETTLEMENT_SPLIT_NO_WEIGHT";

export class SettlementEngineError extends Error {
  readonly code: SettlementEngineErrorCode;
  readonly serviceCategoryId: string | null;
  constructor(code: SettlementEngineErrorCode, serviceCategoryId: string | null = null) {
    super(code);
    this.name = "SettlementEngineError";
    this.code = code;
    this.serviceCategoryId = serviceCategoryId;
  }
}

export interface SettlementServiceInput {
  serviceCategoryId: string;
  /** Actual yearly cost booked for the service into the period. */
  actualCostCents: number;
  /** Per unit: prescribed total for the year (assessment sum). */
  prescribedByUnit: Record<string, number>;
  /** Per unit: advances received (allocations against the assessments). */
  advancesByUnit: Record<string, number>;
  /**
   * Metered cost split (teplo/TÚV per vyhláška 269/2015, computed by
   * engine/heat.ts). Takes precedence over weightsByUnit; it MUST sum to
   * actualCostCents.
   */
  costShareByUnit?: Record<string, number>;
  /**
   * Key weights for the year (m², share, person-months, 1 per flat). The
   * cost is split by these via largest remainder. Omit only for the `fixed`
   * key — the split then follows the prescriptions.
   */
  weightsByUnit?: Record<string, number>;
  /**
   * The allocation key actually used for this service (share/area_m2/persons/
   * flat_count_equal/fixed, or "meters" when metered) — the statutory "použitý
   * kľúč rozúčtovania" printed on the vyúčtovanie (AC 442).
   */
  allocationKey?: string | null;
}

export interface SettlementServiceLine {
  serviceCategoryId: string;
  prescribedCents: number;
  /** Paid against the year's prescriptions (informational). */
  advancesCents: number;
  /** prescribed − paid: arrears, NOT part of the result (stay on 311). */
  unpaidCents: number;
  costShareCents: number;
  /** costShare − PRESCRIBED; positive = nedoplatok (owner pays). */
  differenceCents: number;
  /** Allocation key used for this service (AC 442); null if unknown. */
  allocationKey: string | null;
  /** Marks the post-fix basis; absent on legacy (paid-basis) payloads. */
  basis: "prescribed";
}

export interface UnitSettlement {
  unitEntityId: string;
  services: SettlementServiceLine[];
  totalCostCents: number;
  totalPrescribedCents: number;
  totalAdvancesCents: number;
  totalUnpaidCents: number;
  /** cost − prescribed. Positive = nedoplatok, negative = preplatok. */
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
    throw new SettlementEngineError("SETTLEMENT_NO_UNITS");
  }
  for (const service of services) {
    if (service.actualCostCents < 0) {
      throw new SettlementEngineError(
        "SETTLEMENT_NEGATIVE_COST",
        service.serviceCategoryId
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
        totalPrescribedCents: 0,
        totalAdvancesCents: 0,
        totalUnpaidCents: 0,
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

    let shareByUnit: Map<string, number>;
    if (service.costShareByUnit) {
      // Metered split — use verbatim, but assert it ties out (invariant 10).
      const meteredSum = unitIds.reduce(
        (s, id) => s + (service.costShareByUnit![id] ?? 0),
        0
      );
      if (meteredSum !== service.actualCostCents) {
        throw new SettlementEngineError(
          "SETTLEMENT_METERED_SPLIT_MISMATCH",
          service.serviceCategoryId
        );
      }
      shareByUnit = new Map(
        unitIds.map((id) => [id, service.costShareByUnit![id] ?? 0])
      );
    } else if (service.actualCostCents === 0) {
      shareByUnit = new Map(unitIds.map((id) => [id, 0]));
    } else {
      // Key weights when given; otherwise (fixed key) the prescriptions.
      // A service where nothing was prescribed but money was spent falls
      // back to an equal split — the caller blocks publish on it
      // (unprescribedCostCategories), the preview still renders.
      const weights = unitIds.map((id) => ({
        id,
        weight: service.weightsByUnit
          ? service.weightsByUnit[id] ?? 0
          : prescribedTotal > 0
            ? service.prescribedByUnit[id] ?? 0
            : 1,
      }));
      if (weights.reduce((s, w) => s + w.weight, 0) <= 0) {
        throw new SettlementEngineError(
          "SETTLEMENT_SPLIT_NO_WEIGHT",
          service.serviceCategoryId
        );
      }
      shareByUnit = new Map(
        splitByWeights(service.actualCostCents, weights).map((s) => [
          s.id,
          s.amountCents,
        ])
      );
    }

    for (const id of unitIds) {
      const unit = unitMap.get(id)!;
      const prescribed = service.prescribedByUnit[id] ?? 0;
      const advances = service.advancesByUnit[id] ?? 0;
      const costShare = shareByUnit.get(id) ?? 0;
      const line: SettlementServiceLine = {
        serviceCategoryId: service.serviceCategoryId,
        prescribedCents: prescribed,
        advancesCents: advances,
        unpaidCents: prescribed - advances,
        costShareCents: costShare,
        differenceCents: costShare - prescribed,
        allocationKey: service.allocationKey ?? null,
        basis: "prescribed",
      };
      unit.services.push(line);
      unit.totalCostCents += costShare;
      unit.totalPrescribedCents += prescribed;
      unit.totalAdvancesCents += advances;
      unit.totalUnpaidCents += line.unpaidCents;
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

// ── Statement ↔ ledger invariant ───────────────────────

export type SettlementInvariantCode =
  /** Σ unit cost shares of a service ≠ the cost booked on 5xx for it. */
  | "COST_MISMATCH"
  /** A unit's prescribed total ≠ the predpis posted to 311 for it. */
  | "PRESCRIBED_MISMATCH"
  /** Σ unit results ≠ Σ costs − Σ prescriptions (or a unit line ≠ its posting). */
  | "DIFFERENCE_MISMATCH";

export interface SettlementInvariantViolation {
  code: SettlementInvariantCode;
  /** serviceCategoryId or unitEntityId (null for dom-wide). */
  ref: string | null;
  expectedCents: number;
  actualCents: number;
}

/**
 * Pre-publish check: the statement must tie out to the ledger to the cent.
 * `ledger.costByCategory` — net debit on svc 5xx per category for the period
 * (excluding the settlement entry); `ledger.prescribedByUnit` — predpis
 * posted to 311 (svc) per unit for the period. Pass `null` for
 * prescribedByUnit when not every assessment is posted yet (the preview
 * before publish posts the due months) — that leg is then skipped.
 */
export function checkSettlementAgainstLedger(
  result: SettlementResult,
  ledger: {
    costByCategory: Record<string, number>;
    prescribedByUnit: Record<string, number> | null;
  }
): SettlementInvariantViolation[] {
  const out: SettlementInvariantViolation[] = [];

  const categories = new Set([
    ...Object.keys(ledger.costByCategory),
    ...result.perService.map((s) => s.serviceCategoryId),
  ]);
  for (const cat of categories) {
    const booked = ledger.costByCategory[cat] ?? 0;
    const shares = result.units.reduce(
      (s, u) =>
        s +
        u.services
          .filter((l) => l.serviceCategoryId === cat)
          .reduce((a, l) => a + l.costShareCents, 0),
      0
    );
    if (shares !== booked) {
      out.push({ code: "COST_MISMATCH", ref: cat, expectedCents: booked, actualCents: shares });
    }
  }

  if (ledger.prescribedByUnit) {
    const unitIds = new Set([
      ...Object.keys(ledger.prescribedByUnit),
      ...result.units.map((u) => u.unitEntityId),
    ]);
    for (const id of unitIds) {
      const posted = ledger.prescribedByUnit[id] ?? 0;
      const statement =
        result.units.find((u) => u.unitEntityId === id)?.totalPrescribedCents ?? 0;
      if (statement !== posted) {
        out.push({
          code: "PRESCRIBED_MISMATCH",
          ref: id,
          expectedCents: posted,
          actualCents: statement,
        });
      }
    }
  }

  const costs = result.units.reduce((s, u) => s + u.totalCostCents, 0);
  const prescribed = result.units.reduce((s, u) => s + u.totalPrescribedCents, 0);
  if (result.totalDifferenceCents !== costs - prescribed) {
    out.push({
      code: "DIFFERENCE_MISMATCH",
      ref: null,
      expectedCents: costs - prescribed,
      actualCents: result.totalDifferenceCents,
    });
  }
  return out;
}

/**
 * Post-publish check (same transaction, before commit): the settlement
 * journal entry's per-unit lines must equal each unit's statement result,
 * and its 5xx credits must equal the costs. `entry.unitNetByUnit` = Dr 311 −
 * Cr 379 per unit; `entry.costCreditByCategory` = Cr 5xx per category.
 */
export function checkSettlementEntry(
  result: SettlementResult,
  entry: {
    unitNetByUnit: Record<string, number>;
    costCreditByCategory: Record<string, number>;
  }
): SettlementInvariantViolation[] {
  const out: SettlementInvariantViolation[] = [];
  for (const u of result.units) {
    const booked = entry.unitNetByUnit[u.unitEntityId] ?? 0;
    if (booked !== u.totalDifferenceCents) {
      out.push({
        code: "DIFFERENCE_MISMATCH",
        ref: u.unitEntityId,
        expectedCents: u.totalDifferenceCents,
        actualCents: booked,
      });
    }
  }
  for (const id of Object.keys(entry.unitNetByUnit)) {
    if (!result.units.some((u) => u.unitEntityId === id) && entry.unitNetByUnit[id] !== 0) {
      out.push({
        code: "DIFFERENCE_MISMATCH",
        ref: id,
        expectedCents: 0,
        actualCents: entry.unitNetByUnit[id],
      });
    }
  }
  for (const s of result.perService) {
    const credited = entry.costCreditByCategory[s.serviceCategoryId] ?? 0;
    if (credited !== s.actualCostCents) {
      out.push({
        code: "COST_MISMATCH",
        ref: s.serviceCategoryId,
        expectedCents: s.actualCostCents,
        actualCents: credited,
      });
    }
  }
  return out;
}
