import "server-only";

import { and, desc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import {
  feeSchedules,
  feeScheduleServices,
  serviceCategories,
  expenseAuthorisations,
  journalEntries,
  auditLog,
} from "../db/schema";
import {
  createFeeSchedule,
  updateFeeScheduleDraft,
  type ServiceRowInput,
} from "./fee-schedules";
import { SERVICE_CATEGORY_SLUGS } from "../seeds/service-categories-sk";

// Voting→accounting pipeline (BYT-20260512-002 §Voting integration, AC
// 513/514). When a voting item carrying a financial effect PASSES, the
// voting module hands the effect here on close (via the onVoteClose hook)
// and this turns it into a treasurer-reviewable DRAFT — never an
// auto-published change. Idempotent per voting item so a re-dispatched
// close (retry, re-open→close) can't duplicate the draft.

type Country = "sk" | "cz";

export interface ApprovedFinancialEffect {
  votingId: string;
  votingItemId: string;
  title: string;
  kind: "fpuo_rate_change" | "expense_approval";
  params: Record<string, unknown>;
}

export interface PipelineResultItem {
  votingItemId: string;
  kind: string;
  outcome: "created" | "skipped_duplicate" | "error";
  artifact?: {
    type: "fee_schedule_draft" | "expense_authorisation";
    id: string;
  };
  error?: string;
}

/** First day of the month AFTER `now` (UTC) — default rate-change start. */
function firstOfNextMonth(now: Date): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return new Date(Date.UTC(m === 11 ? y + 1 : y, (m + 1) % 12, 1));
}

/** Services of the schedule effective at `asOf` — copied into the new draft. */
async function currentPublishedServices(entityId: string, asOf: Date) {
  const [schedule] = await db
    .select({ id: feeSchedules.id })
    .from(feeSchedules)
    .where(
      and(
        eq(feeSchedules.entityId, entityId),
        eq(feeSchedules.status, "published"),
        lte(feeSchedules.effectiveFrom, asOf),
        or(
          isNull(feeSchedules.effectiveTo),
          gt(feeSchedules.effectiveTo, asOf)
        )
      )
    )
    .orderBy(desc(feeSchedules.effectiveFrom))
    .limit(1);
  if (!schedule) return [];
  return db
    .select({
      serviceCategoryId: feeScheduleServices.serviceCategoryId,
      allocationKey: feeScheduleServices.allocationKey,
      rateCents: feeScheduleServices.rateCents,
      fixedAmountCents: feeScheduleServices.fixedAmountCents,
    })
    .from(feeScheduleServices)
    .where(eq(feeScheduleServices.scheduleId, schedule.id));
}

async function applyRateChange(
  input: { entityId: string; country: Country; actorId: string },
  effect: ApprovedFinancialEffect
): Promise<PipelineResultItem> {
  const base = { votingItemId: effect.votingItemId, kind: effect.kind };

  // Idempotency — one draft per voting item (unique index backs this).
  const [dup] = await db
    .select({ id: feeSchedules.id })
    .from(feeSchedules)
    .where(eq(feeSchedules.originVotingItemId, effect.votingItemId))
    .limit(1);
  if (dup) {
    return {
      ...base,
      outcome: "skipped_duplicate",
      artifact: { type: "fee_schedule_draft", id: dup.id },
    };
  }

  const newRateCents = Number(effect.params.newRateCents);
  if (!Number.isInteger(newRateCents) || newRateCents <= 0) {
    return { ...base, outcome: "error", error: "invalid newRateCents" };
  }
  const rawFrom =
    typeof effect.params.effectiveFrom === "string" &&
    /^\d{4}-\d{2}-\d{2}/.test(effect.params.effectiveFrom)
      ? new Date(`${effect.params.effectiveFrom.slice(0, 10)}T00:00:00Z`)
      : firstOfNextMonth(new Date());
  // Schedules must start on a month boundary within their period year.
  const monthStart = new Date(
    Date.UTC(rawFrom.getUTCFullYear(), rawFrom.getUTCMonth(), 1)
  );
  const year = monthStart.getUTCFullYear();

  const [fpuo] = await db
    .select({ id: serviceCategories.id })
    .from(serviceCategories)
    .where(
      and(
        eq(serviceCategories.country, input.country),
        eq(serviceCategories.slug, SERVICE_CATEGORY_SLUGS.FPUO)
      )
    )
    .limit(1);
  if (!fpuo) return { ...base, outcome: "error", error: "no FPUO category" };

  // Copy the current published schedule's services, swapping the FPÚO rate.
  const existing = await currentPublishedServices(input.entityId, monthStart);
  const services: ServiceRowInput[] = [];
  let hasFpuo = false;
  for (const s of existing) {
    if (s.serviceCategoryId === fpuo.id) {
      hasFpuo = true;
      services.push({
        serviceCategoryId: fpuo.id,
        allocationKey: s.allocationKey,
        rateCents: newRateCents,
        fixedAmountCents: null,
      });
    } else {
      services.push({
        serviceCategoryId: s.serviceCategoryId,
        allocationKey: s.allocationKey,
        rateCents: s.rateCents,
        fixedAmountCents: s.fixedAmountCents,
      });
    }
  }
  if (!hasFpuo) {
    services.push({
      serviceCategoryId: fpuo.id,
      allocationKey: "share",
      rateCents: newRateCents,
      fixedAmountCents: null,
    });
  }

  const { id: scheduleId } = await createFeeSchedule({
    entityId: input.entityId,
    year,
    effectiveFrom: monthStart,
    createdById: input.actorId,
    originVotingItemId: effect.votingItemId,
  });
  await updateFeeScheduleDraft({
    entityId: input.entityId,
    country: input.country,
    scheduleId,
    actorId: input.actorId,
    services,
  });

  await db.insert(auditLog).values({
    entityId: input.entityId,
    actorId: input.actorId,
    action: "insert",
    tableName: "mod_accounting_fee_schedules",
    recordId: scheduleId,
    after: {
      fromVotingItem: effect.votingItemId,
      newRateCents,
      effectiveFrom: monthStart.toISOString(),
    },
    justification: `Návrh predpisu z hlasovania: ${effect.title}`,
  });

  return {
    ...base,
    outcome: "created",
    artifact: { type: "fee_schedule_draft", id: scheduleId },
  };
}

