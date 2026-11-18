// Assessment generation engine (BYT-20260512-002 Phase 1) — pure
// functions, no DB access. Turns a published fee schedule's service rows
// into per-(unit × service × month) assessment amounts.
//
// Domain rules (docs/domain/accounting.md):
//   - sum preservation: per service and month, the per-unit amounts sum
//     exactly to the schedule's dom-wide rate (invariant 10)
//   - allocation inputs are snapshotted per assessment at publish time;
//     later changes to share/area/persons never retro-alter published
//     assessments (scope rule) — the snapshot returned here is stored
//     verbatim on the row
//   - debt follows the person: the snapshot records the owner user ids
//     holding the unit at publish time

import { splitByWeights } from "./allocation";
import {
  ERR_RATE_MODE_KEY,
  PER_UNIT_RATE_KEYS,
  type AllocationKey,
  type RateMode,
} from "../lib/constants";

export interface AssessmentUnitInput {
  unitEntityId: string;
  /** Variabilný symbol assigned to the unit — required to publish. */
  vs: string;
  shareNumerator: number | null;
  shareDenominator: number | null;
  areaM2: number | null;
  /** Owner user ids holding the unit at publish time. */
  ownerUserIds: string[];
  /**
   * Persons count effective per month (index = month 1-12). Callers
   * resolve the time-versioned unit_persons history; missing months = 0.
   */
  personsByMonth: Record<number, number>;
}

export interface AssessmentServiceInput {
  serviceCategoryId: string;
  allocationKey: AllocationKey;
  /**
   * Non-fixed keys. rateMode "total" (default): dom-wide monthly total,
   * split across units. rateMode "per_unit": cents per m² / per person per
   * month — each unit pays round(rate × weight).
   */
  rateCents: number | null;
  rateMode?: RateMode;
  /** Per-unit monthly amount (only `fixed`). */
  fixedAmountCents: number | null;
}

export interface ComputedAssessment {
  unitEntityId: string;
  serviceCategoryId: string;
  month: number;
  amountCents: number;
  vs: string;
  allocationBasisSnapshot: {
    allocationKey: AllocationKey;
    rateCents: number | null;
    /** Present only for per_unit rows (rateCents is then a per-m²/person rate). */
    rateMode?: RateMode;
    fixedAmountCents: number | null;
    weight: number;
    shareNumerator: number | null;
    shareDenominator: number | null;
    areaM2: number | null;
    persons: number | null;
    totalUnits: number;
    ownerUserIds: string[];
  };
}

function unitWeight(
  unit: AssessmentUnitInput,
  key: AllocationKey,
  month: number
): number {
  switch (key) {
    case "share": {
      if (
        unit.shareNumerator === null ||
        unit.shareDenominator === null ||
        unit.shareDenominator === 0
      ) {
        throw new Error(
          `accounting: unit ${unit.unitEntityId} has no ownership share — cannot allocate by share`
        );
      }
      return unit.shareNumerator / unit.shareDenominator;
    }
    case "area_m2": {
      if (unit.areaM2 === null || unit.areaM2 <= 0) {
        throw new Error(
          `accounting: unit ${unit.unitEntityId} has no area — cannot allocate by area_m2`
        );
      }
      return unit.areaM2;
    }
    case "persons":
      return unit.personsByMonth[month] ?? 0;
    case "flat_count_equal":
      return 1;
    case "fixed":
      throw new Error("accounting: fixed key has no weight");
  }
}

/**
 * Per-unit rate × weight in integer cents, half-up. Area is a decimal m²
 * (e.g. 63.45) — round the product to 1/1000 cent first so binary float
 * drift (35 × 63.45 = 2220.7499999…) cannot flip the half-up decision.
 */
export function perUnitAmountCents(rateCents: number, weight: number): number {
  const exact = Math.round(rateCents * weight * 1000) / 1000;
  return Math.floor(exact + 0.5);
}

/**
 * Computes every assessment row for the given months. Throws when the
 * inputs cannot produce a lawful predpis: a unit without VS, share/area
 * missing for a key that needs it, or a persons-month where nobody lives
 * anywhere (weight sum 0).
 */
export function computeAssessments(input: {
  units: AssessmentUnitInput[];
  services: AssessmentServiceInput[];
  /** Months to generate, each 1-12. */
  months: number[];
}): ComputedAssessment[] {
  const { units, services, months } = input;
  if (units.length === 0) {
    throw new Error("accounting: no units to assess");
  }
  if (services.length === 0) {
    throw new Error("accounting: schedule has no service rows");
  }
  for (const m of months) {
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      throw new Error(`accounting: invalid month ${m}`);
    }
  }
  const missingVs = units.filter((u) => u.vs === "");
  if (missingVs.length > 0) {
    throw new Error(
      `accounting: units without VS: ${missingVs
        .map((u) => u.unitEntityId)
        .join(", ")} — assign variabilné symboly before publishing`
    );
  }

  const result: ComputedAssessment[] = [];

  for (const service of services) {
    for (const month of months) {
      // Index-aligned with `units` — both splitByWeights and the map below
      // preserve input order, so unit i's amount/weight is at index i.
      let amounts: number[];
      let weights: number[];

      if (service.allocationKey === "fixed") {
        if (service.fixedAmountCents === null) {
          throw new Error("accounting: fixed row without fixedAmountCents");
        }
        amounts = units.map(() => service.fixedAmountCents!);
        weights = units.map(() => 1);
      } else {
        if (service.rateCents === null) {
          throw new Error("accounting: rate row without rateCents");
        }
        weights = units.map((u) =>
          unitWeight(u, service.allocationKey, month)
        );
        if (service.rateMode === "per_unit") {
          if (!PER_UNIT_RATE_KEYS.includes(service.allocationKey)) {
            throw new Error(ERR_RATE_MODE_KEY);
          }
          const rate = service.rateCents;
          amounts = weights.map((w) => perUnitAmountCents(rate, w));
        } else {
          amounts = splitByWeights(
            service.rateCents,
            units.map((u, i) => ({ id: u.unitEntityId, weight: weights[i] }))
          ).map((a) => a.amountCents);
        }
      }

      for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        result.push({
          unitEntityId: unit.unitEntityId,
          serviceCategoryId: service.serviceCategoryId,
          month,
          amountCents: amounts[i],
          vs: unit.vs,
          allocationBasisSnapshot: {
            allocationKey: service.allocationKey,
            rateCents: service.rateCents,
            ...(service.rateMode === "per_unit"
              ? { rateMode: "per_unit" as const }
              : {}),
            fixedAmountCents: service.fixedAmountCents,
            weight: weights[i],
            shareNumerator: unit.shareNumerator,
            shareDenominator: unit.shareDenominator,
            areaM2: unit.areaM2,
            persons:
              service.allocationKey === "persons"
                ? unit.personsByMonth[month] ?? 0
                : null,
            totalUnits: units.length,
            ownerUserIds: unit.ownerUserIds,
          },
        });
      }
    }
  }

  return result;
}
