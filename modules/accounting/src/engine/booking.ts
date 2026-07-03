// Posting engine (BYT-20260512-002 Phase 1) — the ONLY place that writes
// journal entries. Server actions call these inside db.transaction(); the
// deferred DB trigger re-verifies Σ debits = Σ credits at commit, but every
// function here also asserts balance up front to fail fast.
//
// Domain rules enforced here (docs/domain/accounting.md):
//   - postings only into an OPEN period (published/closed are immutable)
//   - every entry carries sourceType + sourceId back to its surface row
//   - corrections are reversals, never edits or deletes
//   - every mutation writes an audit-log row
//
// User-facing code never sees these debit/credit terms — this module is
// the hidden double-entry layer beneath the domain surface.

import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountingPeriods,
  journalEntries,
  journalLines,
  feeAssessments,
  payments,
  paymentAllocations,
  serviceCategories,
  auditLog,
} from "../db/schema";
import { ACCOUNT_CODES } from "../seeds/coa-sk";

// Drizzle transaction handle — everything here composes inside one
// db.transaction() with the caller's domain writes.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type Country = "sk" | "cz";
type Okruh = "fpuo" | "svc" | "mgmt";

interface LineInput {
  accountCode: string;
  debitCents?: number;
  creditCents?: number;
  okruh: Okruh;
  unitEntityId?: string | null;
  serviceCategoryId?: string | null;
}

// ── Account lookup (seed catalog is immutable → safe to cache) ─

const accountIdCache = new Map<string, string>();

async function getAccountId(
  tx: Tx,
  country: Country,
  code: string
): Promise<string> {
  const key = `${country}:${code}`;
  const cached = accountIdCache.get(key);
  if (cached) return cached;
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.country, country), eq(accounts.code, code)));
  if (!row) {
    throw new Error(`accounting: no account ${code} seeded for ${country}`);
  }
  accountIdCache.set(key, row.id);
  return row.id;
}

// Okruh → account code mapping (SK Phase 1; mgmt arrives with CZ Phase 6).
function receivableCode(okruh: Okruh): string {
  if (okruh === "fpuo") return ACCOUNT_CODES.POHLADAVKY_VLASTNICI_FPUO;
  if (okruh === "svc") return ACCOUNT_CODES.POHLADAVKY_VLASTNICI_SLUZBY;
  throw new Error(`accounting: okruh ${okruh} not supported yet`);
}

function liabilityCode(okruh: Okruh): string {
  if (okruh === "fpuo") return ACCOUNT_CODES.ZAVAZKY_FPUO;
  if (okruh === "svc") return ACCOUNT_CODES.ZAVAZKY_SLUZBY;
  throw new Error(`accounting: okruh ${okruh} not supported yet`);
}

// ── Guards ─────────────────────────────────────────────

export async function assertPeriodOpen(tx: Tx, periodId: string): Promise<void> {
  const [period] = await tx
    .select({ status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.id, periodId));
  if (!period) throw new Error(`accounting: period ${periodId} not found`);
  if (period.status !== "open") {
    throw new Error(
      `accounting: period ${periodId} is ${period.status} — corrections post as reversals in the current open period`
    );
  }
}

// ── Core: entry + lines + audit ────────────────────────

interface EntryInput {
  entityId: string;
  periodId: string;
  country: Country;
  postedAt: Date;
  description: string;
  sourceType: "opening_balance" | "fee_schedule_publish" | "payment" | "manual";
  sourceId: string | null;
  createdById: string;
  lines: LineInput[];
  /** Required for manual entries — recorded in the audit log. */
  justification?: string;
}

