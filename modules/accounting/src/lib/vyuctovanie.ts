import "server-only";

import { and, desc, eq, gte, inArray, isNull, isNotNull, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships, users, notificationPreferences } from "@/db/schema";
import { hasEDeliveryConsent } from "./e-delivery";
import {
  accountingPeriods,
  accounts,
  expenses,
  feeAssessments,
  journalEntries,
  journalLines,
  meterReadings,
  payments,
  paymentAllocations,
  serviceCategories,
  feeSchedules,
  feeScheduleServices,
  settlements,
  settlementUnits,
  unitPersons,
  unitSettings,
  accountingSettings,
  accountingNotificationsSent,
  auditLog,
} from "../db/schema";
import {
  checkSettlementAgainstLedger,
  checkSettlementEntry,
  computeSettlement,
  SettlementEngineError,
  type SettlementInvariantViolation,
  type SettlementResult,
  type SettlementServiceInput,
} from "../engine/settlement";
import { computeHeatSplit } from "../engine/heat";
import { postSettlementClose, type Tx } from "../engine/booking";
import { ACCOUNT_CODES } from "../seeds/coa-sk";
import { SERVICE_CATEGORY_SLUGS } from "../seeds/service-categories-sk";
import { payBySquareString } from "../qr/pay-by-square";
import { sendSettlementPublishedNotification } from "@/lib/email";
import { listDomUnits, domUnitsWhere } from "./dom-units";
import { lockOpenPeriods } from "./periods";
import { postAllDueMonths } from "./fee-schedule-publish";
import { getReadingRoundGate, getResolvedPersonMonths } from "./reading-rounds";

// Ročné vyúčtovanie assembly (BYT-20260512-002 Phase 4). Gates before
// the wizard may proceed (spec §Annual vyúčtovanie wizard):
//   1. zero unmatched bank lines (all money attributed)
//   2. zero uncategorized SERVICE expenses booked into the period
//   3. metered heat / TÚV: either every unit has readings, or none does
//      (then the service splits by its schedule key). Partial metering
//      BLOCKS publish (METER_READINGS_MISSING) — there is no recorded
//      board decision on a "náhradný spôsob" in the module, so silently
//      falling back for the whole building is not allowed.
// Settlement covers the SERVICES okruh only — fond opráv sa nevyúčtováva
// (FPÚO advances accumulate in the fund; only zálohy na služby settle
// annually per §7b zák. 182/1993).
//
// Fix wave 2026-11-18:
//   - result = cost share − PRESCRIBED advances (same basis the ledger books
//     in postSettlementClose); arrears are a separate statement line
//   - costs = what the LEDGER booked into the period (svc 5xx, net of
//     reversals), not expenses filtered by invoice date — an invoice dated
//     in an already-published year is booked into the next open period and
//     must be settled there, not lost from both settlements
//   - each service's cost splits by its real key (see buildKeyWeights)
//   - publish refuses unless the statement ties out to the ledger to the
//     cent (checkSettlementAgainstLedger before, checkSettlementEntry after
//     posting — same transaction, so a mismatch rolls everything back)

type Country = "sk" | "cz";

/** db or an open transaction — publish reads its own uncommitted postings. */
type Dbh = Pick<typeof db, "select" | "selectDistinct"> | Tx;

// Heat rozúčtovanie defaults (vyhláška 269/2015 §3). Heat základní složka is
// configurable within the statutory band (settings.heatBasicSharePct);
// TÚV základní is statutorily fixed at 30 %.
const DEFAULT_HEAT_BASIC_PCT = 40;
const TUV_BASIC_PCT = 30;

/** Stable publish-blocker codes — the UI maps them to i18n. */
export type VyuctovanieBlocker =
  /** A metered split rests on a single in-year reading (absolute counter). */
  | "METER_SINGLE_READING"
  /** Some (not all) units have heat / TÚV readings for the year. */
  | "METER_READINGS_MISSING"
  /** Readings exist but a unit has no započitateľná plocha. */
  | "METER_AREA_MISSING"
  /** The service's key has no data for the year (no assessed month). */
  | "SPLIT_KEY_NO_DATA"
  /** The key's weights sum to 0 (e.g. nobody lived in the house). */
  | "SPLIT_KEY_NO_WEIGHT"
  /** Person-months reported in the reading round are not reviewed yet. */
  | "PERSON_MONTHS_UNRESOLVED"
  /** Service cost booked on 5xx without a service category. */
  | "LEDGER_COST_UNCATEGORIZED"
  /** A service's net booked cost for the period is negative. */
  | "LEDGER_COST_NEGATIVE"
  /** Statement totals do not tie out to the ledger. */
  | "LEDGER_MISMATCH";

/** Stable publish-error codes (blockers + flow errors). */
export type VyuctovanieErrorCode =
  | VyuctovanieBlocker
  | "PERIOD_NOT_FOUND"
  | "PERIOD_NOT_OPEN"
  | "GATES_NOT_PASSED"
  | "UNPRESCRIBED_COSTS"
  | "NOTHING_TO_SETTLE";

export class VyuctovanieError extends Error {
  readonly code: VyuctovanieErrorCode;
  constructor(code: VyuctovanieErrorCode) {
    super(code);
    this.name = "VyuctovanieError";
    this.code = code;
  }
}

export function isVyuctovanieError(err: unknown): err is VyuctovanieError {
  return err instanceof VyuctovanieError;
}

interface MeteredCostShares {
  shares: Map<string, Record<string, number>>;
  /** Units whose metered split used a single in-year reading. */
  singleReadingUnitIds: Set<string>;
  /** categoryId → units without any reading (partial metering). */
  missingReadings: Map<string, string[]>;
  /** categoryId → units without plocha (metered service). */
  missingArea: Map<string, string[]>;
}

/**
 * Metered cost split for SVC_HEAT / SVC_WATER_HOT (vyhláška 269/2015).
 * Per category with real cost:
 *   - no unit has a reading → not metered; the caller splits by the key
 *   - SOME units lack a reading → blocker (missingReadings), no split
 *   - a unit lacks plocha → blocker (missingArea), no split
 *   - otherwise the metered split (shares)
 */
