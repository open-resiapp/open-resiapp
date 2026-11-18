import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { bankConnections, payments } from "@modules/accounting/src/db/schema";

// How current the money figures are. Balances are computed live from the
// ledger (balancesAsOf = now), but incoming payments exist only once a
// bank statement was imported (file upload or Fio / Enable Banking sync),
// so a debtor list is only as fresh as the last import. Read-only, two
// small aggregates scoped by entity_id.

export interface DataFreshness {
  /** When the balances were computed (live, this request). */
  balancesAsOf: string;
  /** Latest bank import: last API sync or last imported bank line; null = never. */
  lastBankImportAt: string | null;
  /** Booking date of the newest imported bank line; null = none. */
  lastBankTransactionAt: string | null;
}

function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export async function getDataFreshness(entityId: string): Promise<DataFreshness> {
  const [[sync], [lines]] = await Promise.all([
    db
      .select({ at: sql<Date | string | null>`max(${bankConnections.lastSyncAt})` })
      .from(bankConnections)
      .where(and(eq(bankConnections.entityId, entityId), eq(bankConnections.isActive, true))),
    db
      .select({
        importedAt: sql<Date | string | null>`max(${payments.createdAt})`,
        receivedAt: sql<Date | string | null>`max(${payments.receivedAt})`,
      })
      .from(payments)
      .where(and(eq(payments.entityId, entityId), ne(payments.source, "manual"))),
  ]);
  const candidates = [toIso(sync?.at), toIso(lines?.importedAt)].filter(
    (x): x is string => x !== null
  );
  return {
    balancesAsOf: new Date().toISOString(),
    lastBankImportAt: candidates.length ? candidates.sort().at(-1)! : null,
    lastBankTransactionAt: toIso(lines?.receivedAt),
  };
}

/** One line for the model-facing summary. */
export function freshnessLine(f: DataFreshness): string {
  if (!f.lastBankImportAt) return "No bank statement has been imported yet — balances do not reflect bank payments.";
  return `Bank payments imported up to ${f.lastBankImportAt.slice(0, 10)}${
    f.lastBankTransactionAt ? ` (newest transaction ${f.lastBankTransactionAt.slice(0, 10)})` : ""
  }; balances as of ${f.balancesAsOf.slice(0, 16).replace("T", " ")} UTC.`;
}
