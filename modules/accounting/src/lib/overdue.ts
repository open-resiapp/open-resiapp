import "server-only";

import { and, eq, inArray, max } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountingSettings,
  interestRateHistory,
  journalEntries,
  journalLines,
  settlements,
  settlementUnits,
  unitSettings,
} from "../db/schema";
import { sql } from "drizzle-orm";
import { computeInterest } from "../sanctions/interest";
import { ACCOUNT_CODES } from "../seeds/coa-sk";
import {
  loadRateHistory,
  seriesForCountry,
  type RateSeries,
} from "./rate-history";
import { openReceivablesForUnit, type OpenReceivable } from "./payments";
import { listDomUnits } from "./dom-units";
import { listUnitBalances } from "./karta-bytu";
import { boardMembers, memberships, users } from "@/db/schema";
import { payBySquareString } from "../qr/pay-by-square";
import { periodInScope, type OwnershipWindow } from "./ownership-windows";

// Overdue receivables + lawful interest (BYT-20260512-002 Phase 5
// surface). READ-ONLY calculator per spec decision — nothing posts; the
// chairman decides if/when interest is ever booked or claimed.
//
// Due-date rule (decision 2026-07-05, configurable):
//   - monthly assessment: due on settings.dueDay of ITS month (1–28), or
//     the LAST day of the month when unset (common SK default)
//   - settlement nedoplatok: due 30 days after publishing (mirrors the
//     PDF poučenie "spravidla do 30 dní od doručenia")
// Delay starts the day after the due date (engine rule).
//
// Parked preplatok (Cr 379 on the unit) is netted VIRTUALLY before any
// overdue/interest figure is produced: the credit covers the OLDEST due
// items first (FIFO by due date), nothing posts. Without this an owner
// with a 300 € credit and a 100 € unpaid month would get an upomienka and
// interest although his net position is −200 €. The karta balance and the
// debtor list are already net (they sum 311 + 379), so all three agree.
// Simplification (favours the owner): the credit is treated as available
// from the item's due date even when it arrived later.
//
// Rate freshness: the interest rate is the central-bank rate valid on the
// first day of delay (SK nar. vlády 87/1995 Z.z. §3 — ECB MRO + 5 p.b.;
// CZ nař. vlády 351/2013 Sb. §2 — ČNB repo + 8 p.b.). The rate table is
// trusted when the rate-sync cron re-confirmed the series within one ECB
// monetary-policy cycle (~6 weeks); otherwise the UI shows "check rates".

type Country = "sk" | "cz";

function lastDayOfMonth(year: number, month: number): Date {
  // Day 0 of the next month = last day of this month.
  return new Date(Date.UTC(year, month, 0));
}

function assessmentDueDate(
  item: OpenReceivable,
  dueDay: number | null
): Date {
  if (dueDay === null) return lastDayOfMonth(item.periodYear, item.month);
  return new Date(Date.UTC(item.periodYear, item.month - 1, dueDay));
}

export interface OverdueItem {
  id: string;
  kind: "assessment" | "settlement";
  categorySlug: string;
  periodYear: number;
  month: number;
  openCents: number;
  dueDate: string;
  daysLate: number;
  ratePct: number;
  interestCents: number;
}

export interface OverdueSummary {
  asOf: string;
  items: OverdueItem[];
  totalOpenCents: number;
  totalInterestCents: number;
  /** Parked preplatok netted against the oldest items (virtual, not posted). */
  creditAppliedCents: number;
  /**
   * True when the rate table was not re-confirmed by the rate-sync job
   * within RATE_FRESH_DAYS (or never) — surface the "check rates" caveat.
   */
  ratesUnverified: boolean;
  /** Last time the rate series was confirmed against the bank source. */
  ratesCheckedAt: string | null;
}

/** One ECB monetary-policy cycle (6 weeks) plus a week of slack. */
export const RATE_FRESH_DAYS = 49;

