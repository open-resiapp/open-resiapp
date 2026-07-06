import "server-only";

import { and, asc, eq, sql, inArray, notInArray } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import {
  accountingPeriods,
  feeSchedules,
  feeScheduleServices,
  serviceCategories,
  unitSettings,
  auditLog,
} from "../db/schema";
import { getOrCreateOpenPeriod } from "./periods";
import { domUnitsWhere } from "./dom-units";
import { VS_RE, type AllocationKey } from "./constants";

// Predpis editor server logic (spec §Predpis). Draft lifecycle only —
// publish (assessment generation + posting) is a separate slice. Domain
// rules that shape this file (docs/domain/accounting.md):
//   - a DRAFT schedule is freely editable and discardable, no ledger
//     side effects; a PUBLISHED schedule is never edited or deleted here —
//     draft mutations lock the schedule row (FOR UPDATE) so a concurrent
//     publish can never interleave with an edit/discard
//   - every mutation writes an audit-log row
//   - all queries scope to the dom entity

type Country = "sk" | "cz";

export interface ServiceCategoryRow {
  id: string;
  slug: string;
  okruh: "fpuo" | "svc" | "mgmt";
  sortOrder: number;
}

export async function listServiceCategories(
  country: Country
): Promise<ServiceCategoryRow[]> {
  return db
    .select({
      id: serviceCategories.id,
      slug: serviceCategories.slug,
      okruh: serviceCategories.okruh,
      sortOrder: serviceCategories.sortOrder,
    })
    .from(serviceCategories)
    .where(eq(serviceCategories.country, country))
    .orderBy(asc(serviceCategories.sortOrder));
}

export interface FeeScheduleListRow {
  id: string;
  year: number;
  status: "draft" | "published";
  effectiveFrom: string;
  effectiveTo: string | null;
  publishedAt: string | null;
  serviceCount: number;
}

export async function listFeeSchedules(
  entityId: string
): Promise<FeeScheduleListRow[]> {
  const rows = await db
    .select({
      id: feeSchedules.id,
      year: accountingPeriods.year,
      status: feeSchedules.status,
      effectiveFrom: feeSchedules.effectiveFrom,
      effectiveTo: feeSchedules.effectiveTo,
      publishedAt: feeSchedules.publishedAt,
      serviceCount: sql<number>`(
        select count(*)::int from ${feeScheduleServices}
        where ${feeScheduleServices.scheduleId} = ${feeSchedules.id}
      )`,
    })
    .from(feeSchedules)
    .innerJoin(
      accountingPeriods,
      eq(feeSchedules.periodId, accountingPeriods.id)
    )
    .where(eq(feeSchedules.entityId, entityId))
    .orderBy(sql`${accountingPeriods.year} desc`, sql`${feeSchedules.effectiveFrom} desc`);

  return rows.map((r) => ({
    ...r,
    effectiveFrom: r.effectiveFrom.toISOString(),
    effectiveTo: r.effectiveTo?.toISOString() ?? null,
    publishedAt: r.publishedAt?.toISOString() ?? null,
  }));
}

export interface FeeScheduleServiceRow {
  id: string;
  serviceCategoryId: string;
  categorySlug: string;
  okruh: "fpuo" | "svc" | "mgmt";
  allocationKey: AllocationKey;
  rateCents: number | null;
  fixedAmountCents: number | null;
}

export interface FeeScheduleDetail {
  id: string;
  entityId: string;
  periodId: string;
  year: number;
  status: "draft" | "published";
  effectiveFrom: string;
  effectiveTo: string | null;
  publishedAt: string | null;
  services: FeeScheduleServiceRow[];
}

