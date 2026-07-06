import "server-only";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  expenses,
  journalEntries,
  journalLines,
  serviceCategories,
  expenseAuthorisations,
  auditLog,
} from "../db/schema";
import {
  postSupplierInvoice,
  postSupplierPayment,
  assertPeriodOpen,
} from "../engine/booking";
import { lockOpenPeriods, periodForReceivedAt } from "./periods";
import { isValidIban, normalizeIban } from "./iban";

// Expense ledger (BYT-20260512-002 Phase 3 slice). Manual entry primary.
// Rules (spec + docs/domain/accounting.md):
//   - brutto is authoritative (it leaves the account and is split among
//     owners at vyúčtovanie); netto/DPH recorded for the doklad
//   - FPÚO expenses debit the fund (472); services expenses hit 5xx
//   - a supplier invoice is a doklad: IČO, supplier IBAN and the
//     netto/DPH breakdown are required (AC 440), not just the brutto
//   - REVIZIA_* categories require nextInspectionDueAt (AC 469) — enforced
//     below once the category slug is resolved
//   - corrections are voids (mirror reversal), never edits of posted rows

type Country = "sk" | "cz";

export interface CreateExpenseInput {
  entityId: string;
  country: Country;
  createdById: string;
  supplierName: string;
  supplierIco?: string | null;
  supplierDic?: string | null;
  supplierIban?: string | null;
  invoiceNo: string;
  invoiceDate: Date;
  dueDate?: Date | null;
  serviceCategoryId: string | null;
  okruh: "fpuo" | "svc";
  amountCents: number;
  amountNettoCents?: number | null;
  dphRateBp?: number | null;
  dphCents?: number | null;
  nextInspectionDueAt?: Date | null;
  /** Realises a voting-approved expense authorisation (AC 514/515). */
  authorisationId?: string | null;
}

