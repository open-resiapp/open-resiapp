import "server-only";

import { readFileSync } from "node:fs";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingSettings,
  auditLog,
  bankAppCredentials,
  bankConnections,
  payments,
} from "../db/schema";
import {
  assertLedgerCurrency,
  importNormalizedLines,
  normalizeIban,
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
  type EnableBankingErrorCode,
  type EbSessionResponse,
  type EbTransactionsPage,
  type EnableBankingConfig,
  type MappedEbLine,
  type StoredEbAccount,
} from "./enable-banking-format";
import {
  isValidEnableBankingAppId,
  normalizeEnableBankingPrivateKey,
  signEnableBankingJwt,
} from "./enable-banking-jwt";
import { SecretBoxError, openSecret, sealSecret } from "@/lib/secret-box";

// Enable Banking PSD2 connector (BYT-20261118-001). Same shape as the Fio
// connector (fio.ts): per-dom row in mod_accounting_bank_connections, the
// shared import pipeline, an injectable HTTP layer for tests. App-level
// credentials — one Enable Banking application per instance — come from env
// (cloud: injected secret) or, when env is empty, from the admin-entered,
// encrypted row in mod_accounting_bank_app_credentials (self-host).
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

type CredentialSource = "env" | "db";

function apiBase(): string {
  return (
    process.env.ENABLE_BANKING_API_URL?.trim() || ENABLE_BANKING_API
  ).replace(/\/$/, "");
}

/** Env credentials (cloud-injected / self-host env). Win over the DB row. */
function envCredentials(): AppCredentials | null {
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
  return { appId, privateKey, apiBase: apiBase() };
}

/** True when the instance env carries Enable Banking app credentials. */
function envManaged(): boolean {
  return Boolean(process.env.ENABLE_BANKING_APP_ID?.trim());
}

async function loadCredentialRow() {
  const [row] = await db
    .select({
      id: bankAppCredentials.id,
      appId: bankAppCredentials.appId,
      privateKeyEnc: bankAppCredentials.privateKeyEnc,
      keyFingerprint: bankAppCredentials.keyFingerprint,
      updatedAt: bankAppCredentials.updatedAt,
    })
    .from(bankAppCredentials)
    .where(eq(bankAppCredentials.provider, "enable_banking"));
  return row ?? null;
}

/**
 * Resolves the app credentials: env first, then the admin-entered DB row.
 * A row that no longer decrypts (AUTH_SECRET rotated) counts as missing —
 * the settings page asks the admin to enter the key again.
 */
async function loadCredentials(): Promise<AppCredentials | null> {
  if (envManaged()) return envCredentials();
  const row = await loadCredentialRow();
  if (!row) return null;
  try {
    return {
      appId: row.appId,
      privateKey: openSecret(row.privateKeyEnc, KEY_PURPOSE),
      apiBase: apiBase(),
    };
  } catch (err) {
    if (err instanceof SecretBoxError) return null;
    throw err;
  }
}

const KEY_PURPOSE = "enable-banking-private-key" as const;

