import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import {
  accountingPeriods,
  accountingSettings,
  feeAssessments,
  payments,
  paymentAllocations,
  serviceCategories,
  unitSettings,
} from "../db/schema";
import {
  allocatePayment,
  type AllocationStrategy,
  type OpenAssessment,
} from "../engine/allocation";
import { postPaymentMatched, voidPayment } from "../engine/booking";
import { getOrCreateOpenPeriod } from "./periods";
import { domUnitsWhere } from "./dom-units";
import { postAllDueMonths } from "./fee-schedule-publish";

// Manual payment entry (spec §Payment tracking, Phase 1 slice 3). A
// payment is recorded bank-side, then allocated across the unit's OPEN
// (posted, not-yet-covered) assessments per the HOA's strategy —
// proportional by default, FIFO across months (engine/allocation.ts).
// Remainder above all open assessments parks as preplatok (the unmatched
// part of the payment; karta bytu shows it as credit). Corrections are
// voids (reversal + audit), never edits or deletes.

type Country = "sk" | "cz";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Settings ───────────────────────────────────────────

async function currentAllocationStrategy(
  tx: Tx,
  entityId: string
): Promise<{ strategy: AllocationStrategy; priorityOrder: string[] }> {
  const [row] = await tx
    .select({
      strategy: accountingSettings.allocationStrategy,
      priorityOrder: accountingSettings.priorityOrder,
    })
    .from(accountingSettings)
    .where(
      and(
        eq(accountingSettings.entityId, entityId),
        sql`${accountingSettings.effectiveFrom} <= now()`
      )
    )
    .orderBy(desc(accountingSettings.effectiveFrom))
    .limit(1);
  return {
    strategy: row?.strategy ?? "proportional",
    priorityOrder: Array.isArray(row?.priorityOrder)
      ? (row.priorityOrder as string[])
      : [],
  };
}

// ── Open assessments ───────────────────────────────────

/**
 * A unit's open assessments: POSTED (due) rows minus what non-voided
 * payments already cover. Only due months participate — a prepayment does
 * not settle future months; it parks as preplatok (spec decision).
 */
async function openAssessmentsForUnit(
  tx: Tx,
  unitEntityId: string
): Promise<(OpenAssessment & { okruh: "fpuo" | "svc" | "mgmt" })[]> {
  const allocated = sql<number>`coalesce((
    select sum(${paymentAllocations.amountCents})::int
    from ${paymentAllocations}
    join ${payments} on ${payments.id} = ${paymentAllocations.paymentId}
    where ${paymentAllocations.assessmentId} = ${feeAssessments.id}
      and ${payments.voidedAt} is null
  ), 0)`;

  const rows = await tx
    .select({
      id: feeAssessments.id,
      periodYear: accountingPeriods.year,
      month: feeAssessments.month,
      categorySlug: serviceCategories.slug,
      okruh: serviceCategories.okruh,
      amountCents: feeAssessments.amountCents,
      allocatedCents: allocated,
    })
    .from(feeAssessments)
    .innerJoin(
      accountingPeriods,
      eq(feeAssessments.periodId, accountingPeriods.id)
    )
    .innerJoin(
      serviceCategories,
      eq(feeAssessments.serviceCategoryId, serviceCategories.id)
    )
    .where(
      and(
        eq(feeAssessments.unitEntityId, unitEntityId),
        sql`${feeAssessments.journalEntryId} is not null`
      )
    );

  return rows
    .map((r) => ({
      id: r.id,
      periodYear: r.periodYear,
      month: r.month,
      categorySlug: r.categorySlug,
      okruh: r.okruh,
      openCents: r.amountCents - r.allocatedCents,
    }))
    .filter((r) => r.openCents > 0);
}

// ── Create + allocate ──────────────────────────────────

export interface CreatePaymentInput {
  entityId: string;
  country: Country;
  createdById: string;
  unitEntityId: string;
  amountCents: number;
  receivedAt: Date;
  /** Where the money arrived — bank account (221) or cash box (211). */
  method: "bank" | "cash";
  note?: string;
}