async function buildMeteredCostShares(
  dbh: Dbh,
  input: {
    entityId: string;
    yearStart: Date;
    yearEnd: Date;
    units: { id: string }[];
    categoryIdBySlug: Record<string, string>;
    costByCategory: Map<string, number>;
    heatBasicPct: number;
  }
): Promise<MeteredCostShares> {
  const out: MeteredCostShares = {
    shares: new Map(),
    singleReadingUnitIds: new Set(),
    missingReadings: new Map(),
    missingArea: new Map(),
  };
  const plans = (
    [
      {
        slug: SERVICE_CATEGORY_SLUGS.SVC_HEAT,
        meterType: "heat" as const,
        basicPct: input.heatBasicPct,
      },
      {
        slug: SERVICE_CATEGORY_SLUGS.SVC_WATER_HOT,
        meterType: "water_hot" as const,
        basicPct: TUV_BASIC_PCT,
      },
    ]
  )
    .map((p) => ({ ...p, categoryId: input.categoryIdBySlug[p.slug] }))
    .filter(
      (p) => p.categoryId && (input.costByCategory.get(p.categoryId) ?? 0) > 0
    );
  if (plans.length === 0) return out;

  const areaRows = await dbh
    .select({
      id: entities.id,
      areaMilli: sql<
        number | null
      >`round((${entities.data}->>'area_m2')::numeric * 1000)::int`,
    })
    .from(entities)
    .where(domUnitsWhere(input.entityId));
  const areaByUnit = new Map(areaRows.map((r) => [r.id, r.areaMilli ?? 0]));

  // Readings for the metered types, date-ordered.
  const rows = await dbh
    .select({
      unitId: meterReadings.unitEntityId,
      type: meterReadings.meterType,
      value: meterReadings.valueMilli,
    })
    .from(meterReadings)
    .where(
      and(
        eq(meterReadings.entityId, input.entityId),
        isNull(meterReadings.voidedAt),
        gte(meterReadings.readingDate, input.yearStart),
        lt(meterReadings.readingDate, input.yearEnd),
        inArray(
          meterReadings.meterType,
          plans.map((p) => p.meterType)
        )
      )
    )
    .orderBy(meterReadings.readingDate);

  const byTypeUnit = new Map<string, number[]>();
  for (const r of rows) {
    const key = `${r.type}|${r.unitId}`;
    const arr = byTypeUnit.get(key);
    if (arr) arr.push(r.value);
    else byTypeUnit.set(key, [r.value]);
  }
  // Consumption = counter delta (last − first) when ≥2 readings, else the
  // single value; a negative delta (counter reset) clamps to 0.
  const consFor = (type: string, unitId: string): number | null => {
    const v = byTypeUnit.get(`${type}|${unitId}`);
    if (!v || v.length === 0) return null;
    if (v.length === 1) return v[0];
    return Math.max(0, v[v.length - 1] - v[0]);
  };

  for (const plan of plans) {
    const cons = input.units.map((u) => ({
      unitId: u.id,
      c: consFor(plan.meterType, u.id),
    }));
    const missing = cons.filter((x) => x.c === null).map((x) => x.unitId);
    if (missing.length === cons.length) continue; // not metered at all
    if (missing.length > 0) {
      out.missingReadings.set(plan.categoryId, missing);
      continue;
    }
    const noArea = input.units
      .filter((u) => (areaByUnit.get(u.id) ?? 0) <= 0)
      .map((u) => u.id);
    if (noArea.length > 0) {
      out.missingArea.set(plan.categoryId, noArea);
      continue;
    }
    // A lone reading is an absolute counter state, not the year's
    // consumption — recorded so publish refuses (METER_SINGLE_READING).
    for (const u of input.units) {
      if ((byTypeUnit.get(`${plan.meterType}|${u.id}`)?.length ?? 0) === 1) {
        out.singleReadingUnitIds.add(u.id);
      }
    }
    const split = computeHeatSplit(
      input.costByCategory.get(plan.categoryId)!,
      input.units.map((u) => ({
        unitId: u.id,
        areaMilliM2: areaByUnit.get(u.id)!,
        consumptionMilli: cons.find((x) => x.unitId === u.id)!.c!,
      })),
      { basicSharePct: plan.basicPct }
    );
    out.shares.set(
      plan.categoryId,
      Object.fromEntries(split.units.map((s) => [s.unitId, s.finalCents]))
    );
  }
  return out;
}

type WeightedKey = "share" | "area_m2" | "persons" | "flat_count_equal";
const WEIGHTED_KEYS: readonly string[] = ["share", "area_m2", "persons", "flat_count_equal"];

interface SplitKeyIssue {
  categoryId: string;
  key: string;
  code: "SPLIT_KEY_NO_DATA" | "SPLIT_KEY_NO_WEIGHT" | "PERSON_MONTHS_UNRESOLVED";
}

/**
 * Year weights per (category, unit) for the key-split services.
 *
 *   share / area_m2 / flat_count_equal — from the assessment snapshots the
 *     predpis froze for the year (scope rule: the year's data, never later
 *     edits). Per assessed month the unit's fraction w / Σw; the year weight
 *     is the sum of those fractions, so a mid-year change (new unit, share
 *     correction) is time-weighted. Only months assessed under the same key
 *     count.
 *   persons — person-months of the year: the reading round's RESOLVED
 *     person-months win; months without one fall back to the
 *     mod_accounting_unit_persons history effective at month start. Only
 *     the months the service was assessed count.
 */
