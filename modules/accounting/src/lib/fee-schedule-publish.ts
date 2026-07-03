import "server-only";

import { and, asc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships } from "@/db/schema";
import {
  accountingPeriods,
  feeAssessments,
  feeSchedules,
  feeScheduleServices,
  paymentAllocations,
  payments,
  serviceCategories,
  unitPersons,
  unitSettings,
  auditLog,
} from "../db/schema";
import {
  computeAssessments,
  type AssessmentUnitInput,
  type ComputedAssessment,
} from "../engine/assessment";
import { postAssessmentsForMonth } from "../engine/booking";
import { domUnitsWhere } from "./dom-units";
import { lockDraft } from "./fee-schedules";
import type { AllocationKey } from "./constants";

// Predpis publish flow (spec §Predpis + iteration 2). Publishing a draft:
//   1. locks the PERIOD row (serializes concurrent publishes for the
//      period — two drafts publishing simultaneously must not both end up
//      open-ended published) and asserts the period is open
//   2. locks the draft row (no concurrent edit/discard/double publish)
//   3. computes every (unit × service × month) assessment with a frozen
//      allocation-basis snapshot (scope rule: publish-time snapshot)
//   4. supersedes the previous open-ended published schedule (mid-year
//      revision) — first posts the sibling's still-unposted DUE months
//      (they must reach the ledger under the schedule that owned them),
//      then caps its effectiveTo and removes its UNPOSTED assessments from
//      the revision month on; a month the old schedule already posted
//      cannot be revised (refuse — treasurer picks the next month)
//   5. inserts assessments, flips status, posts already-elapsed months
// Assessments for future months are posted later, month by month, as they
// become due (postDueMonths — idempotent, callable from any read path).

type Country = "sk" | "cz";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Input gathering ────────────────────────────────────

interface GatheredUnit extends AssessmentUnitInput {
  name: string;
  flatNumber: string | null;
}

async function gatherUnits(
  dbh: Tx,
  entityId: string,
  year: number,
  months: number[]
): Promise<GatheredUnit[]> {
  const units = await dbh
    .select({
      id: entities.id,
      name: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      shareNumerator: sql<number | null>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number | null>`(${entities.data}->>'share_denominator')::int`,
      areaM2: sql<number | null>`(${entities.data}->>'area_m2')::numeric`,
      vs: unitSettings.vs,
    })
    .from(entities)
    .leftJoin(unitSettings, eq(unitSettings.unitEntityId, entities.id))
    .where(domUnitsWhere(entityId))
    .orderBy(asc(entities.name));

  if (units.length === 0) {
    throw new Error("accounting: no units to assess");
  }
  const unitIds = units.map((u) => u.id);

  const owners = await dbh
    .select({
      entityId: memberships.entityId,
      userId: memberships.userId,
    })
    .from(memberships)
    .where(
      and(
        inArray(memberships.entityId, unitIds),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active")
      )
    );
  const ownersByUnit = new Map<string, string[]>();
  for (const o of owners) {
    const list = ownersByUnit.get(o.entityId);
    if (list) list.push(o.userId);
    else ownersByUnit.set(o.entityId, [o.userId]);
  }

  const personsRows = await dbh
    .select({
      unitEntityId: unitPersons.unitEntityId,
      personsCount: unitPersons.personsCount,
      effectiveFrom: unitPersons.effectiveFrom,
    })
    .from(unitPersons)
    .where(inArray(unitPersons.unitEntityId, unitIds))
    .orderBy(asc(unitPersons.effectiveFrom));
  const personsByUnit = new Map<
    string,
    { personsCount: number; effectiveFrom: Date }[]
  >();
  for (const row of personsRows) {
    const list = personsByUnit.get(row.unitEntityId);
    if (list) list.push(row);
    else personsByUnit.set(row.unitEntityId, [row]);
  }

  return units.map((u) => {
    const history = personsByUnit.get(u.id) ?? [];
    const personsByMonth: Record<number, number> = {};
    for (const month of months) {
      const monthStart = new Date(Date.UTC(year, month - 1, 1));
      let current = 0;
      for (const row of history) {
        if (row.effectiveFrom <= monthStart) current = row.personsCount;
        else break;
      }
      personsByMonth[month] = current;
    }
    return {
      unitEntityId: u.id,
      name: u.name,
      flatNumber: u.flatNumber,
      vs: u.vs ?? "",
      shareNumerator: u.shareNumerator,
      shareDenominator: u.shareDenominator,
      areaM2: u.areaM2 === null ? null : Number(u.areaM2),
      ownerUserIds: ownersByUnit.get(u.id) ?? [],
      personsByMonth,
    };
  });
}