export async function isEnableBankingConfigured(): Promise<boolean> {
  return (await loadCredentials()) !== null;
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

function maskAppId(appId: string | null | undefined): string | null {
  if (!appId) return null;
  return appId.length > 8 ? `${appId.slice(0, 4)}…${appId.slice(-4)}` : appId;
}

export interface EnableBankingAppInfo {
  configured: boolean;
  /** Where the credentials come from; null = none entered yet. */
  source: CredentialSource | null;
  appIdMasked: string | null;
  keyFingerprint: string | null;
  updatedAt: string | null;
  /** DB row exists but no longer decrypts (AUTH_SECRET changed). */
  keyUnreadable: boolean;
  redirectUrl: string | null;
}

/** Setup status for the settings page — never exposes the key itself. */
export async function getEnableBankingAppInfo(): Promise<EnableBankingAppInfo> {
  const redirectUrl = enableBankingRedirectUrl();
  if (envManaged()) {
    const creds = envCredentials();
    return {
      configured: creds !== null,
      source: "env",
      appIdMasked: maskAppId(process.env.ENABLE_BANKING_APP_ID?.trim()),
      keyFingerprint: null,
      updatedAt: null,
      keyUnreadable: false,
      redirectUrl,
    };
  }
  const row = await loadCredentialRow();
  if (!row) {
    return {
      configured: false,
      source: null,
      appIdMasked: null,
      keyFingerprint: null,
      updatedAt: null,
      keyUnreadable: false,
      redirectUrl,
    };
  }
  let readable = true;
  try {
    openSecret(row.privateKeyEnc, KEY_PURPOSE);
  } catch {
    readable = false;
  }
  return {
    configured: readable,
    source: "db",
    appIdMasked: maskAppId(row.appId),
    keyFingerprint: row.keyFingerprint,
    updatedAt: row.updatedAt.toISOString(),
    keyUnreadable: !readable,
    redirectUrl,
  };
}

// ── HTTP ───────────────────────────────────────────────

export type EbFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

interface CallOpts {
  fetchImpl?: EbFetchLike;
  now?: Date;
}

async function call<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: CallOpts & {
    body?: unknown;
    /** Code thrown on 401/403 (default: generic EB_API_ERROR). */
    authErrorCode?: EnableBankingErrorCode;
    /** Explicit credentials (credential check before saving). */
    creds?: AppCredentials;
  }
): Promise<T> {
  const creds = opts.creds ?? (await loadCredentials());
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
      opts.authErrorCode &&
      (response.status === 401 || response.status === 403)
    ) {
      throw new EnableBankingError(opts.authErrorCode);
    }
    throw new EnableBankingError("EB_API_ERROR", `HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ── app credentials (admin) ────────────────────────────

export interface EnableBankingCredentialCheck {
  /** Enable Banking says the application is active (restricted or full). */
  appActive: boolean | null;
  /** Our callback URL is among the app's registered redirect URLs. */
  redirectRegistered: boolean | null;
  environment: string | null;
}

/**
 * Admin enters the app id + private key in Pokročilé → Prepojenie s bankou.
 * The pair is verified against Enable Banking (GET /application — a bad key
 * or a wrong app id is rejected there) BEFORE anything is stored; the key is
 * stored encrypted. Returns the application status so the UI can warn about
 * an inactive app or an unregistered redirect URL (both fixable later in the
 * Enable Banking control panel, so they do not block saving).
 */
export async function saveEnableBankingCredentials(
  input: {
    entityId: string;
    actorId: string;
    appId: string;
    privateKey: string;
  },
  opts: CallOpts = {}
): Promise<EnableBankingCredentialCheck> {
  if (envManaged()) throw new EnableBankingError("EB_CREDENTIALS_FROM_ENV");
  const appId = input.appId.trim();
  if (!isValidEnableBankingAppId(appId)) {
    throw new EnableBankingError("EB_INVALID_APP_ID");
  }
  const { pem, fingerprint } = normalizeEnableBankingPrivateKey(input.privateKey);

  let sealed: string;
  try {
    sealed = sealSecret(pem, KEY_PURPOSE);
  } catch (err) {
    if (err instanceof SecretBoxError) {
      throw new EnableBankingError("EB_SECRET_UNAVAILABLE");
    }
    throw err;
  }

  const app = await call<{
    active?: boolean;
    redirect_urls?: string[];
    environment?: string;
  }>("GET", "/application", {
    ...opts,
    creds: { appId, privateKey: pem, apiBase: apiBase() },
    authErrorCode: "EB_CREDENTIALS_REJECTED",
  });
  const redirectUrl = enableBankingRedirectUrl();
  const check: EnableBankingCredentialCheck = {
    appActive: typeof app?.active === "boolean" ? app.active : null,
    redirectRegistered:
      redirectUrl && Array.isArray(app?.redirect_urls)
        ? app.redirect_urls.includes(redirectUrl)
        : null,
    environment: typeof app?.environment === "string" ? app.environment : null,
  };

  const now = opts.now ?? new Date();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(bankAppCredentials)
      .values({
        provider: "enable_banking",
        appId,
        privateKeyEnc: sealed,
        keyFingerprint: fingerprint,
        updatedById: input.actorId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: bankAppCredentials.provider,
        set: {
          appId,
          privateKeyEnc: sealed,
          keyFingerprint: fingerprint,
          updatedById: input.actorId,
          updatedAt: now,
        },
      })
      .returning({ id: bankAppCredentials.id });
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_bank_app_credentials",
      recordId: row.id,
      // Never the key — fingerprint + masked id only.
      after: {
        provider: "enable_banking",
        appId: maskAppId(appId),
        keyFingerprint: fingerprint,
        environment: check.environment,
      },
      justification: "enable banking app credentials saved",
    });
  });
  return check;
}

/**
 * Undo path: deletes the stored credentials. An existing bank connection
 * stays in the DB but cannot sync until credentials are entered again
 * (same app → it keeps working; another app → reconnect the bank).
 */
export async function deleteEnableBankingCredentials(input: {
  entityId: string;
  actorId: string;
}): Promise<void> {
  if (envManaged()) throw new EnableBankingError("EB_CREDENTIALS_FROM_ENV");
  const row = await loadCredentialRow();
  if (!row) return;
  await db.transaction(async (tx) => {
    await tx.delete(bankAppCredentials).where(eq(bankAppCredentials.id, row.id));
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "delete",
      tableName: "mod_accounting_bank_app_credentials",
      recordId: row.id,
      before: {
        provider: "enable_banking",
        appId: maskAppId(row.appId),
        keyFingerprint: row.keyFingerprint,
      },
      justification: "enable banking app credentials removed",
    });
  });
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
  const configured = await isEnableBankingConfigured();
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
 * The synced account must be the dom's configured collection account (same
 * rule as the camt.053 upload). Only refuses when BOTH IBANs are known — a
 * bank that does not report the account IBAN cannot be checked.
 */
function assertAccountMatchesDom(
  account: StoredEbAccount | undefined,
  configuredIban: string | null
): void {
  const wanted = normalizeIban(configuredIban);
  const actual = normalizeIban(account?.iban);
  if (wanted && actual && wanted !== actual) {
    throw new EnableBankingError("EB_IBAN_MISMATCH");
  }
}

/**
 * First-sync start: never reach back before money other bank channels
 * (camt.053 upload, Fio) already imported — the 90-day backfill would
 * otherwise re-import the same movements under eb:… ids and credit units
 * twice. The latest such day itself is included (content dedupe in the
 * import pipeline catches same-day overlap).
 */
async function otherSourcesImportedUntil(entityId: string): Promise<Date | null> {
  const [row] = await db
    .select({ receivedAt: payments.receivedAt })
    .from(payments)
    .where(
      and(
        eq(payments.entityId, entityId),
        inArray(payments.source, ["bank_import", "fio_api"]),
        isNull(payments.voidedAt)
      )
    )
    .orderBy(desc(payments.receivedAt))
    .limit(1);
  return row?.receivedAt ?? null;
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
  const configuredIban = await domIban(input.entityId);
  const keepAccount =
    previous?.config.accountUid &&
    accounts.some((a) => a.uid === previous.config.accountUid)
      ? previous.config.accountUid
      : null;
  const config: EnableBankingConfig = {
    aspspName,
    aspspCountry,
    accountUid: keepAccount ?? pickAccountUid(accounts, configuredIban),
    accounts,
    // Continuation keys are session-bound — a renewal resumes from
    // lastSyncAt (minus overlap) instead.
    syncCursor: null,
  };
  // lastSyncAt belongs to the account it was synced from: a different
  // account (or a fresh connection) restarts the backfill.
  const keepLastSyncAt =
    previous && previous.config.accountUid === config.accountUid
      ? previous.lastSyncAt
      : null;
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
          // Fresh connection (was inactive / none) or another account
          // restarts the backfill.
          lastSyncAt: keepLastSyncAt,
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
  const account = row.config.accounts.find((a) => a.uid === input.accountUid);
  if (!account) {
    throw new EnableBankingError("EB_UNKNOWN_ACCOUNT");
  }
  assertAccountMatchesDom(account, await domIban(input.entityId));
  const changed = row.config.accountUid !== input.accountUid;
  const config: EnableBankingConfig = {
    ...row.config,
    accountUid: input.accountUid,
    syncCursor: changed ? null : (row.config.syncCursor ?? null),
  };
  await db.transaction(async (tx) => {
    await tx
      .update(bankConnections)
      // A different account has its own history — restart the backfill.
      .set(changed ? { config, lastSyncAt: null } : { config })
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

  const account = row.config.accounts.find(
    (a) => a.uid === row.config.accountUid
  );
  assertAccountMatchesDom(account, await domIban(input.entityId));

  // Resume a sync that stopped at the page cap; else overlap from the last
  // completed sync; else the first-sync backfill (bounded by what other
  // bank channels already imported).
  const cursor = row.config.syncCursor ?? null;
  let fromDay: string;
  if (cursor) {
    fromDay = cursor.dateFrom;
  } else if (row.lastSyncAt) {
    fromDay = isoDate(
      new Date(row.lastSyncAt.getTime() - OVERLAP_DAYS * 24 * 3600 * 1000)
    );
  } else {
    const backfill = new Date(
      now.getTime() - DEFAULT_BACKFILL_DAYS * 24 * 3600 * 1000
    );
    const otherUntil = await otherSourcesImportedUntil(input.entityId);
    fromDay = isoDate(
      otherUntil && otherUntil.getTime() > backfill.getTime()
        ? otherUntil
        : backfill
    );
  }

  const transactions = [];
  let continuation: string | null = cursor?.continuationKey ?? null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ date_from: fromDay });
    if (continuation) params.set("continuation_key", continuation);
    let res: EbTransactionsPage;
    try {
      res = await call<EbTransactionsPage>(
        "GET",
        `/accounts/${encodeURIComponent(row.config.accountUid)}/transactions?${params}`,
        { ...opts, authErrorCode: "EB_CONSENT_EXPIRED" }
      );
    } catch (err) {
      // A stale continuation key must not wedge the connection: drop the
      // cursor (lastSyncAt was never advanced) so the next sync refetches.
      if (cursor && page === 0) {
        await db
          .update(bankConnections)
          .set({ config: { ...row.config, syncCursor: null } })
          .where(eq(bankConnections.id, row.id));
      }
      throw err;
    }
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

  if (continuation) {
    // Page cap hit with more data at the bank: keep lastSyncAt where it was
    // and park the continuation key — the next sync picks up exactly here.
    await db
      .update(bankConnections)
      .set({
        config: {
          ...row.config,
          syncCursor: { dateFrom: fromDay, continuationKey: continuation },
        },
      })
      .where(eq(bankConnections.id, row.id));
  } else {
    await db
      .update(bankConnections)
      .set({
        lastSyncAt: now,
        config: { ...row.config, syncCursor: null },
      })
      .where(eq(bankConnections.id, row.id));
  }

  return summary;
}