export async function getFeeSchedule(
  entityId: string,
  scheduleId: string
): Promise<FeeScheduleDetail | null> {
  const [header] = await db
    .select({
      id: feeSchedules.id,
      entityId: feeSchedules.entityId,
      periodId: feeSchedules.periodId,
      year: accountingPeriods.year,
      status: feeSchedules.status,
      effectiveFrom: feeSchedules.effectiveFrom,
      effectiveTo: feeSchedules.effectiveTo,
      publishedAt: feeSchedules.publishedAt,
    })
    .from(feeSchedules)
    .innerJoin(
      accountingPeriods,
      eq(feeSchedules.periodId, accountingPeriods.id)
    )
    .where(
      and(eq(feeSchedules.id, scheduleId), eq(feeSchedules.entityId, entityId))
    );
  if (!header) return null;

  const services = await db
    .select({
      id: feeScheduleServices.id,
      serviceCategoryId: feeScheduleServices.serviceCategoryId,
      categorySlug: serviceCategories.slug,
      okruh: serviceCategories.okruh,
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

  return {
    ...header,
    effectiveFrom: header.effectiveFrom.toISOString(),
    effectiveTo: header.effectiveTo?.toISOString() ?? null,
    publishedAt: header.publishedAt?.toISOString() ?? null,
    services,
  };
}

/**
 * The whole predpis pipeline is month-granular (assessments, supersede
 * boundaries, postings) — effectiveFrom must be the first instant of a
 * month inside the period year, otherwise a mid-month revision would
 * silently re-price the elapsed part of the month.
 */
export function assertMonthStartWithinYear(
  effectiveFrom: Date,
  year: number
): void {
  if (effectiveFrom.getUTCFullYear() !== year) {
    throw new Error(
      `accounting: effectiveFrom ${effectiveFrom.toISOString()} outside period year ${year}`
    );
  }
  if (
    effectiveFrom.getUTCDate() !== 1 ||
    effectiveFrom.getUTCHours() !== 0 ||
    effectiveFrom.getUTCMinutes() !== 0 ||
    effectiveFrom.getUTCSeconds() !== 0 ||
    effectiveFrom.getUTCMilliseconds() !== 0
  ) {
    throw new Error(
      `accounting: effectiveFrom ${effectiveFrom.toISOString()} must be the first day of a month (UTC)`
    );
  }
}

export async function createFeeSchedule(input: {
  entityId: string;
  year: number;
  effectiveFrom: Date;
  createdById: string;
  /** Set when the draft originates from a passed voting item (AC 513). */
  originVotingItemId?: string | null;
}): Promise<{ id: string }> {
  assertMonthStartWithinYear(input.effectiveFrom, input.year);
  return db.transaction(async (tx) => {
    const period = await getOrCreateOpenPeriod(tx, input.entityId, input.year);

    const [schedule] = await tx
      .insert(feeSchedules)
      .values({
        entityId: input.entityId,
        periodId: period.id,
        effectiveFrom: input.effectiveFrom,
        originVotingItemId: input.originVotingItemId ?? null,
        createdById: input.createdById,
      })
      .returning({ id: feeSchedules.id });

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.createdById,
      action: "insert",
      tableName: "mod_accounting_fee_schedules",
      recordId: schedule.id,
      after: { year: input.year, effectiveFrom: input.effectiveFrom.toISOString() },
    });

    return { id: schedule.id };
  });
}

export interface ServiceRowInput {
  serviceCategoryId: string;
  allocationKey: AllocationKey;
  rateCents: number | null;
  fixedAmountCents: number | null;
}

/**
 * Locks the schedule row and asserts it is still a draft — the guard every
 * draft mutation runs so a concurrent publish can't interleave (invariant:
 * published schedules are immutable). Returns the period year for
 * effectiveFrom validation.
 */
export async function lockDraft(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  entityId: string,
  scheduleId: string
): Promise<{ periodYear: number }> {
  const [schedule] = await tx
    .select({
      status: feeSchedules.status,
      periodId: feeSchedules.periodId,
    })
    .from(feeSchedules)
    .where(
      and(eq(feeSchedules.id, scheduleId), eq(feeSchedules.entityId, entityId))
    )
    .for("update");
  if (!schedule) throw new Error("accounting: schedule not found");
  if (schedule.status !== "draft") {
    throw new Error(
      "accounting: published schedule is immutable — create a revision instead"
    );
  }
  const [period] = await tx
    .select({ year: accountingPeriods.year })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.id, schedule.periodId));
  return { periodYear: period.year };
}

