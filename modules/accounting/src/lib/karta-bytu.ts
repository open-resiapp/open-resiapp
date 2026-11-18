import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import {
  accounts,
  accountingPeriods,
  feeAssessments,
  journalEntries,
  journalLines,
  payments,
  paymentAllocations,
  serviceCategories,
  unitSettings,
} from "../db/schema";
import { ACCOUNT_CODES } from "../seeds/coa-sk";
import { allocatePayment } from "../engine/allocation";
import { openReceivablesForUnit } from "./payments";
import { applyPaymentCredit } from "../engine/booking";
import { getCurrentOpenPeriod } from "./periods";
import { domUnitsWhere, listDomUnits } from "./dom-units";
import { hasBoardRole } from "./authz";
import { postAllDueMonths } from "./fee-schedule-publish";
import {
  inScope,
  listOwnershipWindows,
  type OwnershipWindow,
} from "./ownership-windows";

// Karta bytu (spec §Per-unit ledger) — the unit's running-balance ledger.
// Domain invariant 11: every displayed balance derives from postings —
// this module reads journal lines, never stored balances. Sign convention:
// POSITIVE = owner owes (nedoplatok), NEGATIVE = preplatok.
//
// A ledger row = one journal entry touching the unit's debt position:
// lines on the receivable accounts (311.*, 378) and the preplatok parking
// account (379) attributed to the unit. Debit increases debt, credit
// decreases it — predpis rows show +, payments −, void reversals mirror.

type Country = "sk" | "cz";

const UNIT_DEBT_ACCOUNTS = [
  ACCOUNT_CODES.POHLADAVKY_VLASTNICI_FPUO,
  ACCOUNT_CODES.POHLADAVKY_VLASTNICI_SLUZBY,
  ACCOUNT_CODES.INE_POHLADAVKY,
  ACCOUNT_CODES.INE_ZAVAZKY,
];

// ── Access ─────────────────────────────────────────────
//
// One rule for every per-unit read (karta, overdue, predpis, vyúčtovanie,
// meter history, Moje platby, MCP — BYT-20261118-012):
//   - whole-dom readers (admin / treasurer / chairman with a board term in
//     force) read any unit with its full history;
//   - everyone else reads a unit only through their OWN ownership windows
//     (current or former owner membership, validity [valid_from, valid_to)
//     started) and only the part of the history inside those windows — a
//     buyer never sees the seller's postings, readings or settlements; a
//     seller keeps their own period after the sale; a future buyer sees
//     nothing yet.

export type UnitReadScope =
  | { wholeDom: true; windows: undefined; current: true }
  | { wholeDom: false; windows: OwnershipWindow[]; current: boolean };

/** admin / treasurer / chairman — whole-dom history (canReadAccounting rule). */
export async function isWholeDomReader(
  userId: string,
  userRole: string,
  entityId: string
): Promise<boolean> {
  if (userRole === "admin") return true;
  return hasBoardRole(userId, entityId, ["treasurer", "chairman"]);
}

/** null = no access to the unit at all (route answers 403). */
export async function getUnitReadScope(
  userId: string,
  userRole: string,
  entityId: string,
  unitEntityId: string
): Promise<UnitReadScope | null> {
  if (await isWholeDomReader(userId, userRole, entityId)) {
    return { wholeDom: true, windows: undefined, current: true };
  }
  const owned = await listOwnershipWindows(userId, entityId);
  const unit = owned.find((u) => u.id === unitEntityId);
  return unit ? { wholeDom: false, windows: unit.windows, current: unit.current } : null;
}

/** Any read access to the unit (scope decides WHICH part of its history). */
export async function canReadUnitLedger(
  userId: string,
  userRole: string,
  entityId: string,
  unitEntityId: string
): Promise<boolean> {
  return (await getUnitReadScope(userId, userRole, entityId, unitEntityId)) !== null;
}