async function rateFreshness(
  series: RateSeries,
  now: Date
): Promise<{ unverified: boolean; checkedAt: string | null }> {
  const [row] = await db
    .select({ last: max(interestRateHistory.fetchedAt) })
    .from(interestRateHistory)
    .where(eq(interestRateHistory.series, series));
  // max() over a timestamp may come back as a string from the driver.
  const last = row?.last ? new Date(row.last) : null;
  if (!last) return { unverified: true, checkedAt: null };
  const ageDays = (now.getTime() - last.getTime()) / 86_400_000;
  return {
    unverified: ageDays > RATE_FRESH_DAYS,
    checkedAt: last.toISOString().slice(0, 10),
  };
}

/**
 * Parked preplatok of a unit — credit balance on 379 attributed to it
 * (positive = credit available). Same derivation as karta-bytu.
 */
export async function parkedCreditForUnit(
  entityId: string,
  country: Country,
  unitEntityId: string
): Promise<number> {
  const [row] = await db
    .select({
      credit: sql<number>`coalesce(sum(${journalLines.creditCents} - ${journalLines.debitCents}), 0)::int`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .where(
      and(
        eq(journalEntries.entityId, entityId),
        eq(journalLines.unitEntityId, unitEntityId),
        eq(accounts.country, country),
        eq(accounts.code, ACCOUNT_CODES.INE_ZAVAZKY)
      )
    );
  return Math.max(0, row?.credit ?? 0);
}

/**
 * Pure: nets `creditCents` against items oldest-due-first. Returns the
 * reduced items (fully covered ones dropped) and the credit consumed.
 */
export function netCreditAgainstItems<
  T extends { openCents: number; dueDate: Date },
>(items: T[], creditCents: number): { items: T[]; appliedCents: number } {
  let left = Math.max(0, creditCents);
  const sorted = [...items].sort(
    (a, b) => a.dueDate.getTime() - b.dueDate.getTime()
  );
  const out: T[] = [];
  for (const item of sorted) {
    const take = Math.min(left, item.openCents);
    left -= take;
    if (item.openCents - take > 0) {
      out.push({ ...item, openCents: item.openCents - take });
    }
  }
  return { items: out, appliedCents: Math.max(0, creditCents) - left };
}

/**
 * The summary limited to the viewer's ownership windows (items of their
 * own months / settlement years, totals recomputed). undefined = full.
 */
export function scopeOverdue(
  summary: OverdueSummary,
  windows: OwnershipWindow[] | undefined
): OverdueSummary {
  if (!windows) return summary;
  const items = summary.items.filter((i) => periodInScope(i, windows));
  return {
    ...summary,
    items,
    totalOpenCents: items.reduce((s, i) => s + i.openCents, 0),
    totalInterestCents: items.reduce((s, i) => s + i.interestCents, 0),
  };
}

/** Days the owner gets to pay after the upomienka date (lehota na úhradu). */
export const UPOMIENKA_PAYMENT_DAYS = 15;

export interface UpomienkaPdfData extends OverdueSummary {
  unitEntityId: string;
  unitLabel: string;
  /** Addressee — active owners of the unit (co-ownership → several). */
  ownerNames: string[];
  /** Pay-by date printed in the letter: asOf + UPOMIENKA_PAYMENT_DAYS. */
  paymentDueDate: string;
  /** Who signs: the active chairman (predseda); null = blank line. */
  signatory: { name: string; role: "chairman" } | null;
  vs: string | null;
  iban: string | null;
  /** Dynamic PAY by square for open + interest; null when unavailable. */
  payBySquare: string | null;
  /** SK-only template (statutory citations) — the endpoint enforces it. */
  country: "sk";
}

/**
 * Everything the upomienka PDF needs. SK-only — the statutory citations
 * (nariadenie 87/1995, §517 OZ) belong to the SK template; the CZ
 * upomínka (nař. 351/2013) ships with Phase 6 (template-aware rule).
 */
export async function getUpomienkaPdfData(input: {
  entityId: string;
  country: Country;
  unitEntityId: string;
  beneficiaryName: string;
  now?: Date;
}): Promise<UpomienkaPdfData> {
  if (input.country !== "sk") {
    throw new Error(
      "accounting: the CZ upomínka template ships with Phase 6 — SK template must not serve other countries"
    );
  }
  const summary = await getOverdueForUnit(input);
  if (summary.items.length === 0) {
    throw new Error("accounting: nothing overdue for the unit");
  }
  // Net position must be a debt (311 + 379 net — same figure as the karta
  // and the debtor list). A credit elsewhere on the unit wins.
  const balances = await listUnitBalances(input.entityId, input.country, [
    input.unitEntityId,
  ]);
  if ((balances.get(input.unitEntityId) ?? 0) <= 0) {
    throw new Error("accounting: nothing overdue for the unit");
  }

  const units = await listDomUnits(input.entityId);
  const unit = units.find((u) => u.id === input.unitEntityId);
  if (!unit) throw new Error("accounting: unknown unit");

  const [ownerNames, signatory] = await Promise.all([
    activeOwnerNames(input.unitEntityId),
    chairmanSignatory(input.entityId),
  ]);

  const [vsRow] = await db
    .select({ vs: unitSettings.vs })
    .from(unitSettings)
    .where(eq(unitSettings.unitEntityId, input.unitEntityId));

  const [settingsRow] = await db
    .select({ bankIban: accountingSettings.bankIban })
    .from(accountingSettings)
    .where(
      and(
        eq(accountingSettings.entityId, input.entityId),
        sql`${accountingSettings.effectiveFrom} <= now()`
      )
    )
    .orderBy(sql`${accountingSettings.effectiveFrom} desc`)
    .limit(1);
  const iban = settingsRow?.bankIban ?? null;

  const totalDue = summary.totalOpenCents + summary.totalInterestCents;
  const payBySquare =
    iban && vsRow?.vs && totalDue > 0
      ? payBySquareString({
          iban,
          amountCents: totalDue,
          vs: vsRow.vs,
          beneficiaryName: input.beneficiaryName,
          note: `Upomienka ${summary.asOf}`,
        })
      : null;

  const asOfDate = new Date(`${summary.asOf}T00:00:00Z`);
  const paymentDueDate = new Date(
    asOfDate.getTime() + UPOMIENKA_PAYMENT_DAYS * 86_400_000
  )
    .toISOString()
    .slice(0, 10);

  return {
    ...summary,
    unitEntityId: input.unitEntityId,
    unitLabel: unit.flatNumber ?? unit.name,
    ownerNames,
    paymentDueDate,
    signatory,
    vs: vsRow?.vs ?? null,
    iban,
    payBySquare,
    country: "sk",
  };
}

async function activeOwnerNames(unitEntityId: string): Promise<string[]> {
  const rows = await db
    .select({ name: users.name })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        eq(memberships.entityId, unitEntityId),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active")
      )
    );
  return rows.map((r) => r.name).filter(Boolean);
}