/**
 * Replaces the draft's service rows wholesale (draft-only — the editor
 * always submits the full row set, so replace is simpler and safer than
 * diffing). Also updates effectiveFrom when provided.
 */
export async function updateFeeScheduleDraft(input: {
  entityId: string;
  country: Country;
  scheduleId: string;
  actorId: string;
  effectiveFrom?: Date;
  services: ServiceRowInput[];
}): Promise<void> {
  for (const s of input.services) {
    if (s.allocationKey === "fixed") {
      if (s.fixedAmountCents === null || s.fixedAmountCents <= 0) {
        throw new Error("accounting: fixed row requires fixedAmountCents > 0");
      }
    } else if (s.rateCents === null || s.rateCents <= 0) {
      throw new Error("accounting: row requires rateCents > 0");
    }
  }
  const categoryIds = input.services.map((s) => s.serviceCategoryId);
  if (new Set(categoryIds).size !== categoryIds.length) {
    throw new Error("accounting: duplicate service category on schedule");
  }

  await db.transaction(async (tx) => {
    const { periodYear } = await lockDraft(
      tx,
      input.entityId,
      input.scheduleId
    );
    if (input.effectiveFrom) {
      assertMonthStartWithinYear(input.effectiveFrom, periodYear);
    }

    if (categoryIds.length > 0) {
      // Country-scoped: a category from another country's catalog must
      // never attach to this dom's schedule (its slug would have no
      // translation and its okruh mapping may not exist for the country).
      const valid = await tx
        .select({ id: serviceCategories.id })
        .from(serviceCategories)
        .where(
          and(
            inArray(serviceCategories.id, categoryIds),
            eq(serviceCategories.country, input.country)
          )
        );
      if (valid.length !== categoryIds.length) {
        throw new Error("accounting: unknown service category");
      }
    }

    // Draft-only wholesale replace — no ledger rows reference draft
    // service rows, so delete is safe here (and only here).
    await tx
      .delete(feeScheduleServices)
      .where(eq(feeScheduleServices.scheduleId, input.scheduleId));
    if (input.services.length > 0) {
      await tx.insert(feeScheduleServices).values(
        input.services.map((s) => ({
          scheduleId: input.scheduleId,
          serviceCategoryId: s.serviceCategoryId,
          allocationKey: s.allocationKey,
          rateCents: s.allocationKey === "fixed" ? null : s.rateCents,
          fixedAmountCents:
            s.allocationKey === "fixed" ? s.fixedAmountCents : null,
        }))
      );
    }
    if (input.effectiveFrom) {
      await tx
        .update(feeSchedules)
        .set({ effectiveFrom: input.effectiveFrom })
        .where(eq(feeSchedules.id, input.scheduleId));
    }

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_fee_schedules",
      recordId: input.scheduleId,
      after: {
        effectiveFrom: input.effectiveFrom?.toISOString(),
        services: input.services,
      },
    });
  });
}

/**
 * Discards a DRAFT schedule. Domain rule: drafts discard freely with no
 * ledger side effects — this is the one hard-delete in the module, and it
 * still leaves an audit-log row behind.
 */
export async function discardFeeScheduleDraft(input: {
  entityId: string;
  scheduleId: string;
  actorId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await lockDraft(tx, input.entityId, input.scheduleId);

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "delete",
      tableName: "mod_accounting_fee_schedules",
      recordId: input.scheduleId,
      justification: "draft discarded",
    });

    // Cascade removes service rows. Status predicate is belt-and-braces on
    // top of the row lock — a published schedule must never hit this DELETE.
    await tx
      .delete(feeSchedules)
      .where(
        and(
          eq(feeSchedules.id, input.scheduleId),
          eq(feeSchedules.status, "draft")
        )
      );
  });
}

