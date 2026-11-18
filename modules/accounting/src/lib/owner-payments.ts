import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, feeAssessments, feeSchedules } from "../db/schema";
import { postAllDueMonths } from "./fee-schedule-publish";
import {
  canReadUnitLedger,
  getUnitLedger,
  listScopedUnitBalances,
  scopeLedger,
} from "./karta-bytu";
import { getOverdueForUnit, scopeOverdue } from "./overdue";
import { getPredpisPdfData } from "./predpis-pdf-data";
import { getVyuctovaniePdfData, listSettlementYearsForUnit } from "./vyuctovanie";

// Owner self-service read model ("Moje platby", home balance card —
// BYT-20261117-002 Phase 4). A thin composition of the SAME lib functions
// the karta bytu API uses (ledger, overdue, predpis, vyúčtovanie). No
// balance math lives here — every number comes from those functions
// (invariant 11: derived from postings, never stored). Authorisation is
// the caller's job (canReadUnitLedger / listOwnedUnits).

type Country = "sk" | "cz";

// Window helpers live in ./ownership-windows (shared with karta-bytu);
// re-exported for existing importers.
export {
  inWindows,
  ledgerRowsInWindows,
  listOwnedUnits,
  listOwnershipWindows,
  yearInWindows,
  type OwnedUnit,
  type OwnedUnitWithWindows,
  type OwnershipWindow,
} from "./ownership-windows";
import {
  inWindows,
  listOwnershipWindows,
  todayIso,
  yearInScope,
  type OwnedUnit,
  type OwnedUnitWithWindows,
  type OwnershipWindow,
} from "./ownership-windows";


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

/**
 * Which unit a "Moje platby" view shows, and with which ownership windows —
 * shared by the Moje platby page and the MCP owner tools
 * (BYT-20261118-012), so web and AI resolve access identically:
 *   - a requested unit the viewer owns / owned → that unit, limited to the
 *     viewer's own ownership windows;
 *   - any other requested unit → only for whole-dom readers (admin /
 *     treasurer / chairman via canReadUnitLedger), full history (no windows);
 *   - nothing requested → the viewer's first owned unit (current first).
 * `canSubmitReadings` = the viewer owns the unit TODAY (a board member
 * opening another unit must not submit as its owner).
 */
export type OwnerUnitResolution =
  | {
      kind: "ok";
      unitId: string;
      windows: OwnershipWindow[] | undefined;
      canSubmitReadings: boolean;
      owned: OwnedUnitWithWindows[];
    }
  | { kind: "forbidden"; owned: OwnedUnitWithWindows[] }
  | { kind: "none"; owned: OwnedUnitWithWindows[] };

export async function resolveOwnerUnit(input: {
  userId: string;
  userRole: string;
  entityId: string;
  requested: string | null;
}): Promise<OwnerUnitResolution> {
  const { userId, userRole, entityId, requested } = input;
  const owned = await listOwnershipWindows(userId, entityId);
  let unitId: string | null = null;
  if (requested && owned.some((u) => u.id === requested)) {
    unitId = requested;
  } else if (requested) {
    if (!(await canReadUnitLedger(userId, userRole, entityId, requested))) {
      return { kind: "forbidden", owned };
    }
    unitId = requested;
  } else {
    unitId = owned[0]?.id ?? null;
  }
  if (!unitId) return { kind: "none", owned };
  const mine = owned.find((u) => u.id === unitId);
  return {
    kind: "ok",
    unitId,
    windows: mine?.windows,
    canSubmitReadings: Boolean(mine?.current),
    owned,
  };
}

export interface UnitBalanceLine {
  unitEntityId: string;
  label: string;
  /** Positive = owner owes, negative = overpaid (domain sign convention). */
  balanceCents: number;
}

/**
 * One balance per unit as the viewer may see it: with `windows` only the
 * viewer's own ownership period (a buyer's home card never shows the
 * seller's debt), else the karta list aggregate.
 */
export async function getUnitBalanceLines(
  entityId: string,
  country: Country,
  units: (OwnedUnit & { windows?: OwnershipWindow[] })[]
): Promise<UnitBalanceLine[]> {
  const balances = await listScopedUnitBalances(
    entityId,
    country,
    units.map((u) => ({ id: u.id, windows: u.windows }))
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
  // Balance, parked preplatok, rows and overdue items of the viewer's own
  // period — the same scoping the karta API applies (scopeLedger /
  // scopeOverdue), derived from the same postings.
  const scoped = scopeLedger(ledger, windows);
  const ledgerRows = scoped.rows;
  const balanceCents = scoped.balanceCents;
  const preplatokCents = scoped.preplatokCents;
  const visibleSettlementYears = settlementYears.filter((y) => yearInScope(y, windows));
  const overdueItems = overdue ? scopeOverdue(overdue, windows).items : [];

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
 * Units that have a published settlement for `year` — the home
 * "vyúčtovanie je pripravené" deadline row. With `windows` the year must
 * fall in the viewer's own ownership period.
 */
export async function listUnitsWithSettlement(
  entityId: string,
  units: { id: string; windows?: OwnershipWindow[] }[],
  year: number
): Promise<string[]> {
  const years = await Promise.all(
    units.map((u) => listSettlementYearsForUnit(entityId, u.id))
  );
  return units
    .filter((u, i) => years[i].includes(year) && yearInScope(year, u.windows))
    .map((u) => u.id);
}
