import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import {
  accounts,
  accountingPeriods,
  journalEntries,
  journalLines,
  serviceCategories,
} from "../db/schema";

// Pohľad účtovníka (BYT-20260512-002 Phase 8) — the ONLY surface where
// debit/credit terminology appears (spec UX guardrail: hidden everywhere
// else, revealed on demand for audit/accountant review). Strictly
// read-only: the journal is append-only by construction and this view
// adds no mutation path.

type Country = "sk" | "cz";

export interface TrialBalanceRow {
  code: string;
  name: string;
  kind: string;
  debitCents: number;
  creditCents: number;
  /** Dr − Cr (assets/expenses positive; liabilities/equity negative). */
  balanceCents: number;
}

export async function getTrialBalance(
  entityId: string,
  country: Country
): Promise<TrialBalanceRow[]> {
  const rows = await db
    .select({
      code: accounts.code,
      name: accounts.name,
      kind: accounts.kind,
      debitCents: sql<number>`coalesce(sum(${journalLines.debitCents}), 0)::int`,
      creditCents: sql<number>`coalesce(sum(${journalLines.creditCents}), 0)::int`,
    })
    .from(accounts)
    .leftJoin(
      journalLines,
      and(
        eq(journalLines.accountId, accounts.id),
        sql`${journalLines.journalEntryId} in (
          select id from ${journalEntries}
          where ${journalEntries.entityId} = ${entityId}
        )`
      )
    )
    .where(eq(accounts.country, country))
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.kind)
    .orderBy(accounts.code);

  return rows.map((r) => ({
    ...r,
    balanceCents: r.debitCents - r.creditCents,
  }));
}

// ── Year-scoped trial balance (obratová predvaha za rok) ─

export interface TrialBalanceYearRow {
  code: string;
  name: string;
  kind: string;
  /** Počiatočný stav: Dr − Cr of every posting in EARLIER accounting years. */
  openingCents: number;
  /** Obraty MD / D within the selected accounting year. */
  debitCents: number;
  creditCents: number;
  /** Konečný stav = opening + debit − credit (Dr − Cr sign convention). */
  closingCents: number;
}

export interface TrialBalanceYear {
  year: number;
  rows: TrialBalanceYearRow[];
  totals: {
    openingDebitCents: number;
    openingCreditCents: number;
    debitCents: number;
    creditCents: number;
    closingDebitCents: number;
    closingCreditCents: number;
  };
}

/** Accounting years (periods) of the dom, newest first. */
export async function listAccountingYears(entityId: string): Promise<number[]> {
  const rows = await db
    .select({ year: accountingPeriods.year })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.entityId, entityId))
    .orderBy(desc(accountingPeriods.year));
  return [...new Set(rows.map((r) => r.year))];
}

/**
 * Trial balance for ONE accounting year: opening (cumulative Dr − Cr of all
 * earlier years), turnover of the year, closing. Years key on the posting's
 * accounting PERIOD (not the calendar date), so a correction posted into an
 * open period lands in that period's year.
 *
 * Opening is carried for every account, P&L included: in this chart the
 * services costs (5xx) are cleared against 478 by the annual vyúčtovanie,
 * so an unsettled cost legitimately carries forward. Because each entry
 * balances, Σ opening Dr = Σ opening Cr and the closing column reconciles
 * — the totals row proves it.
 */
