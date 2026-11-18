import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships } from "@/db/schema";
import { domUnitsWhere } from "./dom-units";

// Ownership windows (BYT-20261118-007 validity dates, BYT-20261118-012):
// which part of a unit's history a person may read. An owner sees only the
// months / years of their own ownership — a buyer never sees the seller's
// postings, readings or settlements; a seller keeps their own after the
// sale. Whole-dom readers (admin / treasurer / chairman) are not limited
// (windows = undefined). Pure date logic + one membership query; shared by
// the karta / meters / vyúčtovanie routes, Moje platby and the MCP tools.

/** Today as YYYY-MM-DD (UTC) — membership validity dates are plain dates. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface OwnedUnit {
  id: string;
  name: string;
  flatNumber: string | null;
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
export function inWindows(day: string, windows: OwnershipWindow[]): boolean {
  return windows.some((w) => w.from <= day && (w.to === null || day < w.to));
}

/**
 * Ledger rows of the viewer's own ownership period (posting date inside a
 * window); all rows when `windows` is undefined (whole-dom reader).
 */
export function ledgerRowsInWindows<R extends { postedAt: string }>(
  rows: R[],
  windows: OwnershipWindow[] | undefined
): R[] {
  return windows ? rows.filter((r) => inWindows(r.postedAt.slice(0, 10), windows)) : rows;
}

/** Does calendar year `year` overlap any window? */
export function yearInWindows(year: number, windows: OwnershipWindow[]): boolean {
  const first = `${year}-01-01`;
  const last = `${year}-12-31`;
  return windows.some((w) => w.from <= last && (w.to === null || w.to > first));
}

/** Is the ISO timestamp / date's day inside the windows? undefined windows = no limit. */
export function inScope(isoDate: string, windows: OwnershipWindow[] | undefined): boolean {
  return windows ? inWindows(isoDate.slice(0, 10), windows) : true;
}

/** Year visible in the windows? undefined windows = no limit. */
export function yearInScope(year: number, windows: OwnershipWindow[] | undefined): boolean {
  return windows ? yearInWindows(year, windows) : true;
}

/** Overdue / receivable item of the viewer's period (assessment month or settlement year). */
export function periodInScope(
  item: { kind: string; periodYear: number; month: number },
  windows: OwnershipWindow[] | undefined
): boolean {
  if (!windows) return true;
  return item.kind === "settlement"
    ? yearInWindows(item.periodYear, windows)
    : inWindows(`${item.periodYear}-${String(item.month).padStart(2, "0")}-01`, windows);
}