async function buildKeyWeights(
  dbh: Dbh,
  input: {
    entityId: string;
    periodId: string;
    year: number;
    unitIds: string[];
    plans: { categoryId: string; key: WeightedKey }[];
  }
): Promise<{ weights: Map<string, Record<string, number>>; issues: SplitKeyIssue[] }> {
  const weights = new Map<string, Record<string, number>>();
  const issues: SplitKeyIssue[] = [];
  if (input.plans.length === 0) return { weights, issues };

  const snapshotRows = await dbh
    .select({
      unitEntityId: feeAssessments.unitEntityId,
      serviceCategoryId: feeAssessments.serviceCategoryId,
      month: feeAssessments.month,
      key: sql<string | null>`${feeAssessments.allocationBasisSnapshot}->>'allocationKey'`,
      weight: sql<number | null>`(${feeAssessments.allocationBasisSnapshot}->>'weight')::float8`,
    })
    .from(feeAssessments)
    .where(
      and(
        eq(feeAssessments.periodId, input.periodId),
        inArray(
          feeAssessments.serviceCategoryId,
          input.plans.map((p) => p.categoryId)
        )
      )
    );

  const needsPersons = input.plans.some((p) => p.key === "persons");
  const persons = needsPersons
    ? await loadPersonMonths(dbh, input.entityId, input.year, input.unitIds)
    : null;

  for (const plan of input.plans) {
    const rows = snapshotRows.filter((r) => r.serviceCategoryId === plan.categoryId);
    const months = [...new Set(rows.map((r) => r.month))].sort((a, b) => a - b);
    if (months.length === 0) {
      issues.push({ categoryId: plan.categoryId, key: plan.key, code: "SPLIT_KEY_NO_DATA" });
      continue;
    }
    const w: Record<string, number> = Object.fromEntries(input.unitIds.map((id) => [id, 0]));

    if (plan.key === "persons") {
      if (persons!.unresolved > 0) {
        issues.push({ categoryId: plan.categoryId, key: plan.key, code: "PERSON_MONTHS_UNRESOLVED" });
      }
      for (const id of input.unitIds) {
        for (const m of months) w[id] += persons!.countFor(id, m);
      }
    } else {
      let matched = 0;
      for (const m of months) {
        const monthRows = rows.filter(
          (r) => r.month === m && r.key === plan.key && (r.weight ?? 0) > 0
        );
        const sum = monthRows.reduce((s, r) => s + (r.weight ?? 0), 0);
        if (sum <= 0) continue;
        matched += 1;
        for (const r of monthRows) {
          if (r.unitEntityId in w) w[r.unitEntityId] += (r.weight ?? 0) / sum;
        }
      }
      if (matched === 0) {
        issues.push({ categoryId: plan.categoryId, key: plan.key, code: "SPLIT_KEY_NO_DATA" });
        continue;
      }
    }

    if (Object.values(w).reduce((s, v) => s + v, 0) <= 0) {
      issues.push({ categoryId: plan.categoryId, key: plan.key, code: "SPLIT_KEY_NO_WEIGHT" });
      continue;
    }
    weights.set(plan.categoryId, w);
  }
  return { weights, issues };
}

async function loadPersonMonths(
  dbh: Dbh,
  entityId: string,
  year: number,
  unitIds: string[]
): Promise<{ unresolved: number; countFor: (unitId: string, month: number) => number }> {
  const round = await getResolvedPersonMonths(dbh, entityId, year);
  const history = unitIds.length
    ? await dbh
        .select({
          unitEntityId: unitPersons.unitEntityId,
          personsCount: unitPersons.personsCount,
          effectiveFrom: unitPersons.effectiveFrom,
        })
        .from(unitPersons)
        .where(inArray(unitPersons.unitEntityId, unitIds))
        .orderBy(unitPersons.effectiveFrom, unitPersons.createdAt)
    : [];
  return {
    unresolved: round.unresolved,
    countFor: (unitId, month) => {
      const reported = round.resolved.get(`${unitId}|${month}`);
      if (reported !== undefined) return reported;
      const monthStart = new Date(Date.UTC(year, month - 1, 1)).getTime();
      let current = 0;
      for (const h of history) {
        if (h.unitEntityId !== unitId) continue;
        if (h.effectiveFrom.getTime() <= monthStart) current = h.personsCount;
      }
      return current;
    },
  };
}

/**
 * Net service cost the LEDGER booked into the period per category: Σ(Dr − Cr)
 * on svc 5xx lines, excluding the settlement close itself. Includes invoices
 * dated in an earlier (locked) year but booked here, and void reversals.
 */
async function loadLedgerSvcCosts(
  dbh: Dbh,
  entityId: string,
  periodId: string
): Promise<{ byCategory: Map<string, number>; uncategorizedCents: number }> {
  const rows = await dbh
    .select({
      serviceCategoryId: journalLines.serviceCategoryId,
      net: sql<number>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}), 0)::int`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(
      and(
        eq(journalEntries.entityId, entityId),
        eq(journalEntries.periodId, periodId),
        ne(journalEntries.sourceType, "settlement"),
        eq(journalLines.okruh, "svc"),
        sql`${accounts.code} like '5%'`
      )
    )
    .groupBy(journalLines.serviceCategoryId);
  const byCategory = new Map<string, number>();
  let uncategorizedCents = 0;
  for (const r of rows) {
    if (r.serviceCategoryId) byCategory.set(r.serviceCategoryId, r.net);
    else uncategorizedCents += r.net;
  }
  return { byCategory, uncategorizedCents };
}

/** Predpis posted to 311 (svc) per unit for the period. */
async function loadLedgerPrescribedByUnit(
  dbh: Dbh,
  entityId: string,
  periodId: string
): Promise<Record<string, number>> {
  const rows = await dbh
    .select({
      unitEntityId: journalLines.unitEntityId,
      net: sql<number>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}), 0)::int`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(
      and(
        eq(journalEntries.entityId, entityId),
        eq(journalEntries.periodId, periodId),
        eq(journalEntries.sourceType, "fee_schedule_publish"),
        eq(journalLines.okruh, "svc"),
        eq(accounts.code, ACCOUNT_CODES.POHLADAVKY_VLASTNICI_SLUZBY),
        isNotNull(journalLines.unitEntityId)
      )
    )
    .groupBy(journalLines.unitEntityId);
  return Object.fromEntries(rows.map((r) => [r.unitEntityId as string, r.net]));
}

export interface VyuctovanieGates {
  periodStatus: "missing" | "open" | "reconciling" | "published" | "closed";
  unmatchedBankLines: number;
  uncategorizedExpenses: number;
  unitsWithoutReadings: number;
  /** Reading round of the year (BYT-20261118-006) — informational. */
  readingRound: {
    hasRound: boolean;
    missingUnits: number;
    unresolvedUnits: number;
    singleReadingUnits: number;
  };
  /** The year must be OVER — a mid-year publish would settle 12 months
   * of prescriptions against a partial year of postings and costs. */
  yearElapsed: boolean;
  /** Draft schedules for the year — locking strands them unpublishable. */
  draftSchedules: number;
  /** Units whose METERED heat / TÚV split rests on a single in-year
   * reading. Blocks publish (METER_SINGLE_READING). */
  meteredSingleReadingUnits: number;
  /** Stable codes of extra publish blockers (beyond the checklist above). */
  blockers: VyuctovanieBlocker[];
  /** Gates clear, year over, period open, no blockers. */
  canPublish: boolean;
}