export async function getTrialBalanceForYear(
  entityId: string,
  country: Country,
  year: number
): Promise<TrialBalanceYear> {
  const rows = await db
    .select({
      code: accounts.code,
      name: accounts.name,
      kind: accounts.kind,
      openingCents: sql<number>`coalesce(sum(case when ${accountingPeriods.year} < ${year} then ${journalLines.debitCents} - ${journalLines.creditCents} else 0 end), 0)::int`,
      debitCents: sql<number>`coalesce(sum(case when ${accountingPeriods.year} = ${year} then ${journalLines.debitCents} else 0 end), 0)::int`,
      creditCents: sql<number>`coalesce(sum(case when ${accountingPeriods.year} = ${year} then ${journalLines.creditCents} else 0 end), 0)::int`,
    })
    .from(accounts)
    // Lines restricted IN the join condition (this dom, periods up to the
    // year) so accounts without postings still appear with zeros.
    .leftJoin(
      journalLines,
      and(
        eq(journalLines.accountId, accounts.id),
        sql`${journalLines.journalEntryId} in (
          select je.id from ${journalEntries} je
          join ${accountingPeriods} ap on ap.id = je.period_id
          where je.entity_id = ${entityId} and ap.year <= ${year}
        )`
      )
    )
    .leftJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .leftJoin(
      accountingPeriods,
      eq(journalEntries.periodId, accountingPeriods.id)
    )
    .where(eq(accounts.country, country))
    .groupBy(accounts.id, accounts.code, accounts.name, accounts.kind)
    .orderBy(accounts.code);

  const out: TrialBalanceYearRow[] = rows.map((r) => ({
    ...r,
    closingCents: r.openingCents + r.debitCents - r.creditCents,
  }));
  const pos = (v: number) => (v > 0 ? v : 0);
  const neg = (v: number) => (v < 0 ? -v : 0);
  return {
    year,
    rows: out,
    totals: {
      openingDebitCents: out.reduce((s, r) => s + pos(r.openingCents), 0),
      openingCreditCents: out.reduce((s, r) => s + neg(r.openingCents), 0),
      debitCents: out.reduce((s, r) => s + r.debitCents, 0),
      creditCents: out.reduce((s, r) => s + r.creditCents, 0),
      closingDebitCents: out.reduce((s, r) => s + pos(r.closingCents), 0),
      closingCreditCents: out.reduce((s, r) => s + neg(r.closingCents), 0),
    },
  };
}

export interface JournalLineView {
  accountCode: string;
  accountName: string;
  debitCents: number;
  creditCents: number;
  okruh: string;
  unitLabel: string | null;
  categorySlug: string | null;
}

export interface JournalEntryView {
  id: string;
  postedAt: string;
  description: string;
  sourceType: string;
  periodYear: number;
  lines: JournalLineView[];
}

export interface JournalPage {
  entries: JournalEntryView[];
  total: number;
}

const PAGE_SIZE = 50;

export async function listJournal(
  entityId: string,
  page = 0
): Promise<JournalPage> {
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(journalEntries)
    .where(eq(journalEntries.entityId, entityId));

  const entries = await db
    .select({
      id: journalEntries.id,
      postedAt: journalEntries.postedAt,
      createdAt: journalEntries.createdAt,
      description: journalEntries.description,
      sourceType: journalEntries.sourceType,
      periodYear: accountingPeriods.year,
    })
    .from(journalEntries)
    .innerJoin(
      accountingPeriods,
      eq(journalEntries.periodId, accountingPeriods.id)
    )
    .where(eq(journalEntries.entityId, entityId))
    .orderBy(desc(journalEntries.postedAt), desc(journalEntries.createdAt))
    .limit(PAGE_SIZE)
    .offset(page * PAGE_SIZE);

  if (entries.length === 0) return { entries: [], total };

  const lines = await db
    .select({
      journalEntryId: journalLines.journalEntryId,
      accountCode: accounts.code,
      accountName: accounts.name,
      debitCents: journalLines.debitCents,
      creditCents: journalLines.creditCents,
      okruh: journalLines.okruh,
      unitLabel: sql<string | null>`coalesce(${entities.data}->>'flat_number', ${entities.name})`,
      categorySlug: serviceCategories.slug,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .leftJoin(entities, eq(journalLines.unitEntityId, entities.id))
    .leftJoin(
      serviceCategories,
      eq(journalLines.serviceCategoryId, serviceCategories.id)
    )
    .where(
      inArray(
        journalLines.journalEntryId,
        entries.map((e) => e.id)
      )
    )
    .orderBy(desc(journalLines.debitCents));

  const linesByEntry = new Map<string, JournalLineView[]>();
  for (const line of lines) {
    const list = linesByEntry.get(line.journalEntryId) ?? [];
    list.push({
      accountCode: line.accountCode,
      accountName: line.accountName,
      debitCents: line.debitCents,
      creditCents: line.creditCents,
      okruh: line.okruh,
      unitLabel: line.unitLabel,
      categorySlug: line.categorySlug,
    });
    linesByEntry.set(line.journalEntryId, list);
  }

  return {
    entries: entries.map((e) => ({
      id: e.id,
      postedAt: e.postedAt.toISOString(),
      description: e.description,
      sourceType: e.sourceType,
      periodYear: e.periodYear,
      lines: linesByEntry.get(e.id) ?? [],
    })),
    total,
  };
}
