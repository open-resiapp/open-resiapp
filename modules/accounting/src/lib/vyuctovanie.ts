import "server-only";

import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";
import {
  accountingPeriods,
  expenses,
  feeAssessments,
  meterReadings,
  payments,
  paymentAllocations,
  serviceCategories,
  feeSchedules,
  settlements,
  settlementUnits,
  unitSettings,
  accountingSettings,
  accountingNotificationsSent,
  auditLog,
} from "../db/schema";
import {
  computeSettlement,
  type SettlementResult,
  type SettlementServiceInput,
} from "../engine/settlement";
import { computeHeatSplit } from "../engine/heat";
import { postSettlementClose } from "../engine/booking";
import { SERVICE_CATEGORY_SLUGS } from "../seeds/service-categories-sk";
import { payBySquareString } from "../qr/pay-by-square";
import { sendSettlementPublishedNotification } from "@/lib/email";
import { listDomUnits, domUnitsWhere } from "./dom-units";
import { lockOpenPeriods } from "./periods";
import { postAllDueMonths } from "./fee-schedule-publish";

// Ročné vyúčtovanie assembly (BYT-20260512-002 Phase 4). Gates before
// the wizard may proceed (spec §Annual vyúčtovanie wizard):
//   1. zero unmatched bank lines (all money attributed)
//   2. zero uncategorized SERVICE expenses for the year
//   3. meter readings — informational for SK Phase 4 (heat/water engine
//      is Phase 6); units without a reading are listed, not blocking
// Settlement covers the SERVICES okruh only — fond opráv sa nevyúčtováva
// (FPÚO advances accumulate in the fund; only zálohy na služby settle
// annually per §7b zák. 182/1993).

type Country = "sk" | "cz";

// Heat rozúčtování defaults (vyhláška 269/2015 §3). Heat základní složka is
// configurable within the statutory band (settings.heatBasicSharePct);
// TÚV základní is statutorily fixed at 30 %.
const DEFAULT_HEAT_BASIC_PCT = 40;
const TUV_BASIC_PCT = 30;

/**
 * Metered cost split for SVC_HEAT / SVC_WATER_HOT (vyhláška 269/2015).
 * Returns categoryId → { unitId → cost cents } only for services where the
 * split actually applies: the category has a real cost, EVERY unit carries a
 * započitatelná plocha, and EVERY unit has a reading for the matching meter
 * type in the year (whole-building metering). Anything partial returns
 * nothing for that category, so the settlement falls back to the prescribed
 * split and the wizard's "units without a reading" list stays the signal.
 */
async function buildMeteredCostShares(input: {
  entityId: string;
  yearStart: Date;
  yearEnd: Date;
  units: { id: string }[];
  categoryIdBySlug: Record<string, string>;
  costByCategory: Map<string, number>;
  heatBasicPct: number;
}): Promise<Map<string, Record<string, number>>> {
  const out = new Map<string, Record<string, number>>();
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

  // Areas — every unit must carry one (the split needs plocha for the basic
  // component AND the correction bounds).
  const areaRows = await db
    .select({
      id: entities.id,
      areaMilli: sql<
        number | null
      >`round((${entities.data}->>'area_m2')::numeric * 1000)::int`,
    })
    .from(entities)
    .where(domUnitsWhere(input.entityId));
  const areaByUnit = new Map(areaRows.map((r) => [r.id, r.areaMilli ?? 0]));
  if (input.units.some((u) => (areaByUnit.get(u.id) ?? 0) <= 0)) return out;

  // Readings for the metered types, date-ordered.
  const rows = await db
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
    if (cons.some((x) => x.c === null)) continue; // partial metering
    const split = computeHeatSplit(
      input.costByCategory.get(plan.categoryId)!,
      input.units.map((u) => ({
        unitId: u.id,
        areaMilliM2: areaByUnit.get(u.id)!,
        consumptionMilli: cons.find((x) => x.unitId === u.id)!.c!,
      })),
      { basicSharePct: plan.basicPct }
    );
    out.set(
      plan.categoryId,
      Object.fromEntries(split.units.map((s) => [s.unitId, s.finalCents]))
    );
  }
  return out;
}