export interface VyuctovanieBlockerDetails {
  /** Partial metering: per service, the units without a reading. */
  meterReadingsMissing: { categoryId: string; unitIds: string[] }[];
  /** Metered service, units without plocha. */
  meterAreaMissing: { categoryId: string; unitIds: string[] }[];
  /** Key-split problems per service. */
  splitKey: SplitKeyIssue[];
  /** Categories whose net booked cost is negative. */
  negativeCostCategoryIds: string[];
  /** Statement ↔ ledger mismatches (cents). */
  ledgerViolations: SettlementInvariantViolation[];
}

export interface VyuctovaniePreview {
  year: number;
  gates: VyuctovanieGates;
  blockerDetails: VyuctovanieBlockerDetails;
  /** Null until gates 1+2 pass — a broken preview must not look official. */
  settlement: SettlementResult | null;
  /** Categories with real cost but ZERO prescription — publish refuses. */
  unprescribedCostCategories: string[];
  categorySlugs: Record<string, string>;
  unitLabels: Record<string, string>;
}

async function computeGates(
  dbh: Dbh,
  entityId: string,
  year: number
): Promise<VyuctovanieGates & { periodId: string | null }> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const [period] = await dbh
    .select({ id: accountingPeriods.id, status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        eq(accountingPeriods.year, year)
      )
    );

  const [unmatched] = await dbh
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .where(
      and(
        eq(payments.entityId, entityId),
        inArray(payments.source, ["bank_import", "fio_api", "enable_banking_api"]),
        isNull(payments.journalEntryId),
        isNull(payments.voidedAt)
      )
    );

  // Uncategorized invoices BOOKED INTO this period (not by invoice date —
  // a late invoice of a locked year settles here).
  const [uncategorized] = period
    ? await dbh
        .select({ n: sql<number>`count(*)::int` })
        .from(expenses)
        .innerJoin(journalEntries, eq(expenses.journalEntryId, journalEntries.id))
        .where(
          and(
            eq(expenses.entityId, entityId),
            isNull(expenses.voidedAt),
            isNull(expenses.serviceCategoryId),
            eq(journalEntries.periodId, period.id)
          )
        )
    : [{ n: 0 }];

  const units = await listDomUnits(entityId);
  const withReadings = await dbh
    .selectDistinct({ unitEntityId: meterReadings.unitEntityId })
    .from(meterReadings)
    .where(
      and(
        eq(meterReadings.entityId, entityId),
        isNull(meterReadings.voidedAt),
        gte(meterReadings.readingDate, yearStart),
        lt(meterReadings.readingDate, yearEnd)
      )
    );
  const readingUnitIds = new Set(withReadings.map((r) => r.unitEntityId));
  const unitsWithoutReadings = units.filter(
    (u) => !readingUnitIds.has(u.id)
  ).length;

  const [drafts] = await dbh
    .select({ n: sql<number>`count(*)::int` })
    .from(feeSchedules)
    .innerJoin(
      accountingPeriods,
      eq(feeSchedules.periodId, accountingPeriods.id)
    )
    .where(
      and(
        eq(feeSchedules.entityId, entityId),
        eq(accountingPeriods.year, year),
        eq(feeSchedules.status, "draft")
      )
    );

  const yearElapsed = year < new Date().getUTCFullYear();
  const periodStatus = period?.status ?? "missing";
  return {
    periodId: period?.id ?? null,
    periodStatus,
    unmatchedBankLines: unmatched.n,
    uncategorizedExpenses: uncategorized.n,
    unitsWithoutReadings,
    readingRound: await getReadingRoundGate(entityId, year),
    yearElapsed,
    draftSchedules: drafts.n,
    meteredSingleReadingUnits: 0,
    blockers: [],
    canPublish:
      periodStatus === "open" &&
      yearElapsed &&
      unmatched.n === 0 &&
      uncategorized.n === 0,
  };
}

const emptyDetails = (): VyuctovanieBlockerDetails => ({
  meterReadingsMissing: [],
  meterAreaMissing: [],
  splitKey: [],
  negativeCostCategoryIds: [],
  ledgerViolations: [],
});