interface ScheduleForPublish {
  id: string;
  periodId: string;
  year: number;
  status: "draft" | "published";
  effectiveFrom: Date;
  services: {
    serviceCategoryId: string;
    allocationKey: AllocationKey;
    rateCents: number | null;
    fixedAmountCents: number | null;
  }[];
}

async function loadSchedule(
  dbh: Tx,
  entityId: string,
  scheduleId: string
): Promise<ScheduleForPublish> {
  const [header] = await dbh
    .select({
      id: feeSchedules.id,
      periodId: feeSchedules.periodId,
      year: accountingPeriods.year,
      status: feeSchedules.status,
      effectiveFrom: feeSchedules.effectiveFrom,
    })
    .from(feeSchedules)
    .innerJoin(
      accountingPeriods,
      eq(feeSchedules.periodId, accountingPeriods.id)
    )
    .where(
      and(eq(feeSchedules.id, scheduleId), eq(feeSchedules.entityId, entityId))
    );
  if (!header) throw new Error("accounting: schedule not found");

  // Ordered by catalog sortOrder — the preview columns must render in the
  // same stable order the editor shows.
  const services = await dbh
    .select({
      serviceCategoryId: feeScheduleServices.serviceCategoryId,
      allocationKey: feeScheduleServices.allocationKey,
      rateCents: feeScheduleServices.rateCents,
      fixedAmountCents: feeScheduleServices.fixedAmountCents,
    })
    .from(feeScheduleServices)
    .innerJoin(
      serviceCategories,
      eq(feeScheduleServices.serviceCategoryId, serviceCategories.id)
    )
    .where(eq(feeScheduleServices.scheduleId, scheduleId))
    .orderBy(asc(serviceCategories.sortOrder));

  return { ...header, services };
}

function monthsFrom(effectiveFrom: Date): number[] {
  const start = effectiveFrom.getUTCMonth() + 1;
  const months: number[] = [];
  for (let m = start; m <= 12; m++) months.push(m);
  return months;
}

/** Last month of `year` that is due at `now` (0 = none, 12 = all). */
function lastDueMonth(year: number, now: Date): number {
  const currentYear = now.getUTCFullYear();
  if (year < currentYear) return 12;
  if (year > currentYear) return 0;
  return now.getUTCMonth() + 1;
}

// ── Due-month posting (idempotent, shared) ─────────────

/**
 * Posts every due-but-unposted month of a published schedule to the
 * journal. Idempotent (postAssessmentsForMonth skips posted rows). The
 * publish flow calls this; dashboards / karta bytu can call it lazily so
 * receivables never lag behind due months.
 */
export async function postDueMonthsForSchedule(
  tx: Tx,
  input: {
    entityId: string;
    periodId: string;
    scheduleId: string;
    country: Country;
    actorId: string;
    year: number;
    now: Date;
    /** Only post months strictly below this bound (revision boundary). */
    beforeMonth?: number;
  }
): Promise<number[]> {
  const lastDue = lastDueMonth(input.year, input.now);
  const bound = input.beforeMonth ?? 13;
  const posted: number[] = [];
  for (let month = 1; month <= lastDue && month < bound; month++) {
    const entryId = await postAssessmentsForMonth(tx, {
      entityId: input.entityId,
      periodId: input.periodId,
      scheduleId: input.scheduleId,
      country: input.country,
      createdById: input.actorId,
      year: input.year,
      month,
    });
    if (entryId) posted.push(month);
  }
  return posted;
}

/**
 * Posts due-but-unposted months for EVERY published schedule of the dom
 * whose period is open. Idempotent and cheap when there is nothing to do —
 * payment entry and dashboard reads call this first so receivables always
 * reflect all due months before balances/allocations are computed.
 */