export interface VyuctovanieGates {
  periodStatus: "missing" | "open" | "reconciling" | "published" | "closed";
  unmatchedBankLines: number;
  uncategorizedExpenses: number;
  unitsWithoutReadings: number;
  /** The year must be OVER — a mid-year publish would settle 12 months
   * of prescriptions against a partial year of postings and costs. */
  yearElapsed: boolean;
  /** Draft schedules for the year — locking strands them unpublishable. */
  draftSchedules: number;
  /** Gates clear, year over, period open. */
  canPublish: boolean;
}

export interface VyuctovaniePreview {
  year: number;
  gates: VyuctovanieGates;
  /** Null until gates 1+2 pass — a broken preview must not look official. */
  settlement: SettlementResult | null;
  /** Categories with real cost but ZERO prescription — the engine would
   * fall back to an equal split no zmluva authorizes; publish refuses
   * until the predpis covers the service or the expense is recategorized. */
  unprescribedCostCategories: string[];
  categorySlugs: Record<string, string>;
  unitLabels: Record<string, string>;
}

async function computeGates(
  entityId: string,
  year: number
): Promise<VyuctovanieGates> {
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  const [period] = await db
    .select({ status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        eq(accountingPeriods.year, year)
      )
    );

  const [unmatched] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(payments)
    .where(
      and(
        eq(payments.entityId, entityId),
        inArray(payments.source, ["bank_import", "fio_api"]),
        isNull(payments.journalEntryId),
        isNull(payments.voidedAt)
      )
    );

  const [uncategorized] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(expenses)
    .where(
      and(
        eq(expenses.entityId, entityId),
        isNull(expenses.voidedAt),
        isNull(expenses.serviceCategoryId),
        gte(expenses.invoiceDate, yearStart),
        lt(expenses.invoiceDate, yearEnd)
      )
    );

  const units = await listDomUnits(entityId);
  const withReadings = await db
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

  const [drafts] = await db
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
    periodStatus,
    unmatchedBankLines: unmatched.n,
    uncategorizedExpenses: uncategorized.n,
    unitsWithoutReadings,
    yearElapsed,
    draftSchedules: drafts.n,
    canPublish:
      periodStatus === "open" &&
      yearElapsed &&
      unmatched.n === 0 &&
      uncategorized.n === 0,
  };
}

