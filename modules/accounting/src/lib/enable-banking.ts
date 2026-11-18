import "server-only";

import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingSettings,
  auditLog,
  bankConnections,
} from "../db/schema";
import {
  assertLedgerCurrency,
  importNormalizedLines,
  type ImportSummary,
  type NormalizedBankLine,
} from "./bank-import";
import {
  ENABLE_BANKING_API,
  EnableBankingError,
  consentValidUntil,
  mapEnableBankingTransactions,
  mapSessionAccounts,
  maskIban,
  pickAccountUid,
  pickPsuType,
  type EbAspsp,
  type EbSessionResponse,
  type EbTransactionsPage,
  type EnableBankingConfig,
  type MappedEbLine,
  type StoredEbAccount,
} from "./enable-banking-format";
import { signEnableBankingJwt } from "./enable-banking-jwt";

// Enable Banking PSD2 connector (BYT-20261118-001). Same shape as the Fio
// connector (fio.ts): per-dom row in mod_accounting_bank_connections, the
// shared import pipeline, an injectable HTTP layer for tests. App-level
// credentials come from env — one Enable Banking application per instance
// (self-host: the HOA's own restricted-mode app; cloud: injected secret).
// token = Enable Banking session_id; never returned to clients.

type Country = "sk" | "cz";

const OVERLAP_DAYS = 7;
const DEFAULT_BACKFILL_DAYS = 90;
const MAX_PAGES = 50;

// ── credentials + JWT ──────────────────────────────────

interface AppCredentials {
  appId: string;
  privateKey: string;
  apiBase: string;
}

function loadCredentials(): AppCredentials | null {
  const appId = process.env.ENABLE_BANKING_APP_ID?.trim();
  if (!appId) return null;
  let privateKey = process.env.ENABLE_BANKING_PRIVATE_KEY?.trim() ?? "";
  if (!privateKey && process.env.ENABLE_BANKING_PRIVATE_KEY_FILE) {
    try {
      privateKey = readFileSync(
        process.env.ENABLE_BANKING_PRIVATE_KEY_FILE,
        "utf8"
      ).trim();
    } catch {
      return null;
    }
  }
  if (!privateKey) return null;
  // Env files often carry the PEM on one line with literal "\n".
  privateKey = privateKey.replace(/\\n/g, "\n");
  const apiBase = (
    process.env.ENABLE_BANKING_API_URL?.trim() || ENABLE_BANKING_API
  ).replace(/\/$/, "");
  return { appId, privateKey, apiBase };
}

export function isEnableBankingConfigured(): boolean {
  return loadCredentials() !== null;
}

export const ENABLE_BANKING_CALLBACK_PATH =
  "/api/accounting/enable-banking/callback";

/**
 * The redirect URL the HOA registers in its Enable Banking application.
 * Built from NEXTAUTH_URL → APP_URL only (never the Host header — a forged
 * host would send the authorization code to an attacker). Null when neither
 * is set.
 */
export function enableBankingRedirectUrl(): string | null {
  const configured =
    process.env.NEXTAUTH_URL?.trim() || process.env.APP_URL?.trim();
  if (!configured) return null;
  try {
    return `${new URL(configured).origin}${ENABLE_BANKING_CALLBACK_PATH}`;
  } catch {
    return null;
  }
}

/** Setup status for the settings guide — never exposes the key itself. */
export function getEnableBankingAppInfo(): {
  configured: boolean;
  appIdMasked: string | null;
  redirectUrl: string | null;
} {
  const creds = loadCredentials();
  const appId = creds?.appId ?? process.env.ENABLE_BANKING_APP_ID?.trim();
  return {
    configured: creds !== null,
    appIdMasked: appId
      ? appId.length > 8
        ? `${appId.slice(0, 4)}…${appId.slice(-4)}`
        : appId
      : null,
    redirectUrl: enableBankingRedirectUrl(),
  };
}

// ── HTTP ───────────────────────────────────────────────