async function chairmanSignatory(
  entityId: string
): Promise<UpomienkaPdfData["signatory"]> {
  const [row] = await db
    .select({ name: users.name })
    .from(boardMembers)
    .innerJoin(users, eq(boardMembers.userId, users.id))
    .where(
      and(
        eq(boardMembers.entityId, entityId),
        eq(boardMembers.isActive, true),
        eq(boardMembers.role, "chairman")
      )
    )
    .limit(1);
  return row?.name ? { name: row.name, role: "chairman" } : null;
}

/**
 * Bulk "upomienky pre všetkých dlžníkov": one data set per unit whose NET
 * balance is a debt AND has overdue items after netting the preplatok.
 * Units that fail (no VS etc.) are skipped, never abort the batch.
 */
export async function getUpomienkyForAllDebtors(input: {
  entityId: string;
  country: Country;
  beneficiaryName: string;
  now?: Date;
}): Promise<UpomienkaPdfData[]> {
  if (input.country !== "sk") {
    throw new Error(
      "accounting: the CZ upomínka template ships with Phase 6 — SK template must not serve other countries"
    );
  }
  const units = await listDomUnits(input.entityId);
  const balances = await listUnitBalances(
    input.entityId,
    input.country,
    units.map((u) => u.id)
  );
  const debtorIds = units
    .filter((u) => (balances.get(u.id) ?? 0) > 0)
    .map((u) => u.id);
  const out: UpomienkaPdfData[] = [];
  // Sequential on purpose: a board action over ≤ a few hundred flats;
  // keeps DB load flat instead of fanning out N parallel transactions.
  for (const unitEntityId of debtorIds) {
    try {
      out.push(
        await getUpomienkaPdfData({ ...input, unitEntityId })
      );
    } catch {
      // nothing overdue after netting / unknown unit → no letter
    }
  }
  return out;
}

