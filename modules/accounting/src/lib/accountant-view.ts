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