export interface CreatePaymentResult {
  paymentId: string;
  allocatedCents: number;
  unallocatedCents: number;
  allocations: {
    assessmentId: string;
    amountCents: number;
    month: number;
    periodYear: number;
    categorySlug: string;
  }[];
}

export async function createManualPayment(
  input: CreatePaymentInput
): Promise<CreatePaymentResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("accounting: payment amount must be > 0");
  }

  return db.transaction(async (tx) => {
    // The unit must be a live unit of this dom; its VS goes on the row.
    const [unit] = await tx
      .select({ id: entities.id, vs: unitSettings.vs })
      .from(entities)
      .leftJoin(unitSettings, eq(unitSettings.unitEntityId, entities.id))
      .where(
        and(eq(entities.id, input.unitEntityId), domUnitsWhere(input.entityId))
      );
    if (!unit) throw new Error("accounting: unknown unit");

    // Receivables must reflect every due month before allocation. This
    // also takes the open-period row locks — serializing concurrent
    // payment entries (and publishes) per dom, so two payments can never
    // read the same open amounts and double-allocate an assessment.
    await postAllDueMonths(tx, {
      entityId: input.entityId,
      country: input.country,
    });

    // Cash books into the receivedAt year when that period is still open;
    // a payment for an already-published year books into the current open
    // period instead (domain invariant 4: locked periods are immutable —
    // late records post into the open period).
    const receivedYear = input.receivedAt.getUTCFullYear();
    const currentYear = new Date().getUTCFullYear();
    const [receivedPeriod] = await tx
      .select({ status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.entityId, input.entityId),
          eq(accountingPeriods.year, receivedYear)
        )
      );
    const bookYear =
      receivedPeriod && receivedPeriod.status !== "open"
        ? Math.max(currentYear, receivedYear + 1)
        : receivedYear;
    const period = await getOrCreateOpenPeriod(tx, input.entityId, bookYear);

    const [payment] = await tx
      .insert(payments)
      .values({
        entityId: input.entityId,
        unitEntityId: input.unitEntityId,
        source: "manual",
        method: input.method,
        receivedAt: input.receivedAt,
        amountCents: input.amountCents,
        vs: unit.vs ?? null,
        narrative: input.note?.trim() || null,
        createdById: input.createdById,
      })
      .returning({ id: payments.id });

    const open = await openAssessmentsForUnit(tx, input.unitEntityId);
    const openById = new Map(open.map((a) => [a.id, a]));

    let allocated: { assessmentId: string; amountCents: number }[] = [];
    let unallocatedCents = input.amountCents;

    if (open.length > 0) {
      const settings = await currentAllocationStrategy(tx, input.entityId);
      const result = allocatePayment(
        input.amountCents,
        open,
        settings.strategy,
        settings.priorityOrder
      );
      allocated = result.allocations;
      unallocatedCents = result.unallocatedCents;
    }

    // Category id per assessment for the journal lines.
    const categoryIdByAssessment = new Map<string, string>();
    if (allocated.length > 0) {
      const assessmentCategories = await tx
        .select({
          id: feeAssessments.id,
          serviceCategoryId: feeAssessments.serviceCategoryId,
        })
        .from(feeAssessments)
        .where(
          inArray(
            feeAssessments.id,
            allocated.map((a) => a.assessmentId)
          )
        );
      for (const a of assessmentCategories) {
        categoryIdByAssessment.set(a.id, a.serviceCategoryId);
      }
    }

    // Always posts — even with zero allocations the cash arrived (Dr banka
    // full amount) and the remainder parks as preplatok (Cr 379 on the
    // unit). Balances derive from postings; off-ledger money is corrupt
    // state (domain invariants 2 + 11).
    await postPaymentMatched(tx, {
      paymentId: payment.id,
      entityId: input.entityId,
      periodId: period.id,
      country: input.country,
      createdById: input.createdById,
      allocatedBy: "auto",
      unitEntityId: input.unitEntityId,
      allocations: allocated.map((a) => ({
        assessmentId: a.assessmentId,
        unitEntityId: input.unitEntityId,
        serviceCategoryId: categoryIdByAssessment.get(a.assessmentId)!,
        okruh: openById.get(a.assessmentId)!.okruh,
        amountCents: a.amountCents,
      })),
    });

    return {
      paymentId: payment.id,
      allocatedCents: input.amountCents - unallocatedCents,
      unallocatedCents,
      allocations: allocated.map((a) => ({
        assessmentId: a.assessmentId,
        amountCents: a.amountCents,
        month: openById.get(a.assessmentId)!.month,
        periodYear: openById.get(a.assessmentId)!.periodYear,
        categorySlug: openById.get(a.assessmentId)!.categorySlug,
      })),
    };
  });
}