async function insertEntry(tx: Tx, input: EntryInput): Promise<string> {
  const debits = input.lines.reduce((s, l) => s + (l.debitCents ?? 0), 0);
  const credits = input.lines.reduce((s, l) => s + (l.creditCents ?? 0), 0);
  if (input.lines.length === 0) {
    throw new Error("accounting: entry has no lines");
  }
  if (debits !== credits) {
    throw new Error(
      `accounting: unbalanced entry (debits ${debits} != credits ${credits}): ${input.description}`
    );
  }
  await assertPeriodOpen(tx, input.periodId);

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      entityId: input.entityId,
      periodId: input.periodId,
      postedAt: input.postedAt,
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      createdById: input.createdById,
    })
    .returning({ id: journalEntries.id });

  const accountIds = new Map<string, string>();
  for (const line of input.lines) {
    if (!accountIds.has(line.accountCode)) {
      accountIds.set(
        line.accountCode,
        await getAccountId(tx, input.country, line.accountCode)
      );
    }
  }

  await tx.insert(journalLines).values(
    input.lines.map((line) => ({
      journalEntryId: entry.id,
      accountId: accountIds.get(line.accountCode)!,
      debitCents: line.debitCents ?? 0,
      creditCents: line.creditCents ?? 0,
      okruh: line.okruh,
      unitEntityId: line.unitEntityId ?? null,
      serviceCategoryId: line.serviceCategoryId ?? null,
    }))
  );

  await tx.insert(auditLog).values({
    entityId: input.entityId,
    actorId: input.createdById,
    action: "insert",
    tableName: "mod_accounting_journal_entries",
    recordId: entry.id,
    after: {
      description: input.description,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      debitsCents: debits,
    },
    justification: input.justification ?? null,
  });

  return entry.id;
}

// ── Opening balance ────────────────────────────────────

export interface OpeningBalanceInput {
  entityId: string;
  periodId: string;
  country: Country;
  createdById: string;
  asOf: Date;
  bankaCents: number;
  pokladnicaCents: number;
  /**
   * Per-unit fund/advance balances as of the opening date. Positive =
   * the SVB holds the unit's money (normal case, credit side). Negative =
   * the unit OWES that amount (opening nedoplatok, posts as receivable).
   */
  unitBalances: {
    unitEntityId: string;
    fpuoCents: number;
    zalohyCents: number;
  }[];
}

/**
 * Posts the opening-balance entry. The korekcia against 428 (výsledok
 * minulých rokov) is derived, never passed in: the UI shows the treasurer
 * the rozdiel and this function books it — the invariant
 * `banka + pokladnica = Σ fpúo + Σ zálohy + výsledok` holds by construction.
 */
export async function postOpeningBalance(
  tx: Tx,
  input: OpeningBalanceInput
): Promise<string> {
  const lines: LineInput[] = [];

  if (input.bankaCents > 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.BANKA,
      debitCents: input.bankaCents,
      okruh: "fpuo",
    });
  }
  if (input.pokladnicaCents > 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.POKLADNICA,
      debitCents: input.pokladnicaCents,
      okruh: "fpuo",
    });
  }

  for (const unit of input.unitBalances) {
    for (const [amount, okruh] of [
      [unit.fpuoCents, "fpuo"],
      [unit.zalohyCents, "svc"],
    ] as const) {
      if (amount > 0) {
        lines.push({
          accountCode: liabilityCode(okruh),
          creditCents: amount,
          okruh,
          unitEntityId: unit.unitEntityId,
        });
      } else if (amount < 0) {
        lines.push({
          accountCode: receivableCode(okruh),
          debitCents: -amount,
          okruh,
          unitEntityId: unit.unitEntityId,
        });
      }
    }
  }

  const debits = lines.reduce((s, l) => s + (l.debitCents ?? 0), 0);
  const credits = lines.reduce((s, l) => s + (l.creditCents ?? 0), 0);
  const diff = debits - credits;
  if (diff > 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.VYSLEDOK_MINULYCH_ROKOV,
      creditCents: diff,
      okruh: "fpuo",
    });
  } else if (diff < 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.VYSLEDOK_MINULYCH_ROKOV,
      debitCents: -diff,
      okruh: "fpuo",
    });
  }

  return insertEntry(tx, {
    entityId: input.entityId,
    periodId: input.periodId,
    country: input.country,
    postedAt: input.asOf,
    description: "Otváracia súvaha",
    sourceType: "opening_balance",
    sourceId: input.periodId,
    createdById: input.createdById,
    lines,
  });
}

// ── Predpis: post one month's assessments as they become due ─

/**
 * Posts the journal entry for one due month of a published schedule:
 * Dr pohľadávky per unit / Cr záväzky per okruh. Idempotent — assessments
 * already carrying a journalEntryId are skipped; posting an already-posted
 * month is a no-op. Callers loop months <= current.
 */
