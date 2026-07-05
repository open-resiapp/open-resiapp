import "server-only";

import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountingPeriods,
  expenses,
  feeAssessments,
  feeSchedules,
  journalEntries,
  journalLines,
  payments,
  paymentAllocations,
} from "../db/schema";
import { ACCOUNT_CODES } from "../seeds/coa-sk";
import {
  collectionRateFrom,
  projectCashflow,
  type CashflowProjection,
  type ProjectionMonthInput,
} from "../projection/cashflow";

// Assembles the 6-month cash-flow projection inputs from live data:
//   opening = current 211 + 221 (derived from postings, invariant 11)
//   inflow  = published assessments per future month; months beyond the
//             published horizon extrapolate the last known month (flagged)
//   outflow = average monthly non-voided expense over the last 6 months
//   rate    = paid/due over the posted history, bounded 0..1

type Country = "sk" | "cz";

const HORIZON_MONTHS = 6;

export async function getCashflowProjection(
  entityId: string,
  country: Country,
  now = new Date()
): Promise<CashflowProjection> {
  // Opening cash: 211 + 221.
  const [cash] = await db
    .select({
      balance: sql<number>`coalesce(sum(${journalLines.debitCents} - ${journalLines.creditCents}), 0)::int`,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .innerJoin(
      journalEntries,
      eq(journalLines.journalEntryId, journalEntries.id)
    )
    .where(
      and(
        eq(journalEntries.entityId, entityId),
        eq(accounts.country, country),
        inArray(accounts.code, [ACCOUNT_CODES.POKLADNICA, ACCOUNT_CODES.BANKA])
      )
    );

  // Future predpis per (year, month) from published schedules.
  const assessmentTotals = await db
    .select({
      year: accountingPeriods.year,
      month: feeAssessments.month,
      total: sql<number>`sum(${feeAssessments.amountCents})::int`,
    })
    .from(feeAssessments)
    .innerJoin(feeSchedules, eq(feeAssessments.scheduleId, feeSchedules.id))
    .innerJoin(
      accountingPeriods,
      eq(feeAssessments.periodId, accountingPeriods.id)
    )
    .where(
      and(
        eq(feeSchedules.entityId, entityId),
        eq(feeSchedules.status, "published")
      )
    )
    .groupBy(accountingPeriods.year, feeAssessments.month);
  const totalByYearMonth = new Map(
    assessmentTotals.map((r) => [`${r.year}-${r.month}`, r.total])
  );
  const lastKnownPredpis =
    assessmentTotals.length > 0
      ? assessmentTotals.sort(
          (a, b) => a.year - b.year || a.month - b.month
        )[assessmentTotals.length - 1].total
      : 0;

  // Collection rate: allocations (paid) vs posted assessments (due).
  const [due] = await db
    .select({
      total: sql<number>`coalesce(sum(${feeAssessments.amountCents}), 0)::int`,
    })
    .from(feeAssessments)
    .innerJoin(
      accountingPeriods,
      eq(feeAssessments.periodId, accountingPeriods.id)
    )
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        sql`${feeAssessments.journalEntryId} is not null`
      )
    );
  const [paid] = await db
    .select({
      total: sql<number>`coalesce(sum(${paymentAllocations.amountCents}), 0)::int`,
    })
    .from(paymentAllocations)
    .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
    .where(
      and(eq(payments.entityId, entityId), isNull(payments.voidedAt))
    );

  // Recurring outflow: average monthly expense over the covered history —
  // dividing by a hard 6 would understate the burn for a dom with less
  // than 6 months of records (1 month of invoices ÷ 6 ≈ nothing).
  const sixMonthsAgo = new Date(now.getTime() - 182 * 24 * 3600 * 1000);
  const [expenseAvg] = await db
    .select({
      total: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int`,
      earliest: sql<string | null>`min(${expenses.invoiceDate})::text`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.entityId, entityId),
        isNull(expenses.voidedAt),
        gte(expenses.invoiceDate, sixMonthsAgo)
      )
    );
  const historyMonths = expenseAvg?.earliest
    ? Math.min(
        6,
        Math.max(
          1,
          Math.ceil(
            (now.getTime() - new Date(expenseAvg.earliest).getTime()) /
              (30 * 24 * 3600 * 1000)
          )
        )
      )
    : 6;
  const monthlyExpense = Math.round((expenseAvg?.total ?? 0) / historyMonths);

  const months: ProjectionMonthInput[] = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  for (let i = 0; i < HORIZON_MONTHS; i++) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const known = totalByYearMonth.get(`${year}-${month}`);
    months.push({
      month,
      year,
      predpisCents: known ?? lastKnownPredpis,
      expenseCents: monthlyExpense,
      estimated: known === undefined,
    });
  }

  return projectCashflow({
    openingCents: cash?.balance ?? 0,
    collectionRate: collectionRateFrom(due?.total ?? 0, paid?.total ?? 0),
    months,
  });
}