// ── Void ───────────────────────────────────────────────

export async function voidManualPayment(input: {
  entityId: string;
  country: Country;
  paymentId: string;
  actorId: string;
  reason: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [payment] = await tx
      .select({ receivedAt: payments.receivedAt })
      .from(payments)
      .where(
        and(
          eq(payments.id, input.paymentId),
          eq(payments.entityId, input.entityId)
        )
      )
      .for("update");
    if (!payment) throw new Error("accounting: payment not found");

    // Reversal posts into the CURRENT open period (corrections never touch
    // locked periods — domain invariant 4).
    const period = await getOrCreateOpenPeriod(
      tx,
      input.entityId,
      new Date().getUTCFullYear()
    );

    await voidPayment(tx, {
      paymentId: input.paymentId,
      entityId: input.entityId,
      periodId: period.id,
      country: input.country,
      actorId: input.actorId,
      reason: input.reason,
    });
  });
}

// ── List ───────────────────────────────────────────────

export interface PaymentListRow {
  id: string;
  receivedAt: string;
  amountCents: number;
  allocatedCents: number;
  vs: string | null;
  unitName: string | null;
  unitFlatNumber: string | null;
  narrative: string | null;
  source: "manual" | "bank_import" | "fio_api";
  voidedAt: string | null;
  voidReason: string | null;
}

export async function listPayments(
  entityId: string,
  limit = 100
): Promise<PaymentListRow[]> {
  const allocated = sql<number>`coalesce((
    select sum(${paymentAllocations.amountCents})::int
    from ${paymentAllocations}
    where ${paymentAllocations.paymentId} = ${payments.id}
  ), 0)`;
  const rows = await db
    .select({
      id: payments.id,
      receivedAt: payments.receivedAt,
      amountCents: payments.amountCents,
      allocatedCents: allocated,
      vs: payments.vs,
      narrative: payments.narrative,
      source: payments.source,
      voidedAt: payments.voidedAt,
      voidReason: payments.voidReason,
      unitEntityId: payments.unitEntityId,
    })
    .from(payments)
    .where(eq(payments.entityId, entityId))
    .orderBy(desc(payments.receivedAt), desc(payments.createdAt))
    .limit(limit);

  const unitIds = [
    ...new Set(rows.map((r) => r.unitEntityId).filter(Boolean)),
  ] as string[];
  const units =
    unitIds.length > 0
      ? await db
          .select({
            id: entities.id,
            name: entities.name,
            flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
          })
          .from(entities)
          .where(inArray(entities.id, unitIds))
      : [];
  const unitById = new Map(units.map((u) => [u.id, u]));

  return rows.map((r) => ({
    id: r.id,
    receivedAt: r.receivedAt.toISOString(),
    amountCents: r.amountCents,
    allocatedCents: r.allocatedCents,
    vs: r.vs,
    unitName: r.unitEntityId ? unitById.get(r.unitEntityId)?.name ?? null : null,
    unitFlatNumber: r.unitEntityId
      ? unitById.get(r.unitEntityId)?.flatNumber ?? null
      : null,
    narrative: r.narrative,
    source: r.source,
    voidedAt: r.voidedAt?.toISOString() ?? null,
    voidReason: r.voidReason,
  }));
}

/** Units of the dom for the payment form (id, label, vs). */
export async function listPayableUnits(entityId: string) {
  return db
    .select({
      id: entities.id,
      name: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      vs: unitSettings.vs,
    })
    .from(entities)
    .leftJoin(unitSettings, eq(unitSettings.unitEntityId, entities.id))
    .where(domUnitsWhere(entityId))
    .orderBy(entities.name);
}