export async function getVyuctovaniePreview(
  entityId: string,
  country: Country,
  year: number,
  /** Pass the publish transaction so its own postings are visible. */
  dbh: Dbh = db,
  opts: { requireFullyPosted?: boolean } = {}
): Promise<VyuctovaniePreview> {
  const { periodId, ...gates } = await computeGates(dbh, entityId, year);
  const units = await listDomUnits(entityId);
  const unitLabels = Object.fromEntries(
    units.map((u) => [u.id, u.flatNumber ?? u.name])
  );

  const categories = await dbh
    .select({
      id: serviceCategories.id,
      slug: serviceCategories.slug,
      okruh: serviceCategories.okruh,
    })
    .from(serviceCategories)
    .where(eq(serviceCategories.country, country));
  const categorySlugs = Object.fromEntries(
    categories.map((c) => [c.id, c.slug])
  );
  const details = emptyDetails();

  if (
    !periodId ||
    gates.unmatchedBankLines > 0 ||
    gates.uncategorizedExpenses > 0
  ) {
    return {
      year,
      gates,
      blockerDetails: details,
      settlement: null,
      unprescribedCostCategories: [],
      categorySlugs,
      unitLabels,
    };
  }

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));
  const blockers = new Set<VyuctovanieBlocker>();
  const svcCategoryIds = new Set(
    categories.filter((c) => c.okruh === "svc").map((c) => c.id)
  );

  // Actual costs per SERVICES-okruh category: what the ledger booked into
  // the period (fix: by accounting period, not by invoice date).
  const ledgerCosts = await loadLedgerSvcCosts(dbh, entityId, periodId);
  let uncategorizedCost = ledgerCosts.uncategorizedCents;
  const costByCategory = new Map<string, number>();
  for (const [catId, net] of ledgerCosts.byCategory) {
    if (!svcCategoryIds.has(catId)) {
      uncategorizedCost += net;
      continue;
    }
    if (net < 0) details.negativeCostCategoryIds.push(catId);
    costByCategory.set(catId, net);
  }
  if (uncategorizedCost !== 0) blockers.add("LEDGER_COST_UNCATEGORIZED");
  if (details.negativeCostCategoryIds.length > 0) blockers.add("LEDGER_COST_NEGATIVE");

  // Prescribed per (category, unit) — the year's assessments.
  const prescribed = await dbh
    .select({
      serviceCategoryId: feeAssessments.serviceCategoryId,
      unitEntityId: feeAssessments.unitEntityId,
      total: sql<number>`sum(${feeAssessments.amountCents})::int`,
      unposted: sql<number>`count(*) filter (where ${feeAssessments.journalEntryId} is null)::int`,
    })
    .from(feeAssessments)
    .where(eq(feeAssessments.periodId, periodId))
    .groupBy(feeAssessments.serviceCategoryId, feeAssessments.unitEntityId);
  const unpostedAssessments = prescribed.reduce((s, p) => s + p.unposted, 0);

  // Advances per (category, unit): non-voided payment allocations against
  // the year's assessments (informational — the result settles against the
  // prescription; prescribed − paid is the separate arrears line).
  const advances = await dbh
    .select({
      serviceCategoryId: feeAssessments.serviceCategoryId,
      unitEntityId: feeAssessments.unitEntityId,
      total: sql<number>`sum(${paymentAllocations.amountCents})::int`,
    })
    .from(paymentAllocations)
    .innerJoin(
      feeAssessments,
      eq(paymentAllocations.assessmentId, feeAssessments.id)
    )
    .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
    .where(
      and(
        eq(feeAssessments.periodId, periodId),
        isNull(payments.voidedAt)
      )
    )
    .groupBy(feeAssessments.serviceCategoryId, feeAssessments.unitEntityId);

  const categoryIds = new Set<string>();
  for (const id of costByCategory.keys()) categoryIds.add(id);
  for (const p of prescribed) {
    if (svcCategoryIds.has(p.serviceCategoryId)) {
      categoryIds.add(p.serviceCategoryId);
    }
  }

  // Metered heat/TÚV split (vyhláška 269/2015).
  const [heatSettingRow] = await dbh
    .select({ h: accountingSettings.heatBasicSharePct })
    .from(accountingSettings)
    .where(
      and(
        eq(accountingSettings.entityId, entityId),
        sql`${accountingSettings.effectiveFrom} <= now()`
      )
    )
    .orderBy(desc(accountingSettings.effectiveFrom))
    .limit(1);
  const metered = await buildMeteredCostShares(dbh, {
    entityId,
    yearStart,
    yearEnd,
    units,
    categoryIdBySlug: Object.fromEntries(categories.map((c) => [c.slug, c.id])),
    costByCategory,
    heatBasicPct: heatSettingRow?.h ?? DEFAULT_HEAT_BASIC_PCT,
  });
  for (const [categoryId, unitIds] of metered.missingReadings) {
    details.meterReadingsMissing.push({ categoryId, unitIds });
    blockers.add("METER_READINGS_MISSING");
  }
  for (const [categoryId, unitIds] of metered.missingArea) {
    details.meterAreaMissing.push({ categoryId, unitIds });
    blockers.add("METER_AREA_MISSING");
  }
  if (metered.singleReadingUnitIds.size > 0) blockers.add("METER_SINGLE_READING");

  // Allocation key per category from the year's published schedule(s) — the
  // latest schedule's key wins; it is both the split key and the statutory
  // "použitý kľúč rozúčtovania" on the vyúčtovanie (AC 442).
  const scheduleKeys = await dbh
    .select({
      serviceCategoryId: feeScheduleServices.serviceCategoryId,
      allocationKey: feeScheduleServices.allocationKey,
    })
    .from(feeScheduleServices)
    .innerJoin(feeSchedules, eq(feeScheduleServices.scheduleId, feeSchedules.id))
    .where(
      and(
        eq(feeSchedules.entityId, entityId),
        eq(feeSchedules.periodId, periodId),
        eq(feeSchedules.status, "published")
      )
    )
    .orderBy(feeSchedules.effectiveFrom);
  const keyByCategory = new Map<string, string>();
  for (const r of scheduleKeys) keyByCategory.set(r.serviceCategoryId, r.allocationKey);

  const keyPlans = [...categoryIds]
    .filter(
      (id) =>
        !metered.shares.has(id) &&
        (costByCategory.get(id) ?? 0) > 0 &&
        WEIGHTED_KEYS.includes(keyByCategory.get(id) ?? "")
    )
    .map((id) => ({ categoryId: id, key: keyByCategory.get(id) as WeightedKey }));
  const keyWeights = await buildKeyWeights(dbh, {
    entityId,
    periodId,
    year,
    unitIds: units.map((u) => u.id),
    plans: keyPlans,
  });
  for (const issue of keyWeights.issues) {
    details.splitKey.push(issue);
    blockers.add(issue.code);
  }

  const services: SettlementServiceInput[] = [...categoryIds].map((id) => ({
    serviceCategoryId: id,
    actualCostCents: Math.max(0, costByCategory.get(id) ?? 0),
    prescribedByUnit: Object.fromEntries(
      prescribed
        .filter((p) => p.serviceCategoryId === id)
        .map((p) => [p.unitEntityId, p.total])
    ),
    advancesByUnit: Object.fromEntries(
      advances
        .filter((a) => a.serviceCategoryId === id)
        .map((a) => [a.unitEntityId, a.total])
    ),
    costShareByUnit: metered.shares.get(id),
    weightsByUnit: metered.shares.has(id) ? undefined : keyWeights.weights.get(id),
    allocationKey: metered.shares.get(id) ? "meters" : keyByCategory.get(id) ?? null,
  }));

  let settlement: SettlementResult | null = null;
  if (units.length > 0 && services.length > 0) {
    try {
      settlement = computeSettlement({ unitIds: units.map((u) => u.id), services });
    } catch (err) {
      // Pre-checks above make engine errors unreachable in practice; if one
      // still fires, no statement is shown and publish stays blocked.
      if (!(err instanceof SettlementEngineError)) throw err;
      blockers.add("LEDGER_MISMATCH");
    }
  }

  // Statement ↔ ledger, to the cent. The prescription leg needs every
  // assessment posted — the preview skips it while due months are unposted
  // (publish posts them first and then requires it).
  if (settlement && details.negativeCostCategoryIds.length === 0) {
    const ledgerPrescribed =
      unpostedAssessments === 0 || opts.requireFullyPosted
        ? await loadLedgerPrescribedByUnit(dbh, entityId, periodId)
        : null;
    details.ledgerViolations = checkSettlementAgainstLedger(settlement, {
      costByCategory: Object.fromEntries(costByCategory),
      prescribedByUnit: ledgerPrescribed,
    });
    if (details.ledgerViolations.length > 0) blockers.add("LEDGER_MISMATCH");
  }

  const unprescribedCostCategories = services
    .filter(
      (s) =>
        s.actualCostCents > 0 &&
        Object.values(s.prescribedByUnit).reduce((a, b) => a + b, 0) === 0
    )
    .map((s) => categorySlugs[s.serviceCategoryId] ?? s.serviceCategoryId);

  const blockerList = [...blockers];
  return {
    year,
    gates: {
      ...gates,
      meteredSingleReadingUnits: metered.singleReadingUnitIds.size,
      blockers: blockerList,
      canPublish:
        gates.canPublish &&
        blockerList.length === 0 &&
        unprescribedCostCategories.length === 0,
    },
    blockerDetails: details,
    settlement,
    unprescribedCostCategories,
    categorySlugs,
    unitLabels,
  };
}

