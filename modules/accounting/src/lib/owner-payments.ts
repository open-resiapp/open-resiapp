import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships } from "@/db/schema";
import { ACCOUNT_CODES } from "../seeds/coa-sk";
import { accountingPeriods, feeAssessments, feeSchedules } from "../db/schema";
import { domUnitsWhere } from "./dom-units";
import { postAllDueMonths } from "./fee-schedule-publish";
import { getUnitLedger, listUnitBalances } from "./karta-bytu";
import { getOverdueForUnit } from "./overdue";
import { getPredpisPdfData } from "./predpis-pdf-data";
import { getVyuctovaniePdfData, listSettlementYearsForUnit } from "./vyuctovanie";

// Owner self-service read model ("Moje platby", home balance card —
// BYT-20261117-002 Phase 4). A thin composition of the SAME lib functions
// the karta bytu API uses (ledger, overdue, predpis, vyúčtovanie). No
// balance math lives here — every number comes from those functions
// (invariant 11: derived from postings, never stored). Authorisation is
// the caller's job (canReadUnitLedger / listOwnedUnits).

type Country = "sk" | "cz";

export interface OwnedUnit {
  id: string;
  name: string;
  flatNumber: string | null;
}

/** Today as YYYY-MM-DD (UTC) — membership validity dates are plain dates. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Units the user OWNS TODAY: active owner membership whose validity window
 * [valid_from, valid_to) contains today (BYT-20261118-007). A buyer with a
 * future valid_from is not an owner yet; a seller whose valid_to passed is
 * not one any more. Used by the home balance card and self-readings — both
 * are about the current owner only.
 */
export async function listOwnedUnits(
  userId: string,
  entityId: string
): Promise<OwnedUnit[]> {
  const today = todayIso();
  return db
    .selectDistinct({
      id: entities.id,
      name: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
    })
    .from(entities)
    .innerJoin(memberships, eq(memberships.entityId, entities.id))
    .where(
      and(
        domUnitsWhere(entityId),
        eq(memberships.userId, userId),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active"),
        sql`${memberships.validFrom} <= ${today}::date`,
        sql`(${memberships.validTo} IS NULL OR ${memberships.validTo} > ${today}::date)`
      )
    )
    .orderBy(asc(entities.name));
}

/** [from, to) in YYYY-MM-DD; to = null → still the owner. */
export interface OwnershipWindow {
  from: string;
  to: string | null;
}

export interface OwnedUnitWithWindows extends OwnedUnit {
  windows: OwnershipWindow[];
  /** Owner today (a window contains today). */
  current: boolean;
}

/**
 * Every unit the user owns or OWNED (current + ended owner memberships),
 * with the ownership windows. "Moje platby" shows each person only the
 * money of their own ownership period: the buyer does not see the seller's
 * history, the seller keeps access to their own after the sale.
 * Current units first, then former ones; by name within each group.
 */
export async function listOwnershipWindows(
  userId: string,
  entityId: string
): Promise<OwnedUnitWithWindows[]> {
  const today = todayIso();
  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      validFrom: memberships.validFrom,
      validTo: memberships.validTo,
    })
    .from(entities)
    .innerJoin(memberships, eq(memberships.entityId, entities.id))
    .where(
      and(
        domUnitsWhere(entityId),
        eq(memberships.userId, userId),
        eq(memberships.role, "owner"),
        inArray(memberships.status, ["active", "archived"]),
        // A future ownership is not visible yet.
        sql`${memberships.validFrom} <= ${today}::date`
      )
    )
    .orderBy(asc(entities.name), asc(memberships.validFrom));

  const byUnit = new Map<string, OwnedUnitWithWindows>();
  for (const r of rows) {
    // Zero-length windows (corrections ending on the start day) own nothing.
    if (r.validTo !== null && r.validTo <= r.validFrom) continue;
    let unit = byUnit.get(r.id);
    if (!unit) {
      unit = { id: r.id, name: r.name, flatNumber: r.flatNumber, windows: [], current: false };
      byUnit.set(r.id, unit);
    }
    unit.windows.push({ from: r.validFrom, to: r.validTo });
    if (inWindows(today, [{ from: r.validFrom, to: r.validTo }])) unit.current = true;
  }
  const units = [...byUnit.values()];
  return [...units.filter((u) => u.current), ...units.filter((u) => !u.current)];
}

/** Is the day (YYYY-MM-DD) inside any [from, to) window? */
function inWindows(day: string, windows: OwnershipWindow[]): boolean {
  return windows.some((w) => w.from <= day && (w.to === null || day < w.to));
}

/** Does calendar year `year` overlap any window? */
function yearInWindows(year: number, windows: OwnershipWindow[]): boolean {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  return windows.some((w) => w.from <= last && (w.to === null || w.to > first));
}

