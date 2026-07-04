import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bankConnections, auditLog } from "../db/schema";
import {
  assertLedgerCurrency,
  importNormalizedLines,
  type ImportSummary,
} from "./bank-import";
import {
  fioTransactionsUrl,
  mapFioTransactions,
  type FioStatementJson,
} from "./fio-format";

// Fio banka REST connector (BYT-20260512-002 Phase 2, spec §Bank import).
// Zero-friction live poll: per-account read-only token, transactions from
// https://fioapi.fio.cz/v1/rest/periods/{token}/{from}/{to}/transactions.json
// Dedup by "ID pohybu" (column22) → externalTxId `fio:{id}`. The HTTP
// layer is injectable — tests pass a mock fetch; production uses global
// fetch. No credentials live in code or env; the token is stored per dom
// in mod_accounting_bank_connections (treasurer-entered).

type Country = "sk" | "cz";

/** Re-fetch overlap so a poll never misses lines booked around midnight. */
const OVERLAP_DAYS = 7;
const DEFAULT_BACKFILL_DAYS = 90;

// ── connection management ──────────────────────────────

export interface FioConnectionState {
  connected: boolean;
  tokenPreview: string | null;
  lastSyncAt: string | null;
}

export async function getFioConnection(
  entityId: string
): Promise<FioConnectionState> {
  const [row] = await db
    .select({
      token: bankConnections.token,
      lastSyncAt: bankConnections.lastSyncAt,
      isActive: bankConnections.isActive,
    })
    .from(bankConnections)
    .where(
      and(
        eq(bankConnections.entityId, entityId),
        eq(bankConnections.provider, "fio")
      )
    );
  if (!row || !row.isActive) {
    return { connected: false, tokenPreview: null, lastSyncAt: null };
  }
  return {
    connected: true,
    tokenPreview: `${row.token.slice(0, 6)}…`,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
  };
}

export async function setFioToken(input: {
  entityId: string;
  actorId: string;
  token: string;
}): Promise<void> {
  const token = input.token.trim();
  // Fio tokens are 64-char alphanumeric strings.
  if (!/^[A-Za-z0-9]{40,128}$/.test(token)) {
    throw new Error("accounting: invalid Fio token format");
  }
  await db.transaction(async (tx) => {
    await tx
      .insert(bankConnections)
      .values({
        entityId: input.entityId,
        provider: "fio",
        token,
        isActive: true,
        createdById: input.actorId,
      })
      .onConflictDoUpdate({
        target: [bankConnections.entityId, bankConnections.provider],
        set: { token, isActive: true, lastSyncAt: null },
      });
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_bank_connections",
      recordId: input.entityId,
      after: { provider: "fio", tokenPreview: `${token.slice(0, 6)}…` },
    });
  });
}

// ── sync ───────────────────────────────────────────────

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Polls Fio for transactions since the last sync (with overlap; dedup is
 * idempotent anyway) and runs them through the shared import pipeline.
 * `fetchImpl` is injectable for tests — never called with real
 * credentials in any test path.
 */
export async function syncFio(input: {
  entityId: string;
  country: Country;
  actorId: string;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<ImportSummary> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike);
  const now = input.now ?? new Date();

  const [connection] = await db
    .select({
      token: bankConnections.token,
      lastSyncAt: bankConnections.lastSyncAt,
      isActive: bankConnections.isActive,
    })
    .from(bankConnections)
    .where(
      and(
        eq(bankConnections.entityId, input.entityId),
        eq(bankConnections.provider, "fio")
      )
    );
  if (!connection || !connection.isActive) {
    throw new Error("accounting: Fio is not connected — set the token first");
  }

  const from = connection.lastSyncAt
    ? new Date(
        connection.lastSyncAt.getTime() - OVERLAP_DAYS * 24 * 3600 * 1000
      )
    : new Date(now.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 3600 * 1000);

  const url = fioTransactionsUrl(connection.token, isoDate(from), isoDate(now));
  let response;
  try {
    response = await fetchImpl(url);
  } catch (err) {
    throw new Error(
      `accounting: Fio request failed — ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!response.ok) {
    // 409 = Fio rate limit (one call per token per 30 s).
    throw new Error(
      response.status === 409
        ? "accounting: Fio rate limit — wait 30 seconds and retry"
        : `accounting: Fio returned HTTP ${response.status}`
    );
  }
  const payload = (await response.json()) as FioStatementJson;
  const { currency, lines } = mapFioTransactions(payload);
  assertLedgerCurrency(input.country, [{ currency }]);

  const summary = await importNormalizedLines({
    entityId: input.entityId,
    country: input.country,
    actorId: input.actorId,
    source: "fio_api",
    lines,
  });

  await db
    .update(bankConnections)
    .set({ lastSyncAt: now })
    .where(
      and(
        eq(bankConnections.entityId, input.entityId),
        eq(bankConnections.provider, "fio")
      )
    );

  return summary;
}
