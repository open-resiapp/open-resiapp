// Fio JSON → shared import shape (BYT-20260512-002 Phase 2).
// PURE module — no server imports, so the golden checks (tsx) and any
// client code can load it. The connector (fio.ts) wraps it with storage
// and the injectable HTTP layer.

import type { NormalizedBankLine } from "./bank-import";

const FIO_BASE = "https://fioapi.fio.cz/v1/rest";

// ── pure mapping ───────────────────────────────────────

/** Fio column model: { value } wrappers, numbered per their docs. */
interface FioColumn {
  value: unknown;
}
interface FioTransaction {
  column0?: FioColumn | null; // Datum (YYYY-MM-DD+ZZZZ)
  column1?: FioColumn | null; // Objem (number)
  column2?: FioColumn | null; // Protiúčet (account number)
  column3?: FioColumn | null; // Kód banky
  column4?: FioColumn | null; // KS
  column5?: FioColumn | null; // VS
  column6?: FioColumn | null; // ŠS
  column10?: FioColumn | null; // Název protiúčtu
  column14?: FioColumn | null; // Měna
  column16?: FioColumn | null; // Zpráva pro příjemce
  column22?: FioColumn | null; // ID pohybu
}

export interface FioStatementJson {
  accountStatement?: {
    info?: { currency?: string; iban?: string };
    transactionList?: { transaction?: FioTransaction[] };
  };
}

function col(tx: FioTransaction, key: keyof FioTransaction): string | null {
  const value = tx[key]?.value;
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

/** Fio "Objem" is a signed decimal number → integer cents, exact. */
export function fioAmountToCents(value: unknown): number {
  const raw = String(value);
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Error(`accounting: invalid Fio amount "${raw}"`);
  }
  const [whole, frac = ""] = raw.split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  return (
    sign *
    (Math.abs(parseInt(whole, 10)) * 100 +
      parseInt(frac.padEnd(2, "0") || "0", 10))
  );
}

/**
 * Maps the Fio JSON payload to the shared import shape. Pure — exported
 * for the golden checks. Currency comes from account info (Fio serves
 * one account per token).
 */
export function mapFioTransactions(json: FioStatementJson): {
  currency: string | null;
  lines: NormalizedBankLine[];
} {
  const statement = json.accountStatement;
  if (!statement) {
    throw new Error("accounting: not a Fio transactions payload");
  }
  const currency = statement.info?.currency ?? null;
  const transactions = statement.transactionList?.transaction ?? [];

  const lines: NormalizedBankLine[] = transactions.map((tx) => {
    const id = col(tx, "column22");
    if (!id) {
      throw new Error("accounting: Fio transaction without ID pohybu");
    }
    const signedCents = fioAmountToCents(tx.column1?.value ?? "");
    const date = col(tx, "column0")?.slice(0, 10) ?? null;
    const account = col(tx, "column2");
    const bankCode = col(tx, "column3");

    return {
      externalTxId: `fio:${id}`,
      amountCents: Math.abs(signedCents),
      direction: signedCents >= 0 ? "credit" : "debit",
      bookingDate: date,
      valueDate: date,
      vs: col(tx, "column5")?.replace(/^0+/, "") || null,
      ss: col(tx, "column6")?.replace(/^0+/, "") || null,
      ks: col(tx, "column4")?.replace(/^0+/, "") || null,
      // Fio gives domestic account/bank-code, not IBAN — keep the pair as
      // an identifier string; IBAN-based matching simply won't fire.
      counterpartyIban:
        account && bankCode ? `${account}/${bankCode}` : account,
      counterpartyName: col(tx, "column10"),
      narrative: col(tx, "column16"),
    };
  });

  return { currency, lines };
}

export function fioTransactionsUrl(
  token: string,
  from: string,
  to: string
): string {
  return `${FIO_BASE}/periods/${encodeURIComponent(token)}/${from}/${to}/transactions.json`;
}