export async function postAssessmentsForMonth(
  tx: Tx,
  input: {
    entityId: string;
    periodId: string;
    scheduleId: string;
    country: Country;
    createdById: string;
    year: number;
    month: number;
  }
): Promise<string | null> {
  const rows = await tx
    .select({
      id: feeAssessments.id,
      unitEntityId: feeAssessments.unitEntityId,
      serviceCategoryId: feeAssessments.serviceCategoryId,
      amountCents: feeAssessments.amountCents,
      journalEntryId: feeAssessments.journalEntryId,
    })
    .from(feeAssessments)
    .where(
      and(
        eq(feeAssessments.scheduleId, input.scheduleId),
        eq(feeAssessments.month, input.month)
      )
    );

  const unposted = rows.filter((r) => r.journalEntryId === null);
  if (unposted.length === 0) return null;

  // Resolve okruh per category once (seed catalog, tiny).
  const categoryIds = [...new Set(unposted.map((r) => r.serviceCategoryId))];
  const categories = await tx
    .select({
      id: serviceCategories.id,
      okruh: serviceCategories.okruh,
    })
    .from(serviceCategories)
    .where(inArray(serviceCategories.id, categoryIds));
  const okruhByCategory = new Map(categories.map((c) => [c.id, c.okruh]));

  const lines: LineInput[] = [];
  const liabilityTotals = new Map<Okruh, number>();

  for (const row of unposted) {
    const okruh = okruhByCategory.get(row.serviceCategoryId);
    if (!okruh) {
      throw new Error(
        `accounting: unknown service category ${row.serviceCategoryId}`
      );
    }
    lines.push({
      accountCode: receivableCode(okruh),
      debitCents: row.amountCents,
      okruh,
      unitEntityId: row.unitEntityId,
      serviceCategoryId: row.serviceCategoryId,
    });
    liabilityTotals.set(
      okruh,
      (liabilityTotals.get(okruh) ?? 0) + row.amountCents
    );
  }
  for (const [okruh, total] of liabilityTotals) {
    lines.push({
      accountCode: liabilityCode(okruh),
      creditCents: total,
      okruh,
    });
  }

  const entryId = await insertEntry(tx, {
    entityId: input.entityId,
    periodId: input.periodId,
    country: input.country,
    postedAt: new Date(Date.UTC(input.year, input.month - 1, 1)),
    description: `Predpis ${input.year}-${String(input.month).padStart(2, "0")}`,
    sourceType: "fee_schedule_publish",
    sourceId: input.scheduleId,
    createdById: input.createdById,
    lines,
  });

  await tx
    .update(feeAssessments)
    .set({ journalEntryId: entryId })
    .where(
      inArray(
        feeAssessments.id,
        unposted.map((r) => r.id)
      )
    );

  return entryId;
}

// ── Payment matched ────────────────────────────────────

/**
 * Posts a matched payment: Dr banka for the FULL payment amount (the cash
 * really arrived — the ledger's 221 must tie out with the bank statement),
 * Cr pohľadávky per allocation, and Cr 379 (iné záväzky) for any
 * unallocated remainder — the preplatok parked on the unit. A payment with
 * zero allocations still posts (pure preplatok). Idempotent via
 * payments.journalEntryId.
 */
export async function postPaymentMatched(
  tx: Tx,
  input: {
    paymentId: string;
    entityId: string;
    periodId: string;
    country: Country;
    createdById: string;
    allocatedBy: "auto" | "manual";
    /** Unit the payment belongs to — carries the preplatok credit line. */
    unitEntityId: string | null;
    allocations: {
      assessmentId: string;
      unitEntityId: string;
      serviceCategoryId: string;
      okruh: Okruh;
      amountCents: number;
    }[];
  }
): Promise<string> {
  const [payment] = await tx
    .select({
      amountCents: payments.amountCents,
      journalEntryId: payments.journalEntryId,
      voidedAt: payments.voidedAt,
    })
    .from(payments)
    .where(eq(payments.id, input.paymentId));
  if (!payment) {
    throw new Error(`accounting: payment ${input.paymentId} not found`);
  }
  if (payment.voidedAt) {
    throw new Error(`accounting: payment ${input.paymentId} is voided`);
  }
  if (payment.journalEntryId) {
    throw new Error(
      `accounting: payment ${input.paymentId} already posted — void first to re-match`
    );
  }
  const allocated = input.allocations.reduce((s, a) => s + a.amountCents, 0);
  if (allocated > payment.amountCents) {
    throw new Error(
      `accounting: allocations ${allocated} exceed payment ${payment.amountCents}`
    );
  }
  const preplatok = payment.amountCents - allocated;

  // Okruh on the cash and preplatok-parking lines is nominal (the money is
  // not pool-assigned until applied) — "svc" mirrors zálohy semantics.
  const lines: LineInput[] = [
    {
      accountCode: ACCOUNT_CODES.BANKA,
      debitCents: payment.amountCents,
      okruh: "svc",
    },
    ...input.allocations.map((a) => ({
      accountCode: receivableCode(a.okruh),
      creditCents: a.amountCents,
      okruh: a.okruh,
      unitEntityId: a.unitEntityId,
      serviceCategoryId: a.serviceCategoryId,
    })),
  ];
  if (preplatok > 0) {
    lines.push({
      accountCode: ACCOUNT_CODES.INE_ZAVAZKY,
      creditCents: preplatok,
      okruh: "svc",
      unitEntityId: input.unitEntityId,
    });
  }

  const entryId = await insertEntry(tx, {
    entityId: input.entityId,
    periodId: input.periodId,
    country: input.country,
    postedAt: new Date(),
    description: `Úhrada — párovanie platby`,
    sourceType: "payment",
    sourceId: input.paymentId,
    createdById: input.createdById,
    lines,
  });

  if (input.allocations.length > 0) {
    await tx.insert(paymentAllocations).values(
      input.allocations.map((a) => ({
        paymentId: input.paymentId,
        assessmentId: a.assessmentId,
        amountCents: a.amountCents,
        allocatedBy: input.allocatedBy,
      }))
    );
  }

  await tx
    .update(payments)
    .set({ journalEntryId: entryId })
    .where(eq(payments.id, input.paymentId));

  return entryId;
}