export type EbFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface CallOpts {
  fetchImpl?: EbFetchLike;
  now?: Date;
}

async function call<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: CallOpts & { body?: unknown; expiredOnAuthError?: boolean }
): Promise<T> {
  const creds = loadCredentials();
  if (!creds) throw new EnableBankingError("EB_NOT_CONFIGURED");
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as EbFetchLike);
  let response;
  try {
    response = await fetchImpl(`${creds.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${signEnableBankingJwt(creds, opts.now)}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (err) {
    throw new EnableBankingError(
      "EB_API_ERROR",
      err instanceof Error ? err.message : String(err)
    );
  }
  if (!response.ok) {
    if (response.status === 429) throw new EnableBankingError("EB_RATE_LIMITED");
    if (
      opts.expiredOnAuthError &&
      (response.status === 401 || response.status === 403)
    ) {
      throw new EnableBankingError("EB_CONSENT_EXPIRED");
    }
    throw new EnableBankingError("EB_API_ERROR", `HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ── connection state ───────────────────────────────────

export interface EnableBankingState {
  configured: boolean;
  connected: boolean;
  aspspName: string | null;
  ibanMasked: string | null;
  validUntil: string | null;
  lastSyncAt: string | null;
  /** Non-null only while the treasurer still has to pick an account. */
  accountsToPick: { uid: string; ibanMasked: string | null; name: string | null }[] | null;
}

async function loadConnection(entityId: string) {
  const [row] = await db
    .select({
      id: bankConnections.id,
      token: bankConnections.token,
      config: bankConnections.config,
      validUntil: bankConnections.validUntil,
      lastSyncAt: bankConnections.lastSyncAt,
      isActive: bankConnections.isActive,
    })
    .from(bankConnections)
    .where(
      and(
        eq(bankConnections.entityId, entityId),
        eq(bankConnections.provider, "enable_banking")
      )
    );
  if (!row || !row.isActive) return null;
  return { ...row, config: row.config as EnableBankingConfig };
}

export async function getEnableBankingConnection(
  entityId: string
): Promise<EnableBankingState> {
  const configured = isEnableBankingConfigured();
  const row = await loadConnection(entityId);
  if (!row) {
    return {
      configured,
      connected: false,
      aspspName: null,
      ibanMasked: null,
      validUntil: null,
      lastSyncAt: null,
      accountsToPick: null,
    };
  }
  const selected = row.config.accounts.find(
    (a) => a.uid === row.config.accountUid
  );
  return {
    configured,
    connected: true,
    aspspName: row.config.aspspName,
    ibanMasked: maskIban(selected?.iban ?? null),
    validUntil: row.validUntil?.toISOString() ?? null,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    accountsToPick: row.config.accountUid
      ? null
      : row.config.accounts.map((a) => ({
          uid: a.uid,
          ibanMasked: maskIban(a.iban),
          name: a.name,
        })),
  };
}

// ── banks ──────────────────────────────────────────────

export async function listEnableBankingAspsps(
  country: Country,
  opts: CallOpts = {}
): Promise<EbAspsp[]> {
  const res = await call<{ aspsps?: EbAspsp[] }>(
    "GET",
    `/aspsps?country=${country.toUpperCase()}`,
    opts
  );
  return (res.aspsps ?? [])
    .filter((a) => a && typeof a.name === "string")
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── connect flow ───────────────────────────────────────

/**
 * Starts PSD2 authorization at the chosen bank. Returns the bank login URL
 * the browser is sent to. `state` is the CSRF nonce the route also stores in
 * a cookie and re-checks on the callback.
 */
export async function startEnableBankingAuth(
  input: {
    country: Country;
    aspspName: string;
    redirectUrl: string;
    state: string;
  },
  opts: CallOpts = {}
): Promise<string> {
  const now = opts.now ?? new Date();
  const aspsps = await listEnableBankingAspsps(input.country, opts);
  const aspsp = aspsps.find((a) => a.name === input.aspspName);
  if (!aspsp) throw new EnableBankingError("EB_UNKNOWN_BANK");

  const res = await call<{ url?: string }>("POST", "/auth", {
    ...opts,
    body: {
      access: {
        valid_until: consentValidUntil(
          now,
          aspsp.maximum_consent_validity
        ).toISOString(),
      },
      aspsp: { name: aspsp.name, country: aspsp.country },
      state: input.state,
      redirect_url: input.redirectUrl,
      psu_type: pickPsuType(aspsp),
    },
  });
  if (!res.url) throw new EnableBankingError("EB_INVALID_PAYLOAD", "auth url");
  return res.url;
}

async function domIban(entityId: string): Promise<string | null> {
  const [row] = await db
    .select({ bankIban: accountingSettings.bankIban })
    .from(accountingSettings)
    .where(
      and(
        eq(accountingSettings.entityId, entityId),
        sql`${accountingSettings.effectiveFrom} <= now()`
      )
    )
    .orderBy(sql`${accountingSettings.effectiveFrom} desc`)
    .limit(1);
  return row?.bankIban ?? null;
}

/**
 * Exchanges the callback code for a session and stores it. Replaces any
 * previous Enable Banking session of the dom (consent renewal) — the old
 * session is revoked best-effort. lastSyncAt is kept on renewal so the next
 * sync continues where the previous consent stopped.
 */
export async function completeEnableBankingAuth(
  input: {
    entityId: string;
    actorId: string;
    code: string;
    /** From the state cookie — used when the session omits `aspsp`. */
    aspspName: string;
    aspspCountry: string;
  },
  opts: CallOpts = {}
): Promise<EnableBankingState> {
  const session = await call<EbSessionResponse>("POST", "/sessions", {
    ...opts,
    body: { code: input.code },
  });
  if (!session.session_id) {
    throw new EnableBankingError("EB_INVALID_PAYLOAD", "session_id");
  }
  const accounts: StoredEbAccount[] = mapSessionAccounts(session);
  const aspspName = session.aspsp?.name || input.aspspName;
  const aspspCountry = session.aspsp?.country || input.aspspCountry;

  const previous = await loadConnection(input.entityId);
  const keepAccount =
    previous?.config.accountUid &&
    accounts.some((a) => a.uid === previous.config.accountUid)
      ? previous.config.accountUid
      : null;
  const config: EnableBankingConfig = {
    aspspName,
    aspspCountry,
    accountUid:
      keepAccount ?? pickAccountUid(accounts, await domIban(input.entityId)),
    accounts,
  };
  const validUntil = session.access?.valid_until
    ? new Date(session.access.valid_until)
    : null;

  await db.transaction(async (tx) => {
    await tx
      .insert(bankConnections)
      .values({
        entityId: input.entityId,
        provider: "enable_banking",
        token: session.session_id!,
        config,
        validUntil,
        isActive: true,
        createdById: input.actorId,
      })
      .onConflictDoUpdate({
        target: [bankConnections.entityId, bankConnections.provider],
        set: {
          token: session.session_id!,
          config,
          validUntil,
          isActive: true,
          // Fresh connection (was inactive / none) restarts the backfill.
          lastSyncAt: previous ? previous.lastSyncAt : null,
        },
      });
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_bank_connections",
      recordId: input.entityId,
      after: {
        provider: "enable_banking",
        aspspName,
        accounts: accounts.length,
        accountUid: config.accountUid,
        validUntil: validUntil?.toISOString() ?? null,
      },
      justification: previous ? "enable banking consent renewed" : "enable banking connected",
    });
  });

  if (previous && previous.token !== session.session_id) {
    await revokeSession(previous.token, opts);
  }
  return getEnableBankingConnection(input.entityId);
}

export async function selectEnableBankingAccount(input: {
  entityId: string;
  actorId: string;
  accountUid: string;
}): Promise<void> {
  const row = await loadConnection(input.entityId);
  if (!row) throw new EnableBankingError("EB_NOT_CONNECTED");
  if (!row.config.accounts.some((a) => a.uid === input.accountUid)) {
    throw new EnableBankingError("EB_UNKNOWN_ACCOUNT");
  }
  const config: EnableBankingConfig = {
    ...row.config,
    accountUid: input.accountUid,
  };
  await db.transaction(async (tx) => {
    await tx
      .update(bankConnections)
      .set({ config })
      .where(eq(bankConnections.id, row.id));
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_bank_connections",
      recordId: input.entityId,
      before: { accountUid: row.config.accountUid },
      after: { accountUid: input.accountUid },
      justification: "enable banking account selected",
    });
  });
}