export async function getVyuctovaniePreview(
  entityId: string,
  country: Country,
  year: number
): Promise<VyuctovaniePreview> {
  const gates = await computeGates(entityId, year);
  const units = await listDomUnits(entityId);
  const unitLabels = Object.fromEntries(
    units.map((u) => [u.id, u.flatNumber ?? u.name])
  );

  const categories = await db
    .select({ id: serviceCategories.id, slug: serviceCategories.slug })
    .from(serviceCategories)
    .where(eq(serviceCategories.country, country));
  const categorySlugs = Object.fromEntries(
    categories.map((c) => [c.id, c.slug])
  );

  if (gates.unmatchedBankLines > 0 || gates.uncategorizedExpenses > 0) {
    return {
      year,
      gates,
      settlement: null,
      unprescribedCostCategories: [],
      categorySlugs,
      unitLabels,
    };
  }

  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year + 1, 0, 1));

  // Actual costs per SERVICES-okruh category for the year.
  const costs = await db
    .select({
      serviceCategoryId: expenses.serviceCategoryId,
      total: sql<number>`sum(${expenses.amountCents})::int`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.entityId, entityId),
        eq(expenses.okruh, "svc"),
        isNull(expenses.voidedAt),
        gte(expenses.invoiceDate, yearStart),
        lt(expenses.invoiceDate, yearEnd)
      )
    )
    .groupBy(expenses.serviceCategoryId);

  // Prescribed per (category, unit) — the year's assessments (services
  // okruh categories only; FPÚO is excluded from settlement).
  const svcCategoryIds = new Set(
    (
      await db
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(
          and(
            eq(serviceCategories.country, country),
            eq(serviceCategories.okruh, "svc")
          )
        )
    ).map((r) => r.id)
  );

  const prescribed = await db
    .select({
      serviceCategoryId: feeAssessments.serviceCategoryId,
      unitEntityId: feeAssessments.unitEntityId,
      total: sql<number>`sum(${feeAssessments.amountCents})::int`,
    })
    .from(feeAssessments)
    .innerJoin(
      accountingPeriods,
      eq(feeAssessments.periodId, accountingPeriods.id)
    )
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        eq(accountingPeriods.year, year)
      )
    )
    .groupBy(feeAssessments.serviceCategoryId, feeAssessments.unitEntityId);

  // Advances per (category, unit): non-voided payment allocations against
  // the year's assessments.
  const advances = await db
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
    .innerJoin(
      accountingPeriods,
      eq(feeAssessments.periodId, accountingPeriods.id)
    )
    .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        eq(accountingPeriods.year, year),
        isNull(payments.voidedAt)
      )
    )
    .groupBy(feeAssessments.serviceCategoryId, feeAssessments.unitEntityId);

  // Assemble per category (union of categories with costs OR prescriptions,
  // services okruh only).
  const categoryIds = new Set<string>();
  for (const c of costs) {
    if (c.serviceCategoryId && svcCategoryIds.has(c.serviceCategoryId)) {
      categoryIds.add(c.serviceCategoryId);
    }
  }
  for (const p of prescribed) {
    if (svcCategoryIds.has(p.serviceCategoryId)) {
      categoryIds.add(p.serviceCategoryId);
    }
  }

  // Metered heat/TÚV split (vyhláška 269/2015) — overrides the prescribed
  // split for those services when whole-building metering is present.
  const [heatSettingRow] = await db
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
  const meteredShares = await buildMeteredCostShares({
    entityId,
    yearStart,
    yearEnd,
    units,
    categoryIdBySlug: Object.fromEntries(categories.map((c) => [c.slug, c.id])),
    costByCategory: new Map(
      costs
        .filter((c) => c.serviceCategoryId)
        .map((c) => [c.serviceCategoryId as string, c.total])
    ),
    heatBasicPct: heatSettingRow?.h ?? DEFAULT_HEAT_BASIC_PCT,
  });

  const services: SettlementServiceInput[] = [...categoryIds].map((id) => ({
    serviceCategoryId: id,
    actualCostCents:
      costs.find((c) => c.serviceCategoryId === id)?.total ?? 0,
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
    // Present only for metered heat/TÚV; undefined = prescribed split.
    costShareByUnit: meteredShares.get(id),
  }));

  const settlement =
    units.length > 0 && services.length > 0
      ? computeSettlement({ unitIds: units.map((u) => u.id), services })
      : null;

  const unprescribedCostCategories = services
    .filter(
      (s) =>
        s.actualCostCents > 0 &&
        Object.values(s.prescribedByUnit).reduce((a, b) => a + b, 0) === 0
    )
    .map((s) => categorySlugs[s.serviceCategoryId] ?? s.serviceCategoryId);

  return {
    year,
    gates,
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

  // Owners of the settled units, with their unit for the deep link.
  const recipients = await db
    .selectDistinct({
      userId: users.id,
      name: users.name,
      email: users.email,
      unitEntityId: settlementUnits.unitEntityId,
    })
    .from(settlementUnits)
    .innerJoin(
      memberships,
      eq(memberships.entityId, settlementUnits.unitEntityId)
    )
    .innerJoin(users, eq(memberships.userId, users.id))
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
  };
  const seenUser = new Set<string>();

  for (const recipient of recipients) {
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
    costShareCents: number;
    differenceCents: number;
  }[];
  totalCostCents: number;
  totalAdvancesCents: number;
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
  }[];
  const lines = payloadLines.map((l) => ({
    categorySlug: slugById.get(l.serviceCategoryId) ?? l.serviceCategoryId,
    prescribedCents: l.prescribedCents,
    advancesCents: l.advancesCents,
    costShareCents: l.costShareCents,
    differenceCents: l.differenceCents,
  }));

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
    totalCostCents: row.totalCostCents,
    totalAdvancesCents: row.totalAdvancesCents,
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
    if (!period) throw new Error("accounting: period not found");
    if (period.status !== "open") {
      throw new Error(`accounting: period ${input.year} is ${period.status}`);
    }

    // Gates re-checked server-side — the UI checklist is not the guard.
    const preview = await getVyuctovaniePreview(
      input.entityId,
      input.country,
      input.year
    );
    if (!preview.gates.canPublish) {
      throw new Error(
        "accounting: gates not passed — the year must be over, bank lines reconciled and invoices categorized"
      );
    }
    if (preview.unprescribedCostCategories.length > 0) {
      throw new Error(
        `accounting: costs without any prescription (${preview.unprescribedCostCategories.join(", ")}) — an equal split has no legal basis; add the service to the predpis or recategorize the expense`
      );
    }
    if (!preview.settlement) {
      throw new Error("accounting: nothing to settle for the year");
    }

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
