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
import {
  getCurrentOpenPeriod,
  lockOpenPeriods,
  periodForReceivedAt,
} from "./periods";
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

    const period = await periodForReceivedAt(
      tx,
      input.entityId,
      input.receivedAt
    );

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

    const result = await allocateAndPostPayment(tx, {
      paymentId: payment.id,
      entityId: input.entityId,
      periodId: period.id,
      country: input.country,
      unitEntityId: input.unitEntityId,
      amountCents: input.amountCents,
      actorId: input.createdById,
      allocatedBy: "auto",
      // The treasurer picked the unit by hand on the form.
      matchedBy: "manual",
    });

    return { paymentId: payment.id, ...result };
  });
}

/**
 * Allocates an (already inserted, unposted) payment across the unit's
 * open assessments per the HOA strategy and posts it — the shared tail of
 * manual entry, bank-import auto-match and reconciliation confirm.
 * Callers hold the open-period locks (postAllDueMonths) already.
 */
export async function allocateAndPostPayment(
  tx: Tx,
  input: {
    paymentId: string;
    entityId: string;
    periodId: string;
    country: Country;
    unitEntityId: string;
    amountCents: number;
    actorId: string;
    allocatedBy: "auto" | "manual";
    /** Who decided the unit binding — drives IBAN learning eligibility. */
    matchedBy: "auto" | "manual";
  }
): Promise<Omit<CreatePaymentResult, "paymentId">> {
  await tx
    .update(payments)
    .set({ matchedBy: input.matchedBy })
    .where(eq(payments.id, input.paymentId));

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
    paymentId: input.paymentId,
    entityId: input.entityId,
    periodId: input.periodId,
    country: input.country,
    createdById: input.actorId,
    allocatedBy: input.allocatedBy,
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
    // Serialize with payments / credit applications / publishes — a void
    // racing a concurrent apply-credit could otherwise leave the credit
    // entry un-reversed (both read pre-commit state of the other).
    await lockOpenPeriods(tx, input.entityId);

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
    const period = await getCurrentOpenPeriod(tx, input.entityId);

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