export interface AccessibleUnit {
  id: string;
  name: string;
  flatNumber: string | null;
  /** undefined = whole history (board); else the viewer's ownership windows. */
  windows: OwnershipWindow[] | undefined;
}

/** Units the user may open: whole dom for board/admin, own (current + former) units otherwise. */
export async function listAccessibleUnitScopes(
  userId: string,
  userRole: string,
  entityId: string
): Promise<AccessibleUnit[]> {
  if (await isWholeDomReader(userId, userRole, entityId)) {
    return (await listDomUnits(entityId)).map((u) => ({
      id: u.id,
      name: u.name,
      flatNumber: u.flatNumber,
      windows: undefined,
    }));
  }
  return (await listOwnershipWindows(userId, entityId)).map((u) => ({
    id: u.id,
    name: u.name,
    flatNumber: u.flatNumber,
    windows: u.windows,
  }));
}

/** Units the user may open (without the windows). */
export async function listAccessibleUnits(
  userId: string,
  userRole: string,
  entityId: string
): Promise<{ id: string; name: string; flatNumber: string | null }[]> {
  return (await listAccessibleUnitScopes(userId, userRole, entityId)).map(
    ({ id, name, flatNumber }) => ({ id, name, flatNumber })
  );
}

/**
 * Balance per unit as the viewer may see it: the dom aggregate for
 * whole-history units, the sum of the viewer's own windowed postings
 * otherwise (same math as scopeLedger).
 */
export async function listScopedUnitBalances(
  entityId: string,
  country: Country,
  units: { id: string; windows: OwnershipWindow[] | undefined }[]
): Promise<Map<string, number>> {
  const full = units.filter((u) => !u.windows).map((u) => u.id);
  const out = await listUnitBalances(entityId, country, full);
  for (const u of units) {
    if (!u.windows) continue;
    const ledger = await getUnitLedger(entityId, u.id, country);
    out.set(u.id, ledger ? scopeLedger(ledger, u.windows).balanceCents : 0);
  }
  return out;
}

/**
 * Balance per unit in one aggregate over journal lines (derived, never
 * stored — invariant 11). Only returns units in `unitIds`.
 */
export async function listUnitBalances(
  entityId: string,
  country: Country,
  unitIds: string[]
): Promise<Map<string, number>> {
  if (unitIds.length === 0) return new Map();
  const rows = await db
    .select({
      unitEntityId: journalLines.unitEntityId,
      balance: sql<number>`sum(${journalLines.debitCents} - ${journalLines.creditCents})::int`,
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
        inArray(accounts.code, UNIT_DEBT_ACCOUNTS),
        inArray(journalLines.unitEntityId, unitIds)
      )
    )
    .groupBy(journalLines.unitEntityId);
  return new Map(rows.map((r) => [r.unitEntityId!, r.balance]));
}

// ── Ledger ─────────────────────────────────────────────

export interface LedgerLine {
  categorySlug: string | null;
  accountCode: string;
  deltaCents: number;
}

export interface LedgerRow {
  journalEntryId: string;
  postedAt: string;
  description: string;
  sourceType: string;
  sourceId: string | null;
  /** Positive = debt increased (predpis), negative = paid/credited. */
  deltaCents: number;
  balanceCents: number;
  lines: LedgerLine[];
}

export interface UnitLedger {
  unitEntityId: string;
  name: string;
  flatNumber: string | null;
  vs: string | null;
  balanceCents: number;
  /** Parked preplatok on 379 (positive = credit available). */
  preplatokCents: number;
  rows: LedgerRow[];
}