/**
 * Posts every due month before a balance is shown — same lazy posting the
 * karta API runs on read (invariant 7: a balance never lags the calendar).
 * Only call it for a user with at least one readable unit.
 *
 * Called on every owner home / Moje platby / board home render, so the
 * common case (nothing due) must stay read-only: a single indexed SELECT
 * outside any transaction decides whether postAllDueMonths (transaction +
 * FOR UPDATE on the open periods) runs at all. The pre-check is the exact
 * predicate postAllDueMonths acts on — published schedule of the dom, open
 * period, assessment without journal entry, month <= lastDueMonth(year) —
 * so it can only skip a call that would have posted nothing. Replica-safe:
 * a racing writer either commits before our snapshot (we see the posted
 * rows and skip) or after it (we see unposted rows, take the lock and
 * postAllDueMonths re-checks under it — still idempotent).
 */
export async function syncDuePostings(entityId: string, country: Country): Promise<void> {
  const now = new Date();
  if (!(await hasDueUnpostedAssessments(entityId, now))) return;
  await db.transaction(async (tx) => {
    // A page render must never queue behind a long money transaction
    // (import, publish, year close) on the same dom. Give up after 2 s;
    // callers render the balance without the fresh postings and the next
    // render retries. SET LOCAL ends with this transaction.
    await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
    await postAllDueMonths(tx, { entityId, country, now });
  });
}

/** Read-only: does postAllDueMonths(entityId, now) have anything to post? */
async function hasDueUnpostedAssessments(entityId: string, now: Date): Promise<boolean> {
  // Same calendar as lastDueMonth() in fee-schedule-publish.ts (UTC):
  // past years fully due, current year up to the current month, future none.
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const [row] = await db
    .select({ id: feeAssessments.id })
    .from(feeAssessments)
    .innerJoin(feeSchedules, eq(feeSchedules.id, feeAssessments.scheduleId))
    .innerJoin(accountingPeriods, eq(accountingPeriods.id, feeSchedules.periodId))
    .where(
      and(
        eq(feeSchedules.entityId, entityId),
        eq(feeSchedules.status, "published"),
        eq(accountingPeriods.status, "open"),
        isNull(feeAssessments.journalEntryId),
        sql`(${accountingPeriods.year} < ${year} OR (${accountingPeriods.year} = ${year} AND ${feeAssessments.month} <= ${month}))`
      )
    )
    .limit(1);
  return Boolean(row);
}

export interface UnitBalanceLine {
  unitEntityId: string;
  label: string;
  /** Positive = owner owes, negative = overpaid (domain sign convention). */
  balanceCents: number;
}

/** One balance per unit via the karta list aggregate (listUnitBalances). */
export async function getUnitBalanceLines(
  entityId: string,
  country: Country,
  units: OwnedUnit[]
): Promise<UnitBalanceLine[]> {
  const balances = await listUnitBalances(
    entityId,
    country,
    units.map((u) => u.id)
  );
  return units.map((u) => ({
    unitEntityId: u.id,
    label: u.flatNumber ?? u.name,
    balanceCents: balances.get(u.id) ?? 0,
  }));
}

export interface OwnerPaymentSummary {
  unitEntityId: string;
  label: string;
  vs: string | null;
  balanceCents: number;
  /** Parked preplatok on 379 (positive = credit available). */
  preplatokCents: number;
  /** Newest first, max 3 — payment-sourced ledger rows that reduced debt. */
  lastPayments: { journalEntryId: string; postedAt: string; amountCents: number }[];
  /** Current month's predpis; null when not published / no VS / no IBAN. */
  monthly: {
    totalCents: number;
    iban: string;
    vs: string;
    year: number;
    month: number;
    /** PAY by square (SK) or SPAYD (CZ) payload. */
    qrPayload: string | null;
  } | null;
  /** Years with a published settlement, newest first. */
  settlementYears: number[];
  /**
   * Latest published settlement. `differenceCents` > 0 = doplatok,
   * < 0 = preplatok; null when the PDF template does not serve the country.
   */
  latestSettlement: { year: number; differenceCents: number | null } | null;
  /**
   * `creditAppliedCents`: parked preplatok already netted against the
   * oldest overdue items (overdue.ts, virtual — not posted). > 0 means the
   * open total is already net of it.
   */
  overdue: { totalOpenCents: number; months: number; creditAppliedCents: number };
  // Meter / persons self-reading lives in the reading-round view
  // (reading-rounds.ts getOwnerReadingsView, BYT-20261118-006): visibility
  // follows an OPEN round, not historic readings.
}