export async function createExpense(
  input: CreateExpenseInput
): Promise<{ expenseId: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("accounting: expense amount must be > 0");
  }
  if (!input.supplierName.trim()) {
    throw new Error("accounting: supplier name required");
  }
  if (!input.invoiceNo.trim()) {
    throw new Error("accounting: invoice number required");
  }
  // A supplier invoice is an účtovný doklad — identity, payee account and
  // the VAT breakdown are mandatory (AC 440). (Attachment is required too,
  // but it's uploaded on a separate endpoint after the row is created.)
  if (!input.supplierIco || !input.supplierIco.trim()) {
    throw new Error("accounting: supplier IČO required");
  }
  if (!input.supplierIban || !input.supplierIban.trim()) {
    throw new Error("accounting: supplier IBAN required");
  }
  if (input.amountNettoCents == null || input.dphCents == null) {
    throw new Error("accounting: netto and DPH amounts required");
  }
  const iban = normalizeIban(input.supplierIban);
  if (!iban || !isValidIban(iban)) {
    throw new Error("accounting: invalid supplier IBAN (MOD-97)");
  }
  if (input.amountNettoCents != null && input.amountNettoCents < 0) {
    throw new Error("accounting: netto must be >= 0");
  }
  if (input.dphCents != null && input.dphCents < 0) {
    throw new Error("accounting: DPH must be >= 0");
  }
  if (
    input.dphRateBp != null &&
    (input.dphRateBp < 0 || input.dphRateBp > 3000)
  ) {
    throw new Error("accounting: DPH rate out of range");
  }
  if (
    input.amountNettoCents != null &&
    input.amountNettoCents > input.amountCents
  ) {
    throw new Error("accounting: netto cannot exceed brutto");
  }
  if (
    input.amountNettoCents != null &&
    input.dphCents != null &&
    input.amountNettoCents + input.dphCents !== input.amountCents
  ) {
    throw new Error("accounting: netto + DPH must equal brutto");
  }

  return db.transaction(async (tx) => {
    await lockOpenPeriods(tx, input.entityId);
    const period = await periodForReceivedAt(
      tx,
      input.entityId,
      input.invoiceDate
    );

    // The okruh FOLLOWS the category when one is set — a mismatched pair
    // would route the debit to the wrong pool account (silent pool mixing,
    // domain invariant 3). Client okruh only decides for uncategorized.
    let categorySlug: string | null = null;
    let okruh = input.okruh;
    if (input.serviceCategoryId) {
      const [category] = await tx
        .select({ slug: serviceCategories.slug, okruh: serviceCategories.okruh })
        .from(serviceCategories)
        .where(
          and(
            eq(serviceCategories.id, input.serviceCategoryId),
            eq(serviceCategories.country, input.country)
          )
        );
      if (!category) throw new Error("accounting: unknown service category");
      categorySlug = category.slug;
      okruh = category.okruh === "fpuo" ? "fpuo" : "svc";
    }

    // Technical-audit expenses (REVIZIA_*) must carry the next inspection
    // date — the dashboard/.ics deadlines depend on it (AC 469).
    if (categorySlug?.startsWith("REVIZIA_") && !input.nextInspectionDueAt) {
      throw new Error(
        "accounting: revízia expense requires a next-inspection date"
      );
    }

    // Soft duplicate guard — a resubmitted identical invoice would
    // double-post the payable and the fund drawdown.
    const [duplicate] = await tx
      .select({ id: expenses.id })
      .from(expenses)
      .where(
        and(
          eq(expenses.entityId, input.entityId),
          eq(expenses.invoiceNo, input.invoiceNo.trim()),
          eq(expenses.supplierName, input.supplierName.trim()),
          isNull(expenses.voidedAt)
        )
      )
      .limit(1);
    if (duplicate) {
      throw new Error(
        `accounting: invoice ${input.invoiceNo.trim()} from this supplier is already recorded`
      );
    }

    // Realising a voting-approved authorisation: lock it, carry its voting
    // item onto the journal entry (515), and mark it used below.
    let votingResolutionId: string | null = null;
    if (input.authorisationId) {
      const [auth] = await tx
        .select({
          id: expenseAuthorisations.id,
          votingItemId: expenseAuthorisations.votingItemId,
          status: expenseAuthorisations.status,
        })
        .from(expenseAuthorisations)
        .where(
          and(
            eq(expenseAuthorisations.id, input.authorisationId),
            eq(expenseAuthorisations.entityId, input.entityId)
          )
        )
        .for("update");
      if (!auth) throw new Error("accounting: authorisation not found");
      if (auth.status !== "draft") {
        throw new Error("accounting: authorisation already used or cancelled");
      }
      votingResolutionId = auth.votingItemId;
    }

    const [expense] = await tx
      .insert(expenses)
      .values({
        entityId: input.entityId,
        supplierName: input.supplierName.trim(),
        supplierIco: input.supplierIco?.trim() || null,
        supplierDic: input.supplierDic?.trim() || null,
        supplierIban: iban,
        invoiceNo: input.invoiceNo.trim(),
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate ?? null,
        serviceCategoryId: input.serviceCategoryId,
        okruh,
        amountCents: input.amountCents,
        amountNettoCents: input.amountNettoCents ?? null,
        dphRateBp: input.dphRateBp ?? null,
        dphCents: input.dphCents ?? null,
        nextInspectionDueAt: input.nextInspectionDueAt ?? null,
        createdById: input.createdById,
      })
      .returning({ id: expenses.id });

    const entryId = await postSupplierInvoice(tx, {
      expenseId: expense.id,
      entityId: input.entityId,
      periodId: period.id,
      country: input.country,
      createdById: input.createdById,
      okruh,
      categorySlug,
      serviceCategoryId: input.serviceCategoryId,
      amountCents: input.amountCents,
      description: `Faktúra ${input.invoiceNo.trim()} — ${input.supplierName.trim()}`,
      votingResolutionId,
    });
    await tx
      .update(expenses)
      .set({ journalEntryId: entryId })
      .where(eq(expenses.id, expense.id));

    // Mark the authorisation spent (idempotent — locked + draft-guarded).
    if (input.authorisationId) {
      await tx
        .update(expenseAuthorisations)
        .set({ status: "used", usedExpenseId: expense.id })
        .where(eq(expenseAuthorisations.id, input.authorisationId));
    }

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.createdById,
      action: "insert",
      tableName: "mod_accounting_expenses",
      recordId: expense.id,
      after: {
        supplierName: input.supplierName.trim(),
        invoiceNo: input.invoiceNo.trim(),
        amountCents: input.amountCents,
        okruh,
      },
    });

    return { expenseId: expense.id };
  });
}

export async function markExpensePaid(input: {
  entityId: string;
  country: Country;
  expenseId: string;
  actorId: string;
  method: "bank" | "cash";
  paidAt?: Date;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOpenPeriods(tx, input.entityId);
    const [expense] = await tx
      .select({
        okruh: expenses.okruh,
        amountCents: expenses.amountCents,
        paidAt: expenses.paidAt,
        voidedAt: expenses.voidedAt,
      })
      .from(expenses)
      .where(
        and(eq(expenses.id, input.expenseId), eq(expenses.entityId, input.entityId))
      )
      .for("update");
    if (!expense) throw new Error("accounting: expense not found");
    if (expense.voidedAt) throw new Error("accounting: expense is voided");
    if (expense.paidAt) throw new Error("accounting: expense already paid");

    const paidAt = input.paidAt ?? new Date();
    const period = await periodForReceivedAt(tx, input.entityId, paidAt);
    const entryId = await postSupplierPayment(tx, {
      expenseId: input.expenseId,
      entityId: input.entityId,
      periodId: period.id,
      country: input.country,
      createdById: input.actorId,
      okruh: expense.okruh,
      amountCents: expense.amountCents,
      method: input.method,
    });
    await tx
      .update(expenses)
      .set({
        paidAt,
        paymentJournalEntryId: entryId,
        paymentMethod: input.method,
      })
      .where(eq(expenses.id, input.expenseId));

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_expenses",
      recordId: input.expenseId,
      after: { paidAt: paidAt.toISOString(), method: input.method },
    });
  });
}