export async function getUnitLedger(
  entityId: string,
  unitEntityId: string,
  country: Country
): Promise<UnitLedger | null> {
  const [unit] = await db
    .select({
      id: entities.id,
      name: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      vs: unitSettings.vs,
    })
    .from(entities)
    .leftJoin(unitSettings, eq(unitSettings.unitEntityId, entities.id))
    .where(and(eq(entities.id, unitEntityId), domUnitsWhere(entityId)));
  if (!unit) return null;

  const debtAccountIds = await db
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(
      and(
        eq(accounts.country, country),
        inArray(accounts.code, UNIT_DEBT_ACCOUNTS)
      )
    );
  const accountCodeById = new Map(debtAccountIds.map((a) => [a.id, a.code]));

  const lines = await db
    .select({
      journalEntryId: journalLines.journalEntryId,
      accountId: journalLines.accountId,
      debitCents: journalLines.debitCents,
      creditCents: journalLines.creditCents,
      categorySlug: serviceCategories.slug,
      postedAt: journalEntries.postedAt,
      createdAt: journalEntries.createdAt,
      description: journalEntries.description,
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
    })
    .from(journalLines)
    .innerJoin(
      journalEntries,
      eq(journalLines.journalEntryId, journalEntries.id)
    )
    .leftJoin(
      serviceCategories,
      eq(journalLines.serviceCategoryId, serviceCategories.id)
    )
    .where(
      and(
        eq(journalEntries.entityId, entityId),
        eq(journalLines.unitEntityId, unitEntityId),
        inArray(
          journalLines.accountId,
          debtAccountIds.map((a) => a.id)
        )
      )
    )
    .orderBy(asc(journalEntries.postedAt), asc(journalEntries.createdAt));

  // Group by entry, preserving chronological order.
  const rowByEntry = new Map<string, LedgerRow>();
  const order: string[] = [];
  let preplatokCents = 0;

  for (const line of lines) {
    const code = accountCodeById.get(line.accountId)!;
    // Debt delta: receivable debit = +debt; 379 credit = −debt (credit
    // held for the owner). One formula covers both: debit − credit.
    const delta = line.debitCents - line.creditCents;
    if (code === ACCOUNT_CODES.INE_ZAVAZKY) {
      preplatokCents += line.creditCents - line.debitCents;
    }
    let row = rowByEntry.get(line.journalEntryId);
    if (!row) {
      row = {
        journalEntryId: line.journalEntryId,
        postedAt: line.postedAt.toISOString(),
        description: line.description,
        sourceType: line.sourceType,
        sourceId: line.sourceId,
        deltaCents: 0,
        balanceCents: 0,
        lines: [],
      };
      rowByEntry.set(line.journalEntryId, row);
      order.push(line.journalEntryId);
    }
    row.deltaCents += delta;
    row.lines.push({
      categorySlug: line.categorySlug,
      accountCode: code,
      deltaCents: delta,
    });
  }

  let balance = 0;
  const rows = order.map((id) => {
    const row = rowByEntry.get(id)!;
    balance += row.deltaCents;
    row.balanceCents = balance;
    return row;
  });

  return {
    unitEntityId: unit.id,
    name: unit.name,
    flatNumber: unit.flatNumber,
    vs: unit.vs,
    balanceCents: balance,
    preplatokCents,
    rows,
  };
}

/**
 * The ledger limited to the viewer's ownership windows: rows posted inside
 * a window, running balance / balance / parked preplatok recomputed from
 * those rows only. undefined windows = the full ledger (board).
 */
export function scopeLedger(
  ledger: UnitLedger,
  windows: OwnershipWindow[] | undefined
): UnitLedger {
  if (!windows) return ledger;
  let balance = 0;
  let preplatok = 0;
  const rows = ledger.rows
    .filter((r) => inScope(r.postedAt, windows))
    .map((r) => {
      balance += r.deltaCents;
      for (const l of r.lines) {
        if (l.accountCode === ACCOUNT_CODES.INE_ZAVAZKY) preplatok -= l.deltaCents;
      }
      return { ...r, balanceCents: balance };
    });
  return { ...ledger, rows, balanceCents: balance, preplatokCents: preplatok };
}

// ── Apply parked preplatok ─────────────────────────────

/**
 * Applies the unit's parked preplatok to its open assessments, oldest
 * payment first, FIFO across months (proportional within — strategy
 * config intentionally not consulted: applying an existing credit is a
 * settlement, not a fresh payment). Returns the applied total.
 */
