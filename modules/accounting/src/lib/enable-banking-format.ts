// Enable Banking JSON → shared import shape (BYT-20261118-001).
// PURE module — no server imports, so the golden check (tsx) and client
// code can load it. The connector (enable-banking.ts) wraps it with storage,
// JWT signing and the injectable HTTP layer.
//
// Errors are stable CODES (EnableBankingError.code); the route returns the
// code and the UI maps it to `Accounting.reconciliation.ebErrors.<code>`.

import type { NormalizedBankLine } from "./bank-import";
import { extractSymbols } from "@/lib/import/parsers/bank-camt053";
import { EnableBankingError } from "./enable-banking-errors";

export const ENABLE_BANKING_API = "https://api.enablebanking.com";

export {
  EB_ERROR_CODES,
  EnableBankingError,
  isEnableBankingErrorCode,
  type EnableBankingErrorCode,
} from "./enable-banking-errors";

// ── API payload shapes (subset we read) ────────────────

export interface EbAmount {
  amount?: string | number | null;
  currency?: string | null;
}

export interface EbAccountRef {
  iban?: string | null;
  other?: { identification?: string | null } | null;
}

export interface EbParty {
  name?: string | null;
}

export interface EbTransaction {
  transaction_id?: string | null;
  entry_reference?: string | null;
  transaction_amount?: EbAmount | null;
  credit_debit_indicator?: "CRDT" | "DBIT" | string | null;
  status?: "BOOK" | "PDNG" | string | null;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: EbParty | null;
  creditor_account?: EbAccountRef | null;
  debtor?: EbParty | null;
  debtor_account?: EbAccountRef | null;
  reference_number?: string | null;
  remittance_information?: string[] | null;
  note?: string | null;
}

export interface EbTransactionsPage {
  transactions?: EbTransaction[] | null;
  continuation_key?: string | null;
}

export interface EbSessionAccount {
  uid?: string | null;
  account_id?: EbAccountRef | null;
  name?: string | null;
  currency?: string | null;
}

export interface EbSessionResponse {
  session_id?: string | null;
  accounts?: (EbSessionAccount | string)[] | null;
  accounts_data?: EbSessionAccount[] | null;
  access?: { valid_until?: string | null } | null;
  aspsp?: { name?: string | null; country?: string | null } | null;
}

export interface EbAspsp {
  name: string;
  country: string;
  logo?: string | null;
  maximum_consent_validity?: number | null;
  psu_types?: string[] | null;
}

/** Account as we store it in bank_connections.config.accounts. */
export interface StoredEbAccount {
  uid: string;
  iban: string | null;
  name: string | null;
  currency: string | null;
}

export interface EnableBankingConfig {
  aspspName: string;
  aspspCountry: string;
  accountUid: string | null;
  accounts: StoredEbAccount[];
  /**
   * Set when a sync stopped at the page cap with more data at the bank. The
   * next sync resumes from this continuation key (same date_from) instead of
   * advancing lastSyncAt past transactions it never fetched.
   */
  syncCursor?: { dateFrom: string; continuationKey: string } | null;
}

// ── amounts ────────────────────────────────────────────

/** Decimal string ("12.3", "-12.30", 87) → signed integer cents, exact. */
export function ebAmountToCents(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new EnableBankingError("EB_INVALID_AMOUNT", raw);
  }
  const [whole, frac = ""] = raw.split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  return (
    sign *
    (Math.abs(parseInt(whole, 10)) * 100 +
      parseInt(frac.padEnd(2, "0") || "0", 10))
  );
}

// ── symbols ────────────────────────────────────────────

