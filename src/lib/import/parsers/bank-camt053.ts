// CAMT.053 bank-statement parser (BYT-20260512-002 Phase 2).
// Pure function, no DB access — one XML parser covers all SK banks (SBA
// XMLStatement profile) and the ČBA CZ dialect; per-bank CSV is a
// non-goal (spec decision "CAMT.053 first, per-bank CSV never").
//
// Contract:
//   parseCamt053(xml) → Camt053Statement[] (throws Camt053ParseError on
//   structurally invalid input; tolerates missing optional fields)
//
// VS/ŠS/KS extraction, in priority order:
//   1. EndToEndId in the SBA slash notation  /VS0000000123/SS0000000000/KS0308
//   2. CdtrRefInf/Ref (SEPA creditor reference carrying the same notation)
//   3. RmtInf/Ustrd free text (same regex, anywhere in the string)
// Amounts parse from the XML decimal string straight to integer cents —
// no float math on money.

import { XMLParser } from "fast-xml-parser";

export class Camt053ParseError extends Error {}

export interface Camt053Transaction {
  /** Bank-issued id (AcctSvcrRef) — the import idempotency key. */
  externalTxId: string | null;
  amountCents: number;
  currency: string;
  /** credit = money in (owner payment), debit = money out. */
  direction: "credit" | "debit";
  /** ISO date (YYYY-MM-DD). */
  bookingDate: string | null;
  valueDate: string | null;
  vs: string | null;
  ss: string | null;
  ks: string | null;
  counterpartyIban: string | null;
  counterpartyName: string | null;
  narrative: string | null;
  endToEndId: string | null;
}

export interface Camt053Statement {
  /** The account the statement is FOR. */
  iban: string | null;
  statementId: string | null;
  fromDate: string | null;
  toDate: string | null;
  openingBalanceCents: number | null;
  closingBalanceCents: number | null;
  currency: string | null;
  transactions: Camt053Transaction[];
}

// ── helpers ────────────────────────────────────────────

/** "1234.56" | "1234" → integer cents; throws on malformed. */
export function xmlAmountToCents(raw: string): number {
  const cleaned = String(raw).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Camt053ParseError(`invalid amount "${raw}"`);
  }
  const [whole, frac = ""] = cleaned.split(".");
  const sign = whole.startsWith("-") ? -1 : 1;
  const wholeAbs = Math.abs(parseInt(whole, 10));
  return sign * (wholeAbs * 100 + parseInt(frac.padEnd(2, "0") || "0", 10));
}

const SYMBOLS_RE =
  /\/VS(\d{0,10})\/SS(\d{0,10})\/KS(\d{0,4})/i;

interface Symbols {
  vs: string | null;
  ss: string | null;
  ks: string | null;
}

/** Strips leading zeros the banks pad symbols with; "" and "000" → null. */
function cleanSymbol(raw: string | undefined): string | null {
  if (!raw) return null;
  const stripped = raw.replace(/^0+/, "");
  return stripped === "" ? null : stripped;
}

export function extractSymbols(text: string | null | undefined): Symbols {
  if (!text) return { vs: null, ss: null, ks: null };
  const m = SYMBOLS_RE.exec(text);
  if (!m) return { vs: null, ss: null, ks: null };
  return {
    vs: cleanSymbol(m[1]),
    ss: cleanSymbol(m[2]),
    ks: cleanSymbol(m[3]),
  };
}

/** fast-xml-parser returns object or array depending on cardinality. */
function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "object") {
    const t = (value as Record<string, unknown>)["#text"];
    return t === undefined || t === null ? null : String(t);
  }
  return String(value);
}

// ── parser ─────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

function parseBalance(bals: any[], codes: string[]): {
  cents: number | null;
  currency: string | null;
} {
  for (const bal of bals) {
    const code = text(bal?.Tp?.CdOrPrtry?.Cd);
    if (!code || !codes.includes(code)) continue;
    const amount = bal?.Amt;
    if (amount === undefined) continue;
    const cents = xmlAmountToCents(text(amount) ?? "");
    const sign = text(bal?.CdtDbtInd) === "DBIT" ? -1 : 1;
    return {
      cents: sign * cents,
      currency: amount?.["@_Ccy"] ?? null,
    };
  }
  return { cents: null, currency: null };
}