export async function applyUnitCredit(input: {
  entityId: string;
  country: Country;
  unitEntityId: string;
  actorId: string;
}): Promise<{ appliedCents: number }> {
  return db.transaction(async (tx) => {
    // Locks open periods — serializes with payments/publishes.
    await postAllDueMonths(tx, {
      entityId: input.entityId,
      country: input.country,
    });

    const period = await getCurrentOpenPeriod(tx, input.entityId);

    // Payments of this unit with an unapplied remainder, oldest first.
    const unitPayments = await tx
      .select({
        id: payments.id,
        amountCents: payments.amountCents,
        allocatedCents: sql<number>`coalesce((
          select sum(${paymentAllocations.amountCents})::int
          from ${paymentAllocations}
          where ${paymentAllocations.paymentId} = ${payments.id}
        ), 0)`,
      })
      .from(payments)
      .where(
        and(
          eq(payments.entityId, input.entityId),
          eq(payments.unitEntityId, input.unitEntityId),
          sql`${payments.voidedAt} is null`,
          sql`${payments.journalEntryId} is not null`
        )
      )
      .orderBy(asc(payments.receivedAt), asc(payments.createdAt));

    const withRemainder = unitPayments
      .map((p) => ({ id: p.id, remainder: p.amountCents - p.allocatedCents }))
      .filter((p) => p.remainder > 0);

    // Open receivables — same derivation as payment allocation (due
    // assessments + published settlement nedoplatky).
    let open = await openReceivablesForUnit(tx, input.unitEntityId);
    // Category ids for assessment targets (journal lines need them).
    const categoryIdByAssessment = new Map<string, string>();
    {
      const assessmentIds = open
        .filter((o) => o.kind === "assessment")
        .map((o) => o.id);
      if (assessmentIds.length > 0) {
        const rows = await tx
          .select({
            id: feeAssessments.id,
            serviceCategoryId: feeAssessments.serviceCategoryId,
          })
          .from(feeAssessments)
          .where(inArray(feeAssessments.id, assessmentIds));
        for (const r of rows) {
          categoryIdByAssessment.set(r.id, r.serviceCategoryId);
        }
      }
    }

    let appliedTotal = 0;
    for (const payment of withRemainder) {
      if (open.length === 0) break;
      const result = allocatePayment(
        payment.remainder,
        open,
        "proportional",
        []
      );
      if (result.allocations.length === 0) break;
      const metaById = new Map(open.map((o) => [o.id, o]));
      await applyPaymentCredit(tx, {
        paymentId: payment.id,
        entityId: input.entityId,
        periodId: period.id,
        country: input.country,
        createdById: input.actorId,
        unitEntityId: input.unitEntityId,
        // A person clicked "apply credit" — audit as a manual decision.
        allocatedBy: "manual",
        allocations: result.allocations.map((a) => {
          const target = metaById.get(a.assessmentId)!;
          return target.kind === "settlement"
            ? {
                settlementUnitId: a.assessmentId,
                serviceCategoryId: null,
                okruh: target.okruh,
                amountCents: a.amountCents,
              }
            : {
                assessmentId: a.assessmentId,
                serviceCategoryId: categoryIdByAssessment.get(a.assessmentId)!,
                okruh: target.okruh,
                amountCents: a.amountCents,
              };
        }),
      });
      appliedTotal += result.allocations.reduce(
        (s, a) => s + a.amountCents,
        0
      );
      // Shrink open amounts for the next payment's pass.
      const appliedById = new Map(
        result.allocations.map((a) => [a.assessmentId, a.amountCents])
      );
      open = open
        .map((o) => ({
          ...o,
          openCents: o.openCents - (appliedById.get(o.id) ?? 0),
        }))
        .filter((o) => o.openCents > 0);
    }

    return { appliedCents: appliedTotal };
  });
}