export async function postAllDueMonths(
  tx: Tx,
  input: {
    entityId: string;
    country: Country;
    actorId: string;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();
  // Lock the dom's open periods first. This serializes concurrent callers
  // (payment entries, publishes — publish locks the same row) so two
  // transactions can never both see a month as unposted and double-post
  // it, nor both read the same open assessment amounts and double-allocate.
  await tx
    .select({ id: accountingPeriods.id })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.entityId, input.entityId),
        eq(accountingPeriods.status, "open")
      )
    )
    .for("update");
  const schedules = await tx
    .select({
      id: feeSchedules.id,
      periodId: feeSchedules.periodId,
      year: accountingPeriods.year,
    })
    .from(feeSchedules)
    .innerJoin(
      accountingPeriods,
      eq(feeSchedules.periodId, accountingPeriods.id)
    )
    .where(
      and(
        eq(feeSchedules.entityId, input.entityId),
        eq(feeSchedules.status, "published"),
        eq(accountingPeriods.status, "open")
      )
    );
  for (const schedule of schedules) {
    await postDueMonthsForSchedule(tx, {
      entityId: input.entityId,
      periodId: schedule.periodId,
      scheduleId: schedule.id,
      country: input.country,
      actorId: input.actorId,
      year: schedule.year,
      now,
    });
  }
}

// ── Preview ────────────────────────────────────────────

export interface PublishPreview {
  year: number;
  months: number[];
  /** Ordered category ids — preview column order (catalog sortOrder). */
  categoryOrder: string[];
  /** Per-unit monthly amounts for the FIRST effective month. */
  units: {
    unitEntityId: string;
    name: string;
    flatNumber: string | null;
    vs: string;
    perService: Record<string, number>;
    totalCents: number;
  }[];
  /** Dom-wide monthly total per service category id (first month). */
  serviceTotals: Record<string, number>;
  monthlyTotalCents: number;
  /**
   * Dom-wide total per month. When these differ (persons changes
   * mid-year), the UI must warn — the first-month table does not
   * represent every month.
   */
  monthTotals: { month: number; totalCents: number }[];
}

function buildPreview(
  schedule: ScheduleForPublish,
  units: GatheredUnit[],
  computed: ComputedAssessment[],
  months: number[]
): PublishPreview {
  const firstMonth = months[0];
  const unitById = new Map(units.map((u) => [u.unitEntityId, u]));

  const perUnit = new Map<
    string,
    { perService: Record<string, number>; totalCents: number; vs: string }
  >();
  const serviceTotals: Record<string, number> = {};
  const monthTotalsMap = new Map<number, number>();
  for (const r of computed) {
    monthTotalsMap.set(
      r.month,
      (monthTotalsMap.get(r.month) ?? 0) + r.amountCents
    );
    if (r.month !== firstMonth) continue;
    let u = perUnit.get(r.unitEntityId);
    if (!u) {
      u = { perService: {}, totalCents: 0, vs: r.vs };
      perUnit.set(r.unitEntityId, u);
    }
    u.perService[r.serviceCategoryId] = r.amountCents;
    u.totalCents += r.amountCents;
    serviceTotals[r.serviceCategoryId] =
      (serviceTotals[r.serviceCategoryId] ?? 0) + r.amountCents;
  }

  return {
    year: schedule.year,
    months,
    categoryOrder: schedule.services.map((s) => s.serviceCategoryId),
    units: [...perUnit.entries()].map(([unitEntityId, u]) => ({
      unitEntityId,
      name: unitById.get(unitEntityId)?.name ?? unitEntityId,
      flatNumber: unitById.get(unitEntityId)?.flatNumber ?? null,
      vs: u.vs,
      perService: u.perService,
      totalCents: u.totalCents,
    })),
    serviceTotals,
    monthlyTotalCents: Object.values(serviceTotals).reduce((s, v) => s + v, 0),
    monthTotals: [...monthTotalsMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([month, totalCents]) => ({ month, totalCents })),
  };
}

