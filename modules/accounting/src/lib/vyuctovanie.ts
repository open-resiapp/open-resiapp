import "server-only";

import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingPeriods,
  expenses,
  feeAssessments,
  meterReadings,
  payments,
  paymentAllocations,
  serviceCategories,
  settlements,
  settlementUnits,
  auditLog,
} from "../db/schema";
import {
  computeSettlement,
  type SettlementResult,
  type SettlementServiceInput,
} from "../engine/settlement";
import { postSettlementClose } from "../engine/booking";
import { listDomUnits } from "./dom-units";
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

export interface VyuctovanieGates {
  periodStatus: "missing" | "open" | "reconciling" | "published" | "closed";
  unmatchedBankLines: number;
  uncategorizedExpenses: number;
  unitsWithoutReadings: number;
  /** Gates 1+2 clear and the period is open. */
  canPublish: boolean;
}

export interface VyuctovaniePreview {
  year: number;
  gates: VyuctovanieGates;
  /** Null until gates 1+2 pass — a broken preview must not look official. */
  settlement: SettlementResult | null;
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

  const periodStatus = period?.status ?? "missing";
  return {
    periodStatus,
    unmatchedBankLines: unmatched.n,
    uncategorizedExpenses: uncategorized.n,
    unitsWithoutReadings,
    canPublish:
      periodStatus === "open" && unmatched.n === 0 && uncategorized.n === 0,
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
    return { year, gates, settlement: null, categorySlugs, unitLabels };
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
  }));

  const settlement =
    units.length > 0 && services.length > 0
      ? computeSettlement({ unitIds: units.map((u) => u.id), services })
      : null;

  return { year, gates, settlement, categorySlugs, unitLabels };
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
        "accounting: gates not passed — reconcile bank lines and categorize invoices first"
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