export async function getOwnerPaymentSummary(input: {
  entityId: string;
  country: Country;
  unitEntityId: string;
  beneficiaryName: string;
  /**
   * The viewer's ownership windows on this unit. When given, every row
   * (charges, payments, settlements, overdue months) is limited to them and
   * the balance is the sum of the viewer's own rows; the payment
   * instruction (predpis / QR) shows only to a current owner. Omit for a
   * whole-dom reader (board) viewing the full unit history.
   */
  windows?: OwnershipWindow[];
}): Promise<OwnerPaymentSummary | null> {
  const { entityId, country, unitEntityId, beneficiaryName, windows } = input;

  const [ledger, predpis, settlementYears, overdue] = await Promise.all([
    getUnitLedger(entityId, unitEntityId, country),
    // Throws on "no published predpis / no VS / no IBAN" — expected
    // states for an owner, rendered as "not available".
    getPredpisPdfData({ entityId, country, unitEntityId, beneficiaryName }).catch(
      () => null
    ),
    listSettlementYearsForUnit(entityId, unitEntityId),
    getOverdueForUnit({ entityId, country, unitEntityId }).catch(() => null),
  ]);
  if (!ledger) return null;

  const isCurrent = windows ? inWindows(todayIso(), windows) : true;
  const ledgerRows = windows
    ? ledger.rows.filter((r) => inWindows(r.postedAt.slice(0, 10), windows))
    : ledger.rows;
  // Balance + parked preplatok of the viewer's own period, derived from the
  // same ledger rows (debit − credit; 379 credit = preplatok).
  const balanceCents = windows
    ? ledgerRows.reduce((sum, r) => sum + r.deltaCents, 0)
    : ledger.balanceCents;
  const preplatokCents = windows
    ? ledgerRows.reduce(
        (sum, r) =>
          sum +
          r.lines
            .filter((l) => l.accountCode === ACCOUNT_CODES.INE_ZAVAZKY)
            .reduce((s, l) => s - l.deltaCents, 0),
        0
      )
    : ledger.preplatokCents;
  const visibleSettlementYears = windows
    ? settlementYears.filter((y) => yearInWindows(y, windows))
    : settlementYears;
  const overdueItems = overdue
    ? windows
      ? overdue.items.filter((i) =>
          i.kind === "settlement"
            ? yearInWindows(i.periodYear, windows)
            : inWindows(`${i.periodYear}-${String(i.month).padStart(2, "0")}-01`, windows)
        )
      : overdue.items
    : [];

  let latestSettlement: OwnerPaymentSummary["latestSettlement"] = null;
  if (visibleSettlementYears.length > 0) {
    const year = visibleSettlementYears[0];
    const pdf = await getVyuctovaniePdfData({
      entityId,
      country,
      unitEntityId,
      year,
      beneficiaryName,
    }).catch(() => null);
    latestSettlement = { year, differenceCents: pdf ? pdf.totalDifferenceCents : null };
  }

  const lastPayments = ledgerRows
    .filter((r) => r.sourceType === "payment" && r.deltaCents < 0)
    .slice(-3)
    .reverse()
    .map((r) => ({
      journalEntryId: r.journalEntryId,
      postedAt: r.postedAt,
      amountCents: -r.deltaCents,
    }));

  const overdueMonths = new Set(
    overdueItems.map((i) => `${i.periodYear}-${i.month}`)
  ).size;

  return {
    unitEntityId,
    label: ledger.flatNumber ?? ledger.name,
    vs: ledger.vs,
    balanceCents,
    preplatokCents,
    lastPayments,
    monthly: predpis && isCurrent
      ? {
          totalCents: predpis.totalCents,
          iban: predpis.iban,
          vs: predpis.vs,
          year: predpis.year,
          month: predpis.month,
          qrPayload: predpis.payBySquare,
        }
      : null,
    settlementYears: visibleSettlementYears,
    latestSettlement,
    overdue: {
      totalOpenCents: overdueItems.reduce((s, i) => s + i.openCents, 0),
      months: overdueMonths,
      // The netting is unit-wide; a windowed viewer is credited at most with
      // the preplatok of their own period.
      creditAppliedCents: overdue
        ? windows
          ? Math.min(overdue.creditAppliedCents, Math.max(0, preplatokCents))
          : overdue.creditAppliedCents
        : 0,
    },
  };
}

/**
 * Units (of `unitIds`) that have a published settlement for `year` — the
 * home "vyúčtovanie je pripravené" deadline row.
 */
export async function listUnitsWithSettlement(
  entityId: string,
  unitIds: string[],
  year: number
): Promise<string[]> {
  const years = await Promise.all(
    unitIds.map((id) => listSettlementYearsForUnit(entityId, id))
  );
  return unitIds.filter((_, i) => years[i].includes(year));
}