const FREE_VS_RE = /(?:^|[^A-Z0-9])VS[\s:.\-#]*0*(\d{1,10})(?!\d)/i;

/**
 * VS/ŠS/KS, priority: SBA slash notation in reference_number, then in each
 * remittance line, then a free-text "VS 123" / "VS:123" in the remittance.
 */
export function ebSymbols(tx: EbTransaction): {
  vs: string | null;
  ss: string | null;
  ks: string | null;
} {
  const candidates = [
    tx.reference_number ?? null,
    ...(tx.remittance_information ?? []),
  ].filter((v): v is string => typeof v === "string" && v.trim() !== "");

  for (const text of candidates) {
    const sym = extractSymbols(text);
    if (sym.vs || sym.ss || sym.ks) return sym;
  }
  for (const text of candidates) {
    const m = FREE_VS_RE.exec(text);
    if (m) return { vs: m[1].replace(/^0+/, "") || null, ss: null, ks: null };
  }
  return { vs: null, ss: null, ks: null };
}

// ── mapping ────────────────────────────────────────────

function iban(ref: EbAccountRef | null | undefined): string | null {
  const v = ref?.iban ?? ref?.other?.identification ?? null;
  return v ? v.replace(/\s+/g, "").toUpperCase() : null;
}

function isoDay(value: string | null | undefined): string | null {
  return value ? value.slice(0, 10) : null;
}

/**
 * Stable fallback key when the bank gives neither transaction_id nor
 * entry_reference. FNV-1a over the fields that identify the line — not a
 * security hash, only a dedupe key. Two identical payments on the same day
 * from the same account with the same text WILL collide (documented gap;
 * spec §Mapping).
 */
function fallbackKey(parts: (string | number | null)[]): string {
  let h = 0x811c9dc5;
  const s = parts.map((p) => (p === null ? "" : String(p))).join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface MappedEbLine extends NormalizedBankLine {
  currency: string | null;
}

/**
 * Maps Enable Banking transactions to the shared import shape. Booked lines
 * only — pending lines are skipped so a PDNG→BOOK transition (often with a
 * new id) never imports twice.
 */
export function mapEnableBankingTransactions(
  transactions: EbTransaction[]
): MappedEbLine[] {
  const lines: MappedEbLine[] = [];
  for (const tx of transactions) {
    const status = tx.status ?? "BOOK";
    if (status !== "BOOK") continue;

    const signed = ebAmountToCents(tx.transaction_amount?.amount);
    const indicator = tx.credit_debit_indicator;
    const direction: "credit" | "debit" =
      indicator === "CRDT"
        ? "credit"
        : indicator === "DBIT"
          ? "debit"
          : signed >= 0
            ? "credit"
            : "debit";
    const amountCents = Math.abs(signed);

    const counterparty =
      direction === "credit"
        ? { name: tx.debtor?.name ?? null, iban: iban(tx.debtor_account) }
        : { name: tx.creditor?.name ?? null, iban: iban(tx.creditor_account) };

    const bookingDate = isoDay(tx.booking_date ?? tx.transaction_date);
    const narrativeParts = (tx.remittance_information ?? []).filter(Boolean);
    const narrative =
      narrativeParts.length > 0
        ? narrativeParts.join(" ")
        : (tx.note ?? null);

    const bankId = tx.transaction_id || tx.entry_reference;
    const externalTxId = bankId
      ? `eb:${bankId}`
      : `eb:h:${fallbackKey([
          bookingDate,
          amountCents,
          direction,
          counterparty.iban,
          tx.reference_number ?? null,
          narrative,
        ])}`;

    lines.push({
      externalTxId,
      amountCents,
      direction,
      bookingDate,
      valueDate: isoDay(tx.value_date) ?? bookingDate,
      ...ebSymbols(tx),
      counterpartyIban: counterparty.iban,
      counterpartyName: counterparty.name,
      narrative,
      currency: tx.transaction_amount?.currency ?? null,
    });
  }
  return lines;
}

/** Normalizes the two session shapes (accounts as objects or as uids). */
export function mapSessionAccounts(
  session: EbSessionResponse
): StoredEbAccount[] {
  const data = new Map<string, EbSessionAccount>();
  for (const a of session.accounts_data ?? []) {
    if (a.uid) data.set(a.uid, a);
  }
  const out: StoredEbAccount[] = [];
  for (const entry of session.accounts ?? []) {
    const account =
      typeof entry === "string" ? (data.get(entry) ?? { uid: entry }) : entry;
    if (!account.uid) continue;
    out.push({
      uid: account.uid,
      iban: iban(account.account_id),
      name: account.name ?? null,
      currency: account.currency ?? null,
    });
  }
  return out;
}

/**
 * The account to sync: the one whose IBAN equals the dom's configured bank
 * IBAN, else the only one (unless its known IBAN differs from the configured
 * one), else null (the treasurer picks).
 */
export function pickAccountUid(
  accounts: StoredEbAccount[],
  domIban: string | null
): string | null {
  const wanted = domIban?.replace(/\s+/g, "").toUpperCase() || null;
  if (wanted) {
    const hit = accounts.find((a) => a.iban === wanted);
    if (hit) return hit.uid;
  }
  if (accounts.length !== 1) return null;
  // A lone account whose IBAN is known and differs from the configured one
  // is NOT auto-selected — sync would refuse it (EB_IBAN_MISMATCH) anyway.
  const only = accounts[0];
  if (wanted && only.iban && only.iban !== wanted) return null;
  return only.uid;
}

/** PSD2 consent length: the bank's maximum, capped at 180 days. */
export function consentValidUntil(
  now: Date,
  maximumConsentValiditySeconds: number | null | undefined
): Date {
  const cap = 180 * 24 * 3600;
  const seconds =
    maximumConsentValiditySeconds && maximumConsentValiditySeconds > 0
      ? Math.min(maximumConsentValiditySeconds, cap)
      : cap;
  return new Date(now.getTime() + seconds * 1000);
}

export function pickPsuType(aspsp: EbAspsp): "business" | "personal" {
  const types = aspsp.psu_types ?? [];
  if (types.length === 0 || types.includes("business")) return "business";
  return "personal";
}

/** "SK96…9669" → "SK96 •••• 9669" for display. */
export function maskIban(value: string | null): string | null {
  if (!value) return null;
  return value.length <= 8
    ? value
    : `${value.slice(0, 4)} •••• ${value.slice(-4)}`;
}