/** Void = mirror-reverse every entry the expense produced (open period). */
export async function voidExpense(input: {
  entityId: string;
  country: Country;
  expenseId: string;
  actorId: string;
  reason: string;
}): Promise<void> {
  if (!input.reason.trim()) {
    throw new Error("accounting: void requires a reason");
  }
  await db.transaction(async (tx) => {
    await lockOpenPeriods(tx, input.entityId);
    const [expense] = await tx
      .select({
        voidedAt: expenses.voidedAt,
        paidAt: expenses.paidAt,
        supplierName: expenses.supplierName,
        invoiceNo: expenses.invoiceNo,
        amountCents: expenses.amountCents,
        okruh: expenses.okruh,
        serviceCategoryId: expenses.serviceCategoryId,
      })
      .from(expenses)
      .where(
        and(eq(expenses.id, input.expenseId), eq(expenses.entityId, input.entityId))
      )
      .for("update");
    if (!expense) throw new Error("accounting: expense not found");
    if (expense.voidedAt) throw new Error("accounting: expense already voided");
    // A paid expense must not void: reversing the payment leg would put
    // cash back into the ledger's 221/211 that never returned to the real
    // account — bank reconciliation would break. The refund flow (money
    // actually coming back) is a separate future feature.
    if (expense.paidAt) {
      throw new Error(
        "accounting: expense is already paid — a paid invoice cannot be voided, record a supplier refund instead"
      );
    }

    const period = await periodForReceivedAt(tx, input.entityId, new Date());
    await assertPeriodOpen(tx, period.id);

    const originalEntries = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.sourceType, "expense"),
          eq(journalEntries.sourceId, input.expenseId)
        )
      );
    let reversalId: string | null = null;
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
      const [entry] = await tx
        .insert(journalEntries)
        .values({
          entityId: input.entityId,
          periodId: period.id,
          postedAt: new Date(),
          description: `Storno faktúry — ${input.reason.trim()}`,
          sourceType: "expense",
          sourceId: input.expenseId,
          createdById: input.actorId,
        })
        .returning({ id: journalEntries.id });
      reversalId = entry.id;
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
      .update(expenses)
      .set({
        voidedAt: new Date(),
        voidedById: input.actorId,
        voidReason: input.reason.trim(),
        voidJournalEntryId: reversalId,
      })
      .where(eq(expenses.id, input.expenseId));

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "void",
      tableName: "mod_accounting_expenses",
      recordId: input.expenseId,
      before: {
        supplierName: expense.supplierName,
        invoiceNo: expense.invoiceNo,
        amountCents: expense.amountCents,
        okruh: expense.okruh,
        serviceCategoryId: expense.serviceCategoryId,
      },
      after: { voidedAt: true, reversalEntryId: reversalId },
      justification: input.reason.trim(),
    });
  });
}

export interface ExpenseListRow {
  id: string;
  supplierName: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string | null;
  categorySlug: string | null;
  okruh: "fpuo" | "svc" | "mgmt";
  amountCents: number;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  attachmentVisibility: "public" | "redacted_required" | "restricted";
}

export async function listExpenses(
  entityId: string,
  limit = 200
): Promise<ExpenseListRow[]> {
  const rows = await db
    .select({
      id: expenses.id,
      supplierName: expenses.supplierName,
      invoiceNo: expenses.invoiceNo,
      invoiceDate: expenses.invoiceDate,
      dueDate: expenses.dueDate,
      categorySlug: serviceCategories.slug,
      okruh: expenses.okruh,
      amountCents: expenses.amountCents,
      paidAt: expenses.paidAt,
      voidedAt: expenses.voidedAt,
      voidReason: expenses.voidReason,
      attachmentVisibility: expenses.attachmentVisibility,
    })
    .from(expenses)
    .leftJoin(
      serviceCategories,
      eq(expenses.serviceCategoryId, serviceCategories.id)
    )
    .where(eq(expenses.entityId, entityId))
    .orderBy(desc(expenses.invoiceDate), desc(expenses.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    ...r,
    invoiceDate: r.invoiceDate.toISOString(),
    dueDate: r.dueDate?.toISOString() ?? null,
    paidAt: r.paidAt?.toISOString() ?? null,
    voidedAt: r.voidedAt?.toISOString() ?? null,
  }));
}

/** Uncategorized (non-voided) count — dashboard "Vyžaduje pozornosť". */
export async function countUncategorizedExpenses(
  entityId: string
): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(expenses)
    .where(
      and(
        eq(expenses.entityId, entityId),
        isNull(expenses.serviceCategoryId),
        isNull(expenses.voidedAt)
      )
    );
  return row.count;
}