export interface DeliverySummary {
  notified: number;
  skippedAlreadySent: number;
  skippedNoEmail: number;
  failed: number;
  /**
   * AC 426 — owners WITHOUT electronic-delivery consent. They are NOT
   * emailed the statement; they fall back to listinné doručenie (a postal
   * print run) — the treasurer downloads their vyúčtovanie PDFs for post.
   */
  postal: { userId: string; unitEntityId: string; name: string | null }[];
}

/**
 * Emails every owner whose unit is on the settlement that the statement
 * is ready in the app. Per-recipient dedupe via
 * mod_accounting_notifications_sent — safe to re-run (retry only reaches
 * previously failed/new recipients). This is a NOTIFICATION; the
 * statutory delivery channel (electronic-consent vs listinné) is a
 * separate future flow.
 */
export async function notifySettlementPublished(input: {
  entityId: string;
  settlementId: string;
  buildingName: string;
  appBaseUrl: string;
}): Promise<DeliverySummary> {
  const [header] = await db
    .select({ year: accountingPeriods.year })
    .from(settlements)
    .innerJoin(
      accountingPeriods,
      eq(settlements.periodId, accountingPeriods.id)
    )
    .where(
      and(
        eq(settlements.id, input.settlementId),
        eq(settlements.entityId, input.entityId)
      )
    );
  if (!header) throw new Error("accounting: settlement not found");

  // Owners of the settled units, with their unit for the deep link and
  // their electronic-delivery consent (AC 426). LEFT JOIN so an owner who
  // never touched notification settings is treated as no-consent (postal).
  const recipients = await db
    .selectDistinct({
      userId: users.id,
      name: users.name,
      email: users.email,
      unitEntityId: settlementUnits.unitEntityId,
      consentAt: notificationPreferences.evyuctConsentAt,
      withdrawnAt: notificationPreferences.evyuctWithdrawnAt,
    })
    .from(settlementUnits)
    .innerJoin(
      memberships,
      eq(memberships.entityId, settlementUnits.unitEntityId)
    )
    .innerJoin(users, eq(memberships.userId, users.id))
    .leftJoin(
      notificationPreferences,
      eq(notificationPreferences.userId, users.id)
    )
    .where(
      and(
        eq(settlementUnits.settlementId, input.settlementId),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active")
      )
    );

  const already = await db
    .select({ recipientId: accountingNotificationsSent.recipientId })
    .from(accountingNotificationsSent)
    .where(
      and(
        eq(accountingNotificationsSent.kind, "settlement_published"),
        eq(accountingNotificationsSent.settlementId, input.settlementId)
      )
    );
  const sentTo = new Set(already.map((r) => r.recipientId));

  const summary: DeliverySummary = {
    notified: 0,
    skippedAlreadySent: 0,
    skippedNoEmail: 0,
    failed: 0,
    postal: [],
  };
  const seenUser = new Set<string>();

  for (const recipient of recipients) {
    // AC 426 — only owners who consented to electronic delivery get the
    // statement by email; the rest go to the postal print run.
    const consented = hasEDeliveryConsent({
      consentAt: recipient.consentAt,
      withdrawnAt: recipient.withdrawnAt,
    });
    if (!consented) {
      // ONE postal mailing per UNIT: a non-consenting owner of several
      // settled units needs each unit's statement mailed. The dedup below
      // is deliberately AFTER this branch — it only collapses the e-mail
      // path (one e-mail per owner links to their karta), never the postal
      // run. selectDistinct already collapses duplicate (owner, unit) rows.
      summary.postal.push({
        userId: recipient.userId,
        unitEntityId: recipient.unitEntityId,
        name: recipient.name,
      });
      continue;
    }
    if (seenUser.has(recipient.userId)) continue;
    seenUser.add(recipient.userId);
    if (sentTo.has(recipient.userId)) {
      summary.skippedAlreadySent += 1;
      continue;
    }
    if (!recipient.email) {
      summary.skippedNoEmail += 1;
      continue;
    }
    const ok = await sendSettlementPublishedNotification({
      recipientEmail: recipient.email,
      recipientName: recipient.name,
      buildingName: input.buildingName,
      year: header.year,
      kartaUrl: `${input.appBaseUrl}/accounting/karta/${recipient.unitEntityId}`,
    });
    if (!ok) {
      summary.failed += 1;
      continue;
    }
    await db.insert(accountingNotificationsSent).values({
      entityId: input.entityId,
      kind: "settlement_published",
      recipientId: recipient.userId,
      settlementId: input.settlementId,
    });
    summary.notified += 1;
  }

  return summary;
}

