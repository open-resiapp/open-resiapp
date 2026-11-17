import "server-only";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships } from "@/db/schema";
import { accountingPeriods, feeAssessments, feeSchedules } from "../db/schema";
import { domUnitsWhere } from "./dom-units";
import { postAllDueMonths } from "./fee-schedule-publish";
import { getUnitLedger, listUnitBalances } from "./karta-bytu";
import { getOverdueForUnit } from "./overdue";
import { getPredpisPdfData } from "./predpis-pdf-data";
import { getVyuctovaniePdfData, listSettlementYearsForUnit } from "./vyuctovanie";
import { listReadingsForUnit } from "./meters";

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

/**
 * Units the user holds an ACTIVE OWNER membership on — the same population
 * karta bytu grants a non-board user (listAccessibleUnits' owner branch),
 * but also for board members, whose "Moje platby" is about their own flat.
 */
export async function listOwnedUnits(
  userId: string,
  entityId: string
): Promise<OwnedUnit[]> {
  return db
    .select({
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
        eq(memberships.status, "active")
      )
    )
    .orderBy(asc(entities.name));
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
  overdue: { totalOpenCents: number; months: number };
  /** The unit has ever had a meter reading → the dom uses self-reading. */
  usesMeters: boolean;
}

export async function getOwnerPaymentSummary(input: {
  entityId: string;
  country: Country;
  unitEntityId: string;
  beneficiaryName: string;
}): Promise<OwnerPaymentSummary | null> {
  const { entityId, country, unitEntityId, beneficiaryName } = input;

  const [ledger, predpis, settlementYears, overdue, readings] = await Promise.all([
    getUnitLedger(entityId, unitEntityId, country),
    // Throws on "no published predpis / no VS / no IBAN" — expected
    // states for an owner, rendered as "not available".
    getPredpisPdfData({ entityId, country, unitEntityId, beneficiaryName }).catch(
      () => null
    ),
    listSettlementYearsForUnit(entityId, unitEntityId),
    getOverdueForUnit({ entityId, country, unitEntityId }).catch(() => null),
    listReadingsForUnit(entityId, unitEntityId).catch(() => []),
  ]);
  if (!ledger) return null;

  let latestSettlement: OwnerPaymentSummary["latestSettlement"] = null;
  if (settlementYears.length > 0) {
    const year = settlementYears[0];
    const pdf = await getVyuctovaniePdfData({
      entityId,
      country,
      unitEntityId,
      year,
      beneficiaryName,
    }).catch(() => null);
    latestSettlement = { year, differenceCents: pdf ? pdf.totalDifferenceCents : null };
  }

  const lastPayments = ledger.rows
    .filter((r) => r.sourceType === "payment" && r.deltaCents < 0)
    .slice(-3)
    .reverse()
    .map((r) => ({
      journalEntryId: r.journalEntryId,
      postedAt: r.postedAt,
      amountCents: -r.deltaCents,
    }));

  const overdueMonths = overdue
    ? new Set(overdue.items.map((i) => `${i.periodYear}-${i.month}`)).size
    : 0;

  return {
    unitEntityId,
    label: ledger.flatNumber ?? ledger.name,
    vs: ledger.vs,
    balanceCents: ledger.balanceCents,
    preplatokCents: ledger.preplatokCents,
    lastPayments,
    monthly: predpis
      ? {
          totalCents: predpis.totalCents,
          iban: predpis.iban,
          vs: predpis.vs,
          year: predpis.year,
          month: predpis.month,
          qrPayload: predpis.payBySquare,
        }
      : null,
    settlementYears,
    latestSettlement,
    overdue: {
      totalOpenCents: overdue?.totalOpenCents ?? 0,
      months: overdueMonths,
    },
    usesMeters: readings.length > 0,
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