// ── Apply parked preplatok against open assessments ────

/**
 * Applies a payment's parked preplatok (credit sitting on 379 for the
 * unit) to open assessments: Dr 379 / Cr pohľadávky per allocation, plus
 * the allocation rows. The caller computes the allocations and guarantees
 * they don't exceed the payment's unallocated remainder — re-verified
 * here against the DB.
 */
export async function applyPaymentCredit(
  tx: Tx,
  input: {
    paymentId: string;
    entityId: string;
    periodId: string;
    country: Country;
    createdById: string;
    unitEntityId: string;
    /** "manual" when a person triggered the application (audit). */
    allocatedBy: "auto" | "manual";
    allocations: {
      assessmentId: string;
      serviceCategoryId: string;
      okruh: Okruh;
      amountCents: number;
    }[];
  }
): Promise<string> {
  if (input.allocations.length === 0) {
    throw new Error("accounting: credit application needs allocations");
  }
  const [payment] = await tx
    .select({
      amountCents: payments.amountCents,
      journalEntryId: payments.journalEntryId,
      voidedAt: payments.voidedAt,
    })
    .from(payments)
    .where(eq(payments.id, input.paymentId));
  if (!payment) {
    throw new Error(`accounting: payment ${input.paymentId} not found`);
  }
  if (payment.voidedAt) {
    throw new Error(`accounting: payment ${input.paymentId} is voided`);
  }
  if (!payment.journalEntryId) {
    throw new Error(
      `accounting: payment ${input.paymentId} is not posted — match it first`
    );
  }
  const [allocatedRow] = await tx
    .select({
      total: sql<number>`coalesce(sum(${paymentAllocations.amountCents}), 0)::int`,
    })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, input.paymentId));
  const remainder = payment.amountCents - (allocatedRow?.total ?? 0);
  const applying = input.allocations.reduce((s, a) => s + a.amountCents, 0);
  if (applying > remainder) {
    throw new Error(
      `accounting: applying ${applying} exceeds parked remainder ${remainder}`
    );
  }

  const lines: LineInput[] = [
    {
      accountCode: ACCOUNT_CODES.INE_ZAVAZKY,
      debitCents: applying,
      okruh: "svc",
      unitEntityId: input.unitEntityId,
    },
    ...input.allocations.map((a) => ({
      accountCode: receivableCode(a.okruh),
      creditCents: a.amountCents,
      okruh: a.okruh,
      unitEntityId: input.unitEntityId,
      serviceCategoryId: a.serviceCategoryId,
    })),
  ];

  const entryId = await insertEntry(tx, {
    entityId: input.entityId,
    periodId: input.periodId,
    country: input.country,
    postedAt: new Date(),
    description: "Použitie preplatku",
    sourceType: "payment",
    sourceId: input.paymentId,
    createdById: input.createdById,
    lines,
  });

  await tx.insert(paymentAllocations).values(
    input.allocations.map((a) => ({
      paymentId: input.paymentId,
      assessmentId: a.assessmentId,
      amountCents: a.amountCents,
      allocatedBy: input.allocatedBy,
    }))
  );

  return entryId;
}