/** Years with a PUBLISHED settlement covering the unit (newest first). */
export async function listSettlementYearsForUnit(
  entityId: string,
  unitEntityId: string
): Promise<number[]> {
  const rows = await db
    .select({ year: accountingPeriods.year })
    .from(settlementUnits)
    .innerJoin(
      settlements,
      eq(settlementUnits.settlementId, settlements.id)
    )
    .innerJoin(
      accountingPeriods,
      eq(settlements.periodId, accountingPeriods.id)
    )
    .where(
      and(
        eq(settlements.entityId, entityId),
        eq(settlementUnits.unitEntityId, unitEntityId)
      )
    )
    .orderBy(sql`${accountingPeriods.year} desc`);
  return rows.map((r) => r.year);
}

export interface VyuctovaniePdfData {
  year: number;
  unitLabel: string;
  vs: string | null;
  publishedAt: string;
  lines: {
    categorySlug: string;
    prescribedCents: number;
    advancesCents: number;
    /** prescribed − paid (arrears, not part of the result). */
    unpaidCents: number;
    costShareCents: number;
    differenceCents: number;
    /** Allocation key used (AC 442); null for legacy settlements. */
    allocationKey: string | null;
  }[];
  /**
   * "prescribed": result = cost − predpísané zálohy, arrears listed apart
   * (settlements published after the 2026-11-18 fix). "paid": legacy
   * statement, result = cost − uhradené zálohy — rendered in its original
   * layout, never re-interpreted (the delivered document is frozen).
   */
  basis: "prescribed" | "paid";
  totalCostCents: number;
  totalPrescribedCents: number;
  totalAdvancesCents: number;
  totalUnpaidCents: number;
  totalDifferenceCents: number;
  iban: string | null;
  /** Dynamic PAY by square for the nedoplatok — null when nothing owed. */
  payBySquare: string | null;
}

/**
 * The unit's PUBLISHED statement for the year — read from the frozen
 * settlement rows, never recomputed (the stored payload is the legally
 * delivered document). SK-only for now: the statutory citations in the
 * PDF template belong to zák. 182/1993 and must not serve a CZ instance
 * (template-aware rule); the CZ template ships with Phase 6.
 */
export async function getVyuctovaniePdfData(input: {
  entityId: string;
  country: Country;
  unitEntityId: string;
  year: number;
  beneficiaryName: string;
}): Promise<VyuctovaniePdfData> {
  if (input.country !== "sk") {
    throw new Error(
      "accounting: the CZ vyúčtování template ships with Phase 6 — SK template must not serve other countries"
    );
  }

  const [row] = await db
    .select({
      payload: settlementUnits.payload,
      totalCostCents: settlementUnits.totalCostCents,
      totalAdvancesCents: settlementUnits.totalAdvancesCents,
      totalDifferenceCents: settlementUnits.totalDifferenceCents,
      publishedAt: settlements.publishedAt,
    })
    .from(settlementUnits)
    .innerJoin(settlements, eq(settlementUnits.settlementId, settlements.id))
    .innerJoin(
      accountingPeriods,
      eq(settlements.periodId, accountingPeriods.id)
    )
    .where(
      and(
        eq(settlements.entityId, input.entityId),
        eq(settlementUnits.unitEntityId, input.unitEntityId),
        eq(accountingPeriods.year, input.year)
      )
    );
  if (!row) {
    throw new Error("accounting: no published vyúčtovanie for the year");
  }

  const units = await listDomUnits(input.entityId);
  const unit = units.find((u) => u.id === input.unitEntityId);
  if (!unit) throw new Error("accounting: unknown unit");

  const categories = await db
    .select({ id: serviceCategories.id, slug: serviceCategories.slug })
    .from(serviceCategories)
    .where(eq(serviceCategories.country, input.country));
  const slugById = new Map(categories.map((c) => [c.id, c.slug]));

  const payloadLines = row.payload as {
    serviceCategoryId: string;
    prescribedCents: number;
    advancesCents: number;
    costShareCents: number;
    differenceCents: number;
    allocationKey?: string | null;
    unpaidCents?: number;
    basis?: "prescribed";
  }[];
  const basis: VyuctovaniePdfData["basis"] =
    payloadLines.length > 0 && payloadLines.every((l) => l.basis === "prescribed")
      ? "prescribed"
      : "paid";
  const lines = payloadLines.map((l) => ({
    categorySlug: slugById.get(l.serviceCategoryId) ?? l.serviceCategoryId,
    prescribedCents: l.prescribedCents,
    advancesCents: l.advancesCents,
    unpaidCents: l.unpaidCents ?? l.prescribedCents - l.advancesCents,
    costShareCents: l.costShareCents,
    differenceCents: l.differenceCents,
    allocationKey: l.allocationKey ?? null,
  }));
  const totalPrescribedCents = lines.reduce((s, l) => s + l.prescribedCents, 0);
  const totalUnpaidCents = lines.reduce((s, l) => s + l.unpaidCents, 0);

  const [vsRow] = await db
    .select({ vs: unitSettings.vs })
    .from(unitSettings)
    .where(eq(unitSettings.unitEntityId, input.unitEntityId));

  const settings = await getSettingsIban(input.entityId);
  let payBySquare: string | null = null;
  if (row.totalDifferenceCents > 0 && settings && vsRow?.vs) {
    payBySquare = payBySquareString({
      iban: settings,
      amountCents: row.totalDifferenceCents,
      vs: vsRow.vs,
      beneficiaryName: input.beneficiaryName,
      note: `Vyuctovanie ${input.year}`,
    });
  }

  return {
    year: input.year,
    unitLabel: unit.flatNumber ?? unit.name,
    vs: vsRow?.vs ?? null,
    publishedAt: row.publishedAt.toISOString(),
    lines,
    basis,
    totalCostCents: row.totalCostCents,
    totalPrescribedCents,
    totalAdvancesCents: row.totalAdvancesCents,
    totalUnpaidCents,
    totalDifferenceCents: row.totalDifferenceCents,
    iban: settings,
    payBySquare,
  };
}

async function getSettingsIban(entityId: string): Promise<string | null> {
  const [row] = await db
    .select({ bankIban: accountingSettings.bankIban })
    .from(accountingSettings)
    .where(
      and(
        eq(accountingSettings.entityId, entityId),
        sql`${accountingSettings.effectiveFrom} <= now()`
      )
    )
    .orderBy(sql`${accountingSettings.effectiveFrom} desc`)
    .limit(1);
  return row?.bankIban ?? null;
}

