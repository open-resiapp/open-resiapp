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
import { serviceCategories } from "../db/schema";
import {
  collectionRateFrom,
  projectPools,
  type PooledCashflowProjection,
  type ProjectionMonthInput,
} from "../projection/cashflow";

// Assembles the 6-month cash-flow projection inputs from live data, PER POOL
// (FPÚO + služby — AC 484), summed into a dom-wide total:
//   opening = each pool's cash-basis fund net (FPÚO: 472 − open 311.100;
//             služby: 478 − open 311.200) — the fond-opráv tile's basis;
//             raw cash is shared across pools, so a per-pool cash split
//             would be fiction
//   inflow  = published assessments per future month, split by okruh; months
//             beyond the published horizon extrapolate the last known month
//   outflow = recurring commitments (latest per supplier+category, AC 486) +
//             the average of NON-recurring expenses over the covered history,
//             both split by okruh (no double count — the average excludes
//             recurring invoices)
//   rate    = paid/due over the posted history, bounded 0..1

type Country = "sk" | "cz";
type Okruh = "fpuo" | "svc";
const POOLS: Okruh[] = ["fpuo", "svc"];

const HORIZON_MONTHS = 6;

/** Dr − Cr for a set of account codes. */
async function codeBalance(
  entityId: string,
  country: Country,
  codes: string[]
): Promise<number> {
  const [row] = await db
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
        inArray(accounts.code, codes)
      )
    );
  return row?.balance ?? 0;
}

export async function getCashflowProjection(
  entityId: string,
  country: Country,
  now = new Date()
): Promise<PooledCashflowProjection> {
  // Per-pool opening = liability (Cr, so negate Dr−Cr) minus its open
  // receivables (Dr). This is the pool's cash-basis fund net.
  const [fpuoLiab, fpuoRec, svcLiab, svcRec] = await Promise.all([
    codeBalance(entityId, country, [ACCOUNT_CODES.ZAVAZKY_FPUO]),
    codeBalance(entityId, country, [ACCOUNT_CODES.POHLADAVKY_VLASTNICI_FPUO]),
    codeBalance(entityId, country, [ACCOUNT_CODES.ZAVAZKY_SLUZBY]),
    codeBalance(entityId, country, [ACCOUNT_CODES.POHLADAVKY_VLASTNICI_SLUZBY]),
  ]);
  const openingByPool: Record<Okruh, number> = {
    fpuo: -fpuoLiab - Math.max(0, fpuoRec),
    svc: -svcLiab - Math.max(0, svcRec),
  };

  // Future predpis per (year, month, okruh) from published schedules.
  const assessmentTotals = await db
    .select({
      year: accountingPeriods.year,
      month: feeAssessments.month,
      okruh: serviceCategories.okruh,
      total: sql<number>`sum(${feeAssessments.amountCents})::int`,
    })
    .from(feeAssessments)
    .innerJoin(feeSchedules, eq(feeAssessments.scheduleId, feeSchedules.id))
    .innerJoin(
      serviceCategories,
      eq(feeAssessments.serviceCategoryId, serviceCategories.id)
    )
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
    .groupBy(accountingPeriods.year, feeAssessments.month, serviceCategories.okruh);
  const poolKey = (o: string): Okruh => (o === "fpuo" ? "fpuo" : "svc");
  const predpisByPoolYm = new Map<string, number>();
  const lastPredpisByPool: Record<Okruh, number> = { fpuo: 0, svc: 0 };
  for (const r of [...assessmentTotals].sort(
    (a, b) => a.year - b.year || a.month - b.month
  )) {
    const pool = poolKey(r.okruh);
    predpisByPoolYm.set(`${pool}:${r.year}-${r.month}`, r.total);
    lastPredpisByPool[pool] = r.total;
  }

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

  // Recurring commitments (AC 486): latest recurring invoice per
  // (supplier, category), summed per okruh — a modeled monthly outflow.
  const recurringRows = await db
    .select({
      okruh: expenses.okruh,
      supplierName: expenses.supplierName,
      serviceCategoryId: expenses.serviceCategoryId,
      amountCents: expenses.amountCents,
      invoiceDate: expenses.invoiceDate,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.entityId, entityId),
        eq(expenses.isRecurring, true),
        isNull(expenses.voidedAt)
      )
    )
    .orderBy(sql`${expenses.invoiceDate} desc`);
  const recurringSeen = new Set<string>();
  const recurringByPool: Record<Okruh, number> = { fpuo: 0, svc: 0 };
  for (const r of recurringRows) {
    const key = `${r.supplierName}|${r.serviceCategoryId ?? ""}`;
    if (recurringSeen.has(key)) continue; // newest per commitment wins
    recurringSeen.add(key);
    recurringByPool[poolKey(r.okruh)] += r.amountCents;
  }

  // Variable outflow: average of NON-recurring expenses over the covered
  // history (divided by covered months, min 1 — a hard 6 would understate a
  // fresh dom's burn), split by okruh.
  const sixMonthsAgo = new Date(now.getTime() - 182 * 24 * 3600 * 1000);
  const variableRows = await db
    .select({
      okruh: expenses.okruh,
      total: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int`,
      earliest: sql<string | null>`min(${expenses.invoiceDate})::text`,
    })
    .from(expenses)
    .where(
      and(
        eq(expenses.entityId, entityId),
        eq(expenses.isRecurring, false),
        isNull(expenses.voidedAt),
        gte(expenses.invoiceDate, sixMonthsAgo)
      )
    )
    .groupBy(expenses.okruh);
  const coveredMonths = (earliest: string | null): number =>
    earliest
      ? Math.min(
          6,
          Math.max(
            1,
            Math.ceil(
              (now.getTime() - new Date(earliest).getTime()) /
                (30 * 24 * 3600 * 1000)
            )
          )
        )
      : 6;
  const variableByPool: Record<Okruh, number> = { fpuo: 0, svc: 0 };
  for (const r of variableRows) {
    variableByPool[poolKey(r.okruh)] = Math.round(
      r.total / coveredMonths(r.earliest)
    );
  }

  // Build the shared month calendar, then per-pool inputs.
  const calendar: { year: number; month: number }[] = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;
  for (let i = 0; i < HORIZON_MONTHS; i++) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    calendar.push({ year, month });
  }

  const pools = POOLS.map((pool) => {
    const monthlyOutflow = recurringByPool[pool] + variableByPool[pool];
    const months: ProjectionMonthInput[] = calendar.map(({ year, month }) => {
      const known = predpisByPoolYm.get(`${pool}:${year}-${month}`);
      return {
        year,
        month,
        predpisCents: known ?? lastPredpisByPool[pool],
        expenseCents: monthlyOutflow,
        estimated: known === undefined,
      };
    });
    return { pool, openingCents: openingByPool[pool], months };
  });

  return projectPools({
    collectionRate: collectionRateFrom(due?.total ?? 0, paid?.total ?? 0),
    pools,
  });
}