function parseTransaction(entry: any): Camt053Transaction[] {
  const direction: "credit" | "debit" =
    text(entry?.CdtDbtInd) === "DBIT" ? "debit" : "credit";
  const bookingDate = text(entry?.BookgDt?.Dt);
  const valueDate = text(entry?.ValDt?.Dt);
  const entryAmount = entry?.Amt;
  const entryCurrency: string | null = entryAmount?.["@_Ccy"] ?? null;

  const details = asArray(entry?.NtryDtls).flatMap((d: any) =>
    asArray(d?.TxDtls)
  );
  if (details.length === 0) {
    // Entry without transaction details — keep the entry-level data.
    if (entryAmount === undefined) {
      throw new Camt053ParseError("entry without amount");
    }
    return [
      {
        externalTxId: text(entry?.AcctSvcrRef),
        amountCents: xmlAmountToCents(text(entryAmount) ?? ""),
        currency: entryCurrency ?? "EUR",
        direction,
        bookingDate,
        valueDate,
        vs: null,
        ss: null,
        ks: null,
        counterpartyIban: null,
        counterpartyName: null,
        narrative: null,
        endToEndId: null,
      },
    ];
  }

  return details.map((tx: any) => {
    const refs = tx?.Refs;
    const endToEndRaw = text(refs?.EndToEndId);
    // SEPA fills "NOTPROVIDED" when the ordering party gave no reference.
    const endToEndId =
      endToEndRaw && endToEndRaw !== "NOTPROVIDED" ? endToEndRaw : null;

    const ustrd = asArray(tx?.RmtInf?.Ustrd)
      .map((u: any) => text(u))
      .filter(Boolean)
      .join(" ");
    const cdtrRef = text(tx?.RmtInf?.Strd?.CdtrRefInf?.Ref);

    let symbols = extractSymbols(endToEndId);
    if (!symbols.vs && !symbols.ss && !symbols.ks) {
      symbols = extractSymbols(cdtrRef);
    }
    if (!symbols.vs && !symbols.ss && !symbols.ks) {
      symbols = extractSymbols(ustrd);
    }

    // Counterparty: for incoming money (credit) it is the debtor side.
    const parties = tx?.RltdPties;
    const party = direction === "credit" ? parties?.Dbtr : parties?.Cdtr;
    const partyAccount =
      direction === "credit" ? parties?.DbtrAcct : parties?.CdtrAcct;
    // camt.053 v8+ nests the name under Pty.
    const counterpartyName = text(party?.Nm) ?? text(party?.Pty?.Nm);
    const counterpartyIban = text(partyAccount?.Id?.IBAN);

    const txAmount = tx?.Amt ?? tx?.AmtDtls?.TxAmt?.Amt ?? entryAmount;
    if (txAmount === undefined) {
      throw new Camt053ParseError("transaction without amount");
    }

    return {
      externalTxId: text(refs?.AcctSvcrRef) ?? text(entry?.AcctSvcrRef),
      amountCents: xmlAmountToCents(text(txAmount) ?? ""),
      currency: txAmount?.["@_Ccy"] ?? entryCurrency ?? "EUR",
      direction,
      bookingDate,
      valueDate,
      vs: symbols.vs,
      ss: symbols.ss,
      ks: symbols.ks,
      counterpartyIban,
      counterpartyName,
      narrative: ustrd || null,
      endToEndId,
    };
  });
}

export function parseCamt053(xml: string): Camt053Statement[] {
  let doc: any;
  try {
    doc = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: false,
      parseAttributeValue: false,
      trimValues: true,
      removeNSPrefix: true,
    }).parse(xml);
  } catch (err) {
    throw new Camt053ParseError(
      `not valid XML: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const root = doc?.Document?.BkToCstmrStmt;
  if (!root) {
    throw new Camt053ParseError(
      "not a camt.053 document (missing BkToCstmrStmt)"
    );
  }

  const statements = asArray(root.Stmt);
  if (statements.length === 0) {
    throw new Camt053ParseError("camt.053 document has no statements");
  }

  return statements.map((stmt: any) => {
    const bals = asArray(stmt?.Bal);
    // OPBD/PRCD = opening (previous closing), CLBD = closing booked.
    const opening = parseBalance(bals, ["OPBD", "PRCD"]);
    const closing = parseBalance(bals, ["CLBD"]);

    const transactions = asArray(stmt?.Ntry).flatMap((entry: any) =>
      parseTransaction(entry)
    );

    return {
      iban: text(stmt?.Acct?.Id?.IBAN),
      statementId: text(stmt?.Id),
      fromDate: text(stmt?.FrToDt?.FrDtTm)?.slice(0, 10) ?? null,
      toDate: text(stmt?.FrToDt?.ToDtTm)?.slice(0, 10) ?? null,
      openingBalanceCents: opening.cents,
      closingBalanceCents: closing.cents,
      currency: opening.currency ?? closing.currency,
      transactions,
    };
  });
}