/** Per-unit (Dr 311 − Cr 379) and per-category 5xx credits of an entry. */
async function loadSettlementEntryTotals(
  tx: Tx,
  entryId: string
): Promise<{
  unitNetByUnit: Record<string, number>;
  costCreditByCategory: Record<string, number>;
}> {
  const lines = await tx
    .select({
      code: accounts.code,
      unitEntityId: journalLines.unitEntityId,
      serviceCategoryId: journalLines.serviceCategoryId,
      debitCents: journalLines.debitCents,
      creditCents: journalLines.creditCents,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(eq(journalLines.journalEntryId, entryId));
  const unitNetByUnit: Record<string, number> = {};
  const costCreditByCategory: Record<string, number> = {};
  for (const l of lines) {
    if (
      l.unitEntityId &&
      (l.code === ACCOUNT_CODES.POHLADAVKY_VLASTNICI_SLUZBY ||
        l.code === ACCOUNT_CODES.INE_ZAVAZKY)
    ) {
      unitNetByUnit[l.unitEntityId] =
        (unitNetByUnit[l.unitEntityId] ?? 0) + l.debitCents - l.creditCents;
    } else if (l.code.startsWith("5") && l.serviceCategoryId) {
      costCreditByCategory[l.serviceCategoryId] =
        (costCreditByCategory[l.serviceCategoryId] ?? 0) + l.creditCents - l.debitCents;
    }
  }
  return { unitNetByUnit, costCreditByCategory };
}

/**
 * Publishes the vyúčtovanie: freezes the per-unit statements, posts the
 * reclassification entry (478/5xx close + per-unit rozdiely vs
 * PRESCRIBED), and locks the period (status → published; every later
 * correction is a reversal in the open period). Irreversible.
 */
export async function publishVyuctovanie(input: {
  entityId: string;
  country: Country;
  year: number;
  actorId: string;
}): Promise<{ settlementId: string }> {
  return db.transaction(async (tx) => {
    // Serialize with every money mutation, then bring receivables current.
    await lockOpenPeriods(tx, input.entityId);
    await postAllDueMonths(tx, {
      entityId: input.entityId,
      country: input.country,
    });

    const [period] = await tx
      .select({ id: accountingPeriods.id, status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.entityId, input.entityId),
          eq(accountingPeriods.year, input.year)
        )
      )
      .for("update");
    if (!period) throw new VyuctovanieError("PERIOD_NOT_FOUND");
    if (period.status !== "open") throw new VyuctovanieError("PERIOD_NOT_OPEN");

    // Gates re-checked server-side — the UI checklist is not the guard. The
    // preview reads through `tx`, so the due months postAllDueMonths just
    // posted are visible, and the ledger-prescription leg of the invariant
    // is required (every assessment must be posted by now).
    const preview = await getVyuctovaniePreview(
      input.entityId,
      input.country,
      input.year,
      tx,
      { requireFullyPosted: true }
    );
    // Specific blockers first (stable codes the UI translates), then the
    // generic checklist.
    const [firstBlocker] = preview.gates.blockers;
    if (firstBlocker) throw new VyuctovanieError(firstBlocker);
    if (preview.unprescribedCostCategories.length > 0) {
      throw new VyuctovanieError("UNPRESCRIBED_COSTS");
    }
    if (!preview.gates.canPublish) throw new VyuctovanieError("GATES_NOT_PASSED");
    if (!preview.settlement) throw new VyuctovanieError("NOTHING_TO_SETTLE");

    const [settlement] = await tx
      .insert(settlements)
      .values({
        entityId: input.entityId,
        periodId: period.id,
        publishedById: input.actorId,
      })
      .returning({ id: settlements.id });

    await tx.insert(settlementUnits).values(
      preview.settlement.units.map((u) => ({
        settlementId: settlement.id,
        unitEntityId: u.unitEntityId,
        payload: u.services,
        totalCostCents: u.totalCostCents,
        totalAdvancesCents: u.totalAdvancesCents,
        totalDifferenceCents: u.totalDifferenceCents,
      }))
    );

    const slugById = preview.categorySlugs;
    const entryId = await postSettlementClose(tx, {
      settlementId: settlement.id,
      entityId: input.entityId,
      periodId: period.id,
      country: input.country,
      createdById: input.actorId,
      year: input.year,
      categoryCosts: preview.settlement.perService.map((s) => ({
        serviceCategoryId: s.serviceCategoryId,
        categorySlug: slugById[s.serviceCategoryId] ?? "SVC_OTHER",
        costCents: s.actualCostCents,
      })),
      unitLines: preview.settlement.units.map((u) => ({
        unitEntityId: u.unitEntityId,
        prescribedCents: u.services.reduce(
          (s, l) => s + l.prescribedCents,
          0
        ),
        costShareCents: u.totalCostCents,
      })),
    });
    if (entryId) {
      await tx
        .update(settlements)
        .set({ journalEntryId: entryId })
        .where(eq(settlements.id, settlement.id));
    }

    // Invariant (same transaction — a violation rolls the whole publish
    // back): the settlement entry's per-unit 311/379 lines equal each
    // statement's result and its 5xx credits equal the settled costs.
    const entry = entryId
      ? await loadSettlementEntryTotals(tx, entryId)
      : { unitNetByUnit: {}, costCreditByCategory: {} };
    if (checkSettlementEntry(preview.settlement, entry).length > 0) {
      throw new VyuctovanieError("LEDGER_MISMATCH");
    }

    // Lock the period — postings into it refuse from here on.
    await tx
      .update(accountingPeriods)
      .set({ status: "published", closedAt: new Date() })
      .where(eq(accountingPeriods.id, period.id));

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "publish",
      tableName: "mod_accounting_settlements",
      recordId: settlement.id,
      after: {
        year: input.year,
        units: preview.settlement.units.length,
        totalDifferenceCents: preview.settlement.totalDifferenceCents,
        journalEntryId: entryId,
      },
      justification: `vyúčtovanie ${input.year} published — period locked`,
    });

    return { settlementId: settlement.id };
  });
}