// ── Void payment (open-period correction) ──────────────

/**
 * Voids a wrongly matched/entered payment: posts a mirror reversal entry,
 * stamps voidedAt/voidedBy/voidReason. Allocation rows are kept for
 * history — balance queries exclude them via payments.voidedAt IS NULL.
 */
export async function voidPayment(
  tx: Tx,
  input: {
    paymentId: string;
    entityId: string;
    periodId: string;
    country: Country;
    actorId: string;
    reason: string;
  }
): Promise<string | null> {
  if (!input.reason.trim()) {
    throw new Error("accounting: void requires a reason");
  }
  const [payment] = await tx
    .select({
      journalEntryId: payments.journalEntryId,
      voidedAt: payments.voidedAt,
    })
    .from(payments)
    .where(eq(payments.id, input.paymentId));
  if (!payment) {
    throw new Error(`accounting: payment ${input.paymentId} not found`);
  }
  if (payment.voidedAt) {
    throw new Error(`accounting: payment ${input.paymentId} already voided`);
  }

  let reversalId: string | null = null;
  // Reverse EVERY entry the payment produced — the original match AND any
  // later credit applications (Dr 379 / Cr pohľadávky). Reversals are only
  // created here, and voidedAt guards re-entry, so at this point all
  // entries carrying this payment as source are forward postings.
  const originalEntries = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.sourceType, "payment"),
        eq(journalEntries.sourceId, input.paymentId)
      )
    );
  if (originalEntries.length > 0) {
    const originalLines = await tx
      .select({
        accountId: journalLines.accountId,
        debitCents: journalLines.debitCents,
        creditCents: journalLines.creditCents,
        okruh: journalLines.okruh,
        unitEntityId: journalLines.unitEntityId,
        serviceCategoryId: journalLines.serviceCategoryId,
      })
      .from(journalLines)
      .where(
        inArray(
          journalLines.journalEntryId,
          originalEntries.map((e) => e.id)
        )
      );

    await assertPeriodOpen(tx, input.periodId);
    const [entry] = await tx
      .insert(journalEntries)
      .values({
        entityId: input.entityId,
        periodId: input.periodId,
        postedAt: new Date(),
        description: `Storno úhrady — ${input.reason}`,
        sourceType: "payment",
        sourceId: input.paymentId,
        createdById: input.actorId,
      })
      .returning({ id: journalEntries.id });
    reversalId = entry.id;

    // Mirror: swap debit/credit on every original line.
    await tx.insert(journalLines).values(
      originalLines.map((line) => ({
        journalEntryId: entry.id,
        accountId: line.accountId,
        debitCents: line.creditCents,
        creditCents: line.debitCents,
        okruh: line.okruh,
        unitEntityId: line.unitEntityId,
        serviceCategoryId: line.serviceCategoryId,
      }))
    );
  }

  await tx
    .update(payments)
    .set({
      voidedAt: new Date(),
      voidedById: input.actorId,
      voidReason: input.reason,
      voidJournalEntryId: reversalId,
    })
    .where(eq(payments.id, input.paymentId));

  await tx.insert(auditLog).values({
    entityId: input.entityId,
    actorId: input.actorId,
    action: "void",
    tableName: "mod_accounting_payments",
    recordId: input.paymentId,
    after: { reversalEntryId: reversalId },
    justification: input.reason,
  });

  return reversalId;
}

// ── Manual entry (escape hatch — last resort) ──────────

/**
 * Free-form journal entry. Domain rule: allowed as LAST option only,
 * always with a justification (audit-logged), always transparent to
 * owners, still balanced. UI must present this behind the "Pohľad
 * účtovníka" surface, never as a primary action.
 */
export async function postManualEntry(
  tx: Tx,
  input: {
    entityId: string;
    periodId: string;
    country: Country;
    createdById: string;
    postedAt: Date;
    description: string;
    justification: string;
    lines: LineInput[];
  }
): Promise<string> {
  if (!input.justification.trim()) {
    throw new Error("accounting: manual entry requires a justification");
  }
  return insertEntry(tx, {
    entityId: input.entityId,
    periodId: input.periodId,
    country: input.country,
    postedAt: input.postedAt,
    description: input.description,
    sourceType: "manual",
    sourceId: null,
    createdById: input.createdById,
    lines: input.lines,
    justification: input.justification,
  });
}