// ── Unit settings (VS assignment) ──────────────────────

export interface UnitVsRow {
  unitEntityId: string;
  name: string;
  flatNumber: string | null;
  vs: string | null;
}

export async function listUnitVs(entityId: string): Promise<UnitVsRow[]> {
  return db
    .select({
      unitEntityId: entities.id,
      name: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      vs: unitSettings.vs,
    })
    .from(entities)
    .leftJoin(unitSettings, eq(unitSettings.unitEntityId, entities.id))
    .where(domUnitsWhere(entityId))
    .orderBy(asc(entities.name));
}

/**
 * Sets VS assignments for units of the dom. VS must be 1-10 digits and
 * unique within the dom — the primary payment-matching key, so collisions
 * are a hard error. An empty vs unassigns the unit (deletes its row).
 *
 * Implementation is delete-then-insert for ALL submitted units inside one
 * transaction: this makes swaps/renumbering possible (a row-by-row upsert
 * would hit the (entityId, vs) unique index transiently) and gives the
 * unassign path for free.
 */
export async function assignUnitVs(input: {
  entityId: string;
  actorId: string;
  assignments: { unitEntityId: string; vs: string }[];
}): Promise<void> {
  for (const a of input.assignments) {
    if (a.vs !== "" && !VS_RE.test(a.vs)) {
      throw new Error(`accounting: invalid VS "${a.vs}" — 1-10 digits`);
    }
  }
  const nonEmpty = input.assignments.filter((a) => a.vs !== "");
  const vsValues = nonEmpty.map((a) => a.vs);
  if (new Set(vsValues).size !== vsValues.length) {
    throw new Error("accounting: duplicate VS in submission");
  }
  if (input.assignments.length === 0) return;

  try {
    await db.transaction(async (tx) => {
      // All targets must be live units of this dom.
      const unitIds = input.assignments.map((a) => a.unitEntityId);
      const validUnits = await tx
        .select({ id: entities.id })
        .from(entities)
        .where(and(inArray(entities.id, unitIds), domUnitsWhere(input.entityId)));
      if (validUnits.length !== unitIds.length) {
        throw new Error("accounting: unknown unit in VS assignment");
      }

      // Fast-path check against VS held by units OUTSIDE this submission —
      // gives a clean domain error; the DB unique index remains the
      // authoritative guard (mapped below).
      if (vsValues.length > 0) {
        const [clash] = await tx
          .select({ vs: unitSettings.vs })
          .from(unitSettings)
          .where(
            and(
              eq(unitSettings.entityId, input.entityId),
              inArray(unitSettings.vs, vsValues),
              notInArray(unitSettings.unitEntityId, unitIds)
            )
          )
          .limit(1);
        if (clash) {
          throw new Error(
            `accounting: VS ${clash.vs} already assigned to another unit`
          );
        }
      }

      await tx
        .delete(unitSettings)
        .where(inArray(unitSettings.unitEntityId, unitIds));
      if (nonEmpty.length > 0) {
        await tx.insert(unitSettings).values(
          nonEmpty.map((a) => ({
            entityId: input.entityId,
            unitEntityId: a.unitEntityId,
            vs: a.vs,
          }))
        );
      }

      await tx.insert(auditLog).values({
        entityId: input.entityId,
        actorId: input.actorId,
        action: "update",
        tableName: "mod_accounting_unit_settings",
        recordId: input.entityId,
        after: { assignments: input.assignments },
      });
    });
  } catch (err) {
    // Concurrent submission raced past the fast-path check — map the raw
    // unique-violation to the same domain error.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("mod_accounting_unit_settings_entity_vs_idx")) {
      throw new Error("accounting: VS already assigned to another unit");
    }
    throw err;
  }
}