async function applyExpenseApproval(
  input: { entityId: string; country: Country; actorId: string },
  effect: ApprovedFinancialEffect
): Promise<PipelineResultItem> {
  const base = { votingItemId: effect.votingItemId, kind: effect.kind };

  const amountCents = Number(effect.params.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return { ...base, outcome: "error", error: "invalid amountCents" };
  }
  const description =
    (typeof effect.params.description === "string" &&
      effect.params.description.trim()) ||
    effect.title;
  const serviceCategorySlug =
    typeof effect.params.categorySlug === "string"
      ? effect.params.categorySlug
      : null;

  const [row] = await db
    .insert(expenseAuthorisations)
    .values({
      entityId: input.entityId,
      votingId: effect.votingId,
      votingItemId: effect.votingItemId,
      amountCents,
      description,
      serviceCategorySlug,
      createdById: input.actorId,
    })
    .onConflictDoNothing()
    .returning({ id: expenseAuthorisations.id });

  if (!row) {
    const [existing] = await db
      .select({ id: expenseAuthorisations.id })
      .from(expenseAuthorisations)
      .where(eq(expenseAuthorisations.votingItemId, effect.votingItemId))
      .limit(1);
    return {
      ...base,
      outcome: "skipped_duplicate",
      artifact: existing
        ? { type: "expense_authorisation", id: existing.id }
        : undefined,
    };
  }

  await db.insert(auditLog).values({
    entityId: input.entityId,
    actorId: input.actorId,
    action: "insert",
    tableName: "mod_accounting_expense_authorisations",
    recordId: row.id,
    after: { fromVotingItem: effect.votingItemId, amountCents, description },
  });

  return {
    ...base,
    outcome: "created",
    artifact: { type: "expense_authorisation", id: row.id },
  };
}

export async function processApprovedFinancialEffects(input: {
  entityId: string;
  country: Country;
  actorId: string;
  effects: ApprovedFinancialEffect[];
}): Promise<PipelineResultItem[]> {
  const out: PipelineResultItem[] = [];
  for (const effect of input.effects) {
    try {
      if (effect.kind === "fpuo_rate_change") {
        out.push(await applyRateChange(input, effect));
      } else if (effect.kind === "expense_approval") {
        out.push(await applyExpenseApproval(input, effect));
      }
    } catch (err) {
      out.push({
        votingItemId: effect.votingItemId,
        kind: effect.kind,
        outcome: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

// ── Impacts (AC 515 display) ───────────────────────────

export interface VotingImpact {
  votingItemId: string;
  feeScheduleDraft: { id: string; status: string } | null;
  expenseAuthorisation: {
    id: string;
    status: string;
    amountCents: number;
    usedExpenseId: string | null;
  } | null;
  journalEntryCount: number;
}

/** The accounting artifacts + posted journal entries tied to a voting's items. */
export async function getVotingImpacts(
  entityId: string,
  votingItemIds: string[]
): Promise<VotingImpact[]> {
  if (votingItemIds.length === 0) return [];

  const drafts = await db
    .select({
      originVotingItemId: feeSchedules.originVotingItemId,
      id: feeSchedules.id,
      status: feeSchedules.status,
    })
    .from(feeSchedules)
    .where(
      and(
        eq(feeSchedules.entityId, entityId),
        inArray(feeSchedules.originVotingItemId, votingItemIds)
      )
    );
  const draftByItem = new Map(drafts.map((d) => [d.originVotingItemId, d]));

  const auths = await db
    .select({
      votingItemId: expenseAuthorisations.votingItemId,
      id: expenseAuthorisations.id,
      status: expenseAuthorisations.status,
      amountCents: expenseAuthorisations.amountCents,
      usedExpenseId: expenseAuthorisations.usedExpenseId,
    })
    .from(expenseAuthorisations)
    .where(
      and(
        eq(expenseAuthorisations.entityId, entityId),
        inArray(expenseAuthorisations.votingItemId, votingItemIds)
      )
    );
  const authByItem = new Map(auths.map((a) => [a.votingItemId, a]));

  const entries = await db
    .select({ votingResolutionId: journalEntries.votingResolutionId })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.entityId, entityId),
        inArray(journalEntries.votingResolutionId, votingItemIds)
      )
    );
  const entryCount = new Map<string, number>();
  for (const e of entries) {
    if (!e.votingResolutionId) continue;
    entryCount.set(
      e.votingResolutionId,
      (entryCount.get(e.votingResolutionId) ?? 0) + 1
    );
  }

  return votingItemIds.map((id) => {
    const d = draftByItem.get(id);
    const a = authByItem.get(id);
    return {
      votingItemId: id,
      feeScheduleDraft: d ? { id: d.id, status: d.status } : null,
      expenseAuthorisation: a
        ? {
            id: a.id,
            status: a.status,
            amountCents: a.amountCents,
            usedExpenseId: a.usedExpenseId,
          }
        : null,
      journalEntryCount: entryCount.get(id) ?? 0,
    };
  });
}
