import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, journalLines } from "../db/schema";
import { ACCOUNT_CODES } from "../seeds/coa-sk";
import { listDomUnits } from "./dom-units";
import { listUnitBalances } from "./karta-bytu";

// Dashboard tiles (spec §Dashboard, Phase 1: 4 tiles). Every number is
// derived from journal postings at read time — never a stored balance
// (domain invariant 11).

type Country = "sk" | "cz";

export interface DashboardTiles {
  openingPosted: boolean;
  /** 211 — cash box. */
  pokladnicaCents: number;
  /** 221 — bank. */
  bankaCents: number;
  /**
   * Cash-basis fund: 472 liability MINUS the open FPÚO receivables
   * (predpis credits 472 when it becomes DUE, not when it is PAID —
   * showing raw 472 would count money nobody has sent yet and mislead an
   * expense approval).
   */
  fondOpravCents: number;
  /** Units with positive balance (they owe). */
  nedoplatky: { count: number; totalCents: number };
}

const TILE_ACCOUNTS = [
  ACCOUNT_CODES.POKLADNICA,
  ACCOUNT_CODES.BANKA,
  ACCOUNT_CODES.ZAVAZKY_FPUO,
  ACCOUNT_CODES.POHLADAVKY_VLASTNICI_FPUO,
];

/** Dr − Cr per account code, one grouped query. */
async function accountBalances(
  entityId: string,
  country: Country
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      code: accounts.code,
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
        inArray(accounts.code, TILE_ACCOUNTS)
      )
    )
    .groupBy(accounts.code);
  return new Map(rows.map((r) => [r.code, r.balance]));
}

export async function getDashboardTiles(
  entityId: string,
  country: Country
): Promise<DashboardTiles> {
  const [opening] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.entityId, entityId),
        eq(journalEntries.sourceType, "opening_balance")
      )
    )
    .limit(1);

  const [balances, units] = await Promise.all([
    accountBalances(entityId, country),
    listDomUnits(entityId),
  ]);
  const drMinusCr = (code: string) => balances.get(code) ?? 0;

  const fondLiability = -drMinusCr(ACCOUNT_CODES.ZAVAZKY_FPUO);
  const fpuoOpenReceivables = Math.max(
    0,
    drMinusCr(ACCOUNT_CODES.POHLADAVKY_VLASTNICI_FPUO)
  );

  const unitBalances = await listUnitBalances(
    entityId,
    country,
    units.map((u) => u.id)
  );
  let count = 0;
  let totalCents = 0;
  for (const balance of unitBalances.values()) {
    if (balance > 0) {
      count += 1;
      totalCents += balance;
    }
  }

  return {
    openingPosted: !!opening,
    pokladnicaCents: drMinusCr(ACCOUNT_CODES.POKLADNICA),
    bankaCents: drMinusCr(ACCOUNT_CODES.BANKA),
    fondOpravCents: fondLiability - fpuoOpenReceivables,
    nedoplatky: { count, totalCents },
  };
}