export async function getOverdueForUnit(input: {
  entityId: string;
  country: Country;
  unitEntityId: string;
  now?: Date;
}): Promise<OverdueSummary> {
  const now = input.now ?? new Date();

  const open = await db.transaction((tx) =>
    openReceivablesForUnit(tx, input.unitEntityId)
  );

  const [settingsRow] = await db
    .select({ dueDay: accountingSettings.dueDay })
    .from(accountingSettings)
    .where(
      and(
        eq(accountingSettings.entityId, input.entityId),
        sql`${accountingSettings.effectiveFrom} <= now()`
      )
    )
    .orderBy(sql`${accountingSettings.effectiveFrom} desc`)
    .limit(1);
  const dueDay = settingsRow?.dueDay ?? null;

  // Settlement receivables anchor to their publish date + 30 days.
  const settlementIds = open
    .filter((o) => o.kind === "settlement")
    .map((o) => o.id);
  const publishedById = new Map<string, Date>();
  if (settlementIds.length > 0) {
    const rows = await db
      .select({
        id: settlementUnits.id,
        publishedAt: settlements.publishedAt,
      })
      .from(settlementUnits)
      .innerJoin(
        settlements,
        eq(settlementUnits.settlementId, settlements.id)
      )
      .where(inArray(settlementUnits.id, settlementIds));
    for (const row of rows) publishedById.set(row.id, row.publishedAt);
  }

  const gross = open.map((item) => ({
    item,
    openCents: item.openCents,
    dueDate:
      item.kind === "settlement"
        ? new Date(
            (publishedById.get(item.id)?.getTime() ?? now.getTime()) +
              30 * 24 * 3600 * 1000
          )
        : assessmentDueDate(item, dueDay),
  }));

  // Net the parked preplatok against the OVERDUE items only (oldest first)
  // — a credit must not be "spent" on a month that is not due yet.
  const credit = await parkedCreditForUnit(
    input.entityId,
    input.country,
    input.unitEntityId
  );
  const overdueGross = gross.filter((g) => g.dueDate.getTime() < now.getTime());
  const notYetDue = gross.filter((g) => g.dueDate.getTime() >= now.getTime());
  const netted = netCreditAgainstItems(overdueGross, credit);
  const withDue = [...netted.items, ...notYetDue];
  const series = seriesForCountry(input.country);
  const freshness = await rateFreshness(series, now);

  const { lines } = computeInterest({
    country: input.country,
    history: await loadRateHistory(series),
    items: withDue.map(({ item, openCents, dueDate }) => ({
      id: item.id,
      amountCents: openCents,
      dueDate,
    })),
    asOf: now,
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const items: OverdueItem[] = withDue
    .map(({ item, openCents, dueDate }) => {
      const line = lineById.get(item.id)!;
      return {
        id: item.id,
        kind: item.kind,
        categorySlug: item.categorySlug,
        periodYear: item.periodYear,
        month: item.month,
        openCents,
        dueDate: dueDate.toISOString().slice(0, 10),
        daysLate: line.days,
        ratePct: line.ratePct,
        interestCents: line.interestCents,
      };
    })
    .filter((i) => i.daysLate > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    asOf: now.toISOString().slice(0, 10),
    items,
    totalOpenCents: items.reduce((s, i) => s + i.openCents, 0),
    totalInterestCents: items.reduce((s, i) => s + i.interestCents, 0),
    creditAppliedCents: netted.appliedCents,
    ratesUnverified: freshness.unverified,
    ratesCheckedAt: freshness.checkedAt,
  };
}