/**
 * Computes the per-byt preview for a DRAFT schedule without persisting.
 * Published schedules are excluded on purpose: their legally binding
 * amounts live in the stored assessments' snapshots — recomputing from
 * live share/area/persons data would present a false predpis.
 */
export async function previewSchedulePublish(
  entityId: string,
  scheduleId: string
): Promise<PublishPreview> {
  return db.transaction(async (tx) => {
    const schedule = await loadSchedule(tx, entityId, scheduleId);
    if (schedule.status !== "draft") {
      throw new Error(
        "accounting: preview is for drafts — published amounts live in the stored assessments"
      );
    }
    const months = monthsFrom(schedule.effectiveFrom);
    const units = await gatherUnits(tx, entityId, schedule.year, months);
    const computed = computeAssessments({
      units,
      services: schedule.services,
      months,
    });
    return buildPreview(schedule, units, computed, months);
  });
}

// ── Publish ────────────────────────────────────────────

const INSERT_CHUNK = 500;

export async function publishSchedule(input: {
  entityId: string;
  country: Country;
  scheduleId: string;
  actorId: string;
  /** For tests/backdating; defaults to now. */
  now?: Date;
}): Promise<{ assessmentCount: number; postedMonths: number[] }> {
  const now = input.now ?? new Date();

  return db.transaction(async (tx) => {
    await lockDraft(tx, input.entityId, input.scheduleId);
    const schedule = await loadSchedule(tx, input.entityId, input.scheduleId);
    if (schedule.services.length === 0) {
      throw new Error(
        "accounting: schedule has no service rows — nothing to publish"
      );
    }

    // Serialize publishes per period: without this lock two concurrent
    // publishes of two different drafts both pass the sibling scan and
    // commit as two open-ended published schedules (double predpis).
    const [period] = await tx
      .select({ id: accountingPeriods.id, status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(eq(accountingPeriods.id, schedule.periodId))
      .for("update");
    if (!period) throw new Error("accounting: period not found");
    if (period.status !== "open") {
      throw new Error(
        `accounting: period ${schedule.year} is ${period.status} — cannot publish into it`
      );
    }

    const months = monthsFrom(schedule.effectiveFrom);
    const firstMonth = months[0];

    // ── Supersede the previous open-ended published schedule ──
    const siblings = await tx
      .select({
        id: feeSchedules.id,
        effectiveFrom: feeSchedules.effectiveFrom,
      })
      .from(feeSchedules)
      .where(
        and(
          eq(feeSchedules.entityId, input.entityId),
          eq(feeSchedules.periodId, schedule.periodId),
          eq(feeSchedules.status, "published"),
          ne(feeSchedules.id, schedule.id),
          isNull(feeSchedules.effectiveTo)
        )
      )
      .for("update");

    for (const sibling of siblings) {
      if (sibling.effectiveFrom >= schedule.effectiveFrom) {
        throw new Error(
          "accounting: a published schedule with a later or equal effective date already exists — revise from a later month"
        );
      }
      // The sibling's months before the revision stay its own — post any
      // that are due but still unposted, so no receivable is lost when
      // the schedule is capped.
      await postDueMonthsForSchedule(tx, {
        entityId: input.entityId,
        periodId: schedule.periodId,
        scheduleId: sibling.id,
        country: input.country,
        actorId: input.actorId,
        year: schedule.year,
        now,
        beforeMonth: firstMonth,
      });

      // A month the old schedule already posted is due and booked — the
      // revision cannot rewrite it (corrections are reversals, never
      // edits). Treasurer must pick the next unposted month.
      const [posted] = await tx
        .select({ id: feeAssessments.id })
        .from(feeAssessments)
        .where(
          and(
            eq(feeAssessments.scheduleId, sibling.id),
            gte(feeAssessments.month, firstMonth),
            sql`${feeAssessments.journalEntryId} is not null`
          )
        )
        .limit(1);
      if (posted) {
        throw new Error(
          `accounting: month ${firstMonth} is already posted under the current predpis — the revision must start from the next unposted month`
        );
      }

      // An unposted assessment can already carry payment-allocation rows —
      // live prepayments (money would be orphaned) or history from voided
      // payments (rows are kept forever by design and the FK is restrict,
      // so the delete below would die either way). Both block the revision
      // at this month; the treasurer starts it one month later instead.
      const [blocked] = await tx
        .select({
          paymentId: paymentAllocations.paymentId,
          voidedAt: payments.voidedAt,
        })
        .from(paymentAllocations)
        .innerJoin(
          feeAssessments,
          eq(paymentAllocations.assessmentId, feeAssessments.id)
        )
        .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
        .where(
          and(
            eq(feeAssessments.scheduleId, sibling.id),
            gte(feeAssessments.month, firstMonth)
          )
        )
        .limit(1);
      if (blocked) {
        throw new Error(
          blocked.voidedAt
            ? `accounting: voided-payment history is attached to month ${firstMonth} or later — start the revision from a later month`
            : `accounting: a payment is already allocated to month ${firstMonth} or later — void it or start the revision from a later month`
        );
      }

      const deleted = await tx
        .delete(feeAssessments)
        .where(
          and(
            eq(feeAssessments.scheduleId, sibling.id),
            gte(feeAssessments.month, firstMonth),
            isNull(feeAssessments.journalEntryId)
          )
        )
        .returning({ id: feeAssessments.id });
      await tx
        .update(feeSchedules)
        .set({ effectiveTo: schedule.effectiveFrom })
        .where(eq(feeSchedules.id, sibling.id));
      // Two audit rows: the schedule cap AND the assessment removal — the
      // deleted per-unit amounts must remain reconstructible in the log.
      await tx.insert(auditLog).values([
        {
          entityId: input.entityId,
          actorId: input.actorId,
          action: "update",
          tableName: "mod_accounting_fee_schedules",
          recordId: sibling.id,
          after: {
            supersededBy: schedule.id,
            effectiveTo: schedule.effectiveFrom.toISOString(),
          },
        },
        {
          entityId: input.entityId,
          actorId: input.actorId,
          action: "delete",
          tableName: "mod_accounting_fee_assessments",
          recordId: sibling.id,
          after: {
            reason: "superseded_by_revision",
            supersededBy: schedule.id,
            fromMonth: firstMonth,
            deletedCount: deleted.length,
          },
          justification: `predpis revision from month ${firstMonth}`,
        },
      ]);
    }

    // ── Compute + insert assessments ──
    const units = await gatherUnits(tx, input.entityId, schedule.year, months);
    const computed = computeAssessments({
      units,
      services: schedule.services,
      months,
    });

    for (let i = 0; i < computed.length; i += INSERT_CHUNK) {
      const chunk = computed.slice(i, i + INSERT_CHUNK);
      await tx.insert(feeAssessments).values(
        chunk.map((c) => ({
          scheduleId: schedule.id,
          unitEntityId: c.unitEntityId,
          serviceCategoryId: c.serviceCategoryId,
          periodId: schedule.periodId,
          month: c.month,
          amountCents: c.amountCents,
          vs: c.vs,
          allocationBasisSnapshot: c.allocationBasisSnapshot,
        }))
      );
    }

    await tx
      .update(feeSchedules)
      .set({ status: "published", publishedAt: now })
      .where(eq(feeSchedules.id, schedule.id));

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "publish",
      tableName: "mod_accounting_fee_schedules",
      recordId: schedule.id,
      after: {
        assessmentCount: computed.length,
        months,
        services: schedule.services,
      },
    });

    // ── Post already-elapsed months of the new schedule ──
    const postedMonths = await postDueMonthsForSchedule(tx, {
      entityId: input.entityId,
      periodId: schedule.periodId,
      scheduleId: schedule.id,
      country: input.country,
      actorId: input.actorId,
      year: schedule.year,
      now,
    });

    return { assessmentCount: computed.length, postedMonths };
  });
}

/** Category catalog id → slug map for preview rendering. */
export async function categorySlugMap(
  country: Country
): Promise<Record<string, string>> {
  const rows = await db
    .select({ id: serviceCategories.id, slug: serviceCategories.slug })
    .from(serviceCategories)
    .where(eq(serviceCategories.country, country));
  return Object.fromEntries(rows.map((r) => [r.id, r.slug]));
}