async function revokeSession(sessionId: string, opts: CallOpts): Promise<void> {
  try {
    await call<void>("DELETE", `/sessions/${encodeURIComponent(sessionId)}`, opts);
  } catch {
    // Best effort — an expired/unknown session is already gone at the bank.
  }
}

/**
 * Undo path: revokes the session at Enable Banking (best effort) and
 * deactivates the connection. Imported payments stay — they are booked money.
 */
export async function disconnectEnableBanking(
  input: { entityId: string; actorId: string },
  opts: CallOpts = {}
): Promise<void> {
  const row = await loadConnection(input.entityId);
  if (!row) return;
  await revokeSession(row.token, opts);
  await db.transaction(async (tx) => {
    await tx
      .update(bankConnections)
      .set({ isActive: false, validUntil: null })
      .where(eq(bankConnections.id, row.id));
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_bank_connections",
      recordId: input.entityId,
      before: { provider: "enable_banking", aspspName: row.config.aspspName },
      after: { isActive: false },
      justification: "enable banking disconnected",
    });
  });
}

// ── sync ───────────────────────────────────────────────

/** Drops the per-line currency (already checked) before the DB insert. */
function toNormalizedLine(line: MappedEbLine): NormalizedBankLine {
  const { currency, ...rest } = line;
  void currency;
  return rest;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function syncEnableBanking(
  input: { entityId: string; country: Country; actorId: string },
  opts: CallOpts = {}
): Promise<ImportSummary> {
  const now = opts.now ?? new Date();
  const row = await loadConnection(input.entityId);
  if (!row) throw new EnableBankingError("EB_NOT_CONNECTED");
  if (!row.config.accountUid) {
    throw new EnableBankingError("EB_ACCOUNT_NOT_SELECTED");
  }
  if (row.validUntil && row.validUntil.getTime() <= now.getTime()) {
    throw new EnableBankingError("EB_CONSENT_EXPIRED");
  }

  const from = row.lastSyncAt
    ? new Date(row.lastSyncAt.getTime() - OVERLAP_DAYS * 24 * 3600 * 1000)
    : new Date(now.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 3600 * 1000);

  const transactions = [];
  let continuation: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ date_from: isoDate(from) });
    if (continuation) params.set("continuation_key", continuation);
    const res: EbTransactionsPage = await call<EbTransactionsPage>(
      "GET",
      `/accounts/${encodeURIComponent(row.config.accountUid)}/transactions?${params}`,
      { ...opts, expiredOnAuthError: true }
    );
    transactions.push(...(res.transactions ?? []));
    continuation = res.continuation_key || null;
    if (!continuation) break;
  }

  const mapped = mapEnableBankingTransactions(transactions);
  try {
    assertLedgerCurrency(input.country, mapped);
  } catch {
    throw new EnableBankingError("EB_CURRENCY_MISMATCH");
  }

  const summary = await importNormalizedLines({
    entityId: input.entityId,
    country: input.country,
    actorId: input.actorId,
    source: "enable_banking_api",
    lines: mapped.map(toNormalizedLine),
  });

  await db
    .update(bankConnections)
    .set({ lastSyncAt: now })
    .where(eq(bankConnections.id, row.id));

  return summary;
}
