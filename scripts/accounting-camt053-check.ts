/**
 * BYT-20260512-002 Phase 2 — CAMT.053 parser check
 * (run: `pnpm test:accounting-camt053`).
 *
 * Pure-function fixture tests: SBA SK profile + ČBA CZ dialect (batch
 * entry with multiple TxDtls, Pty-nested names, CdtrRefInf symbols).
 * Guards:
 *   - amounts parse from XML decimal strings to exact integer cents
 *   - VS/ŠS/KS extraction priority (EndToEndId → CdtrRefInf → Ustrd),
 *     zero-padding stripped, NOTPROVIDED ignored
 *   - AcctSvcrRef surfaces as externalTxId (import idempotency key)
 *   - direction + counterparty resolve per side (Dbtr for credits,
 *     Cdtr for debits)
 *   - malformed inputs throw Camt053ParseError, never a silent []
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCamt053,
  extractSymbols,
  xmlAmountToCents,
  Camt053ParseError,
} from "@/lib/import/parsers/bank-camt053";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("xmlAmountToCents");
check("integer", xmlAmountToCents("120") === 12000);
check("two decimals", xmlAmountToCents("120.50") === 12050);
check("one decimal", xmlAmountToCents("120.5") === 12050);
check("negative", xmlAmountToCents("-3.07") === -307);
check("exactness 0.29", xmlAmountToCents("0.29") === 29);
for (const bad of ["", "1,50", "abc", "1.234"]) {
  try {
    xmlAmountToCents(bad);
    failures++;
    console.error(`  FAIL rejects "${bad}" — did not throw`);
  } catch (err) {
    check(`rejects "${bad}"`, err instanceof Camt053ParseError);
  }
}

console.log("extractSymbols");
{
  const s = extractSymbols("/VS0000000101/SS0000000000/KS0308");
  check("padded VS stripped", s.vs === "101");
  check("zero SS is null", s.ss === null);
  check("KS kept", s.ks === "308");
  const inline = extractSymbols("uhrada najom /VS102/SS/KS0558 julova");
  check("inline in free text", inline.vs === "102" && inline.ks === "558");
  check("no match → nulls", extractSymbols("hello world").vs === null);
  check("null input", extractSymbols(null).vs === null);
}

console.log("SBA SK fixture");
{
  const statements = parseCamt053(
    readFileSync(join(fixturesDir, "camt053-sba-sk.xml"), "utf8")
  );
  check("one statement", statements.length === 1);
  const stmt = statements[0];
  check("account IBAN", stmt.iban === "SK9611000000002918599669");
  check("statement id", stmt.statementId === "129/2026");
  check("period dates", stmt.fromDate === "2026-07-02" && stmt.toDate === "2026-07-02");
  check("opening balance", stmt.openingBalanceCents === 1525000);
  check("closing balance", stmt.closingBalanceCents === 1543750);
  check("currency", stmt.currency === "EUR");
  check("4 transactions", stmt.transactions.length === 4, String(stmt.transactions.length));

  const [t1, t2, t3, t4] = stmt.transactions;
  check("t1 credit 12050", t1.direction === "credit" && t1.amountCents === 12050);
  check("t1 VS from EndToEndId", t1.vs === "101" && t1.ks === "308");
  check("t1 externalTxId", t1.externalTxId === "2026070201234567");
  check("t1 counterparty", t1.counterpartyName === "Ján Mrkvička");
  check("t1 counterparty IBAN", t1.counterpartyIban === "SK3112000000198742637541");
  check("t1 narrative", t1.narrative === "Predpis 2026-07 byt 101");
  check("t1 dates", t1.bookingDate === "2026-07-02" && t1.valueDate === "2026-07-02");

  check("t2 NOTPROVIDED endToEnd is null", t2.endToEndId === null);
  check("t2 VS from Ustrd fallback", t2.vs === "102" && t2.ks === "558");

  check("t3 debit direction", t3.direction === "debit");
  check("t3 counterparty is creditor", t3.counterpartyName === "Slovenská pošta a.s.");
  check("t3 VS on outgoing", t3.vs === "2026" && t3.ss === "7");

  check("t4 detail-less entry kept", t4.amountCents === 0 && t4.externalTxId === "2026070201234570");
}

console.log("ČBA CZ fixture");
{
  const statements = parseCamt053(
    readFileSync(join(fixturesDir, "camt053-cba-cz.xml"), "utf8")
  );
  const stmt = statements[0];
  check("account IBAN", stmt.iban === "CZ6508000000192000145399");
  check("PRCD opening balance", stmt.openingBalanceCents === 35200000);
  check("batch entry splits into 2 transactions", stmt.transactions.length === 2);

  const [c1, c2] = stmt.transactions;
  check("c1 per-tx amount (not batch total)", c1.amountCents === 318000);
  check("c1 CZK currency", c1.currency === "CZK");
  check("c1 VS from CdtrRefInf", c1.vs === "205" && c1.ss === "2026");
  check("c1 Pty-nested name", c1.counterpartyName === "Jana Dvořáková");
  check("c1 per-tx externalTxId", c1.externalTxId === "CZ-TX-778899-1");
  check("c2 VS from EndToEndId", c2.vs === "206" && c2.ks === null);
  check("c2 amount", c2.amountCents === 180000);
}

console.log("batch-entry safety");
{
  const batchXml = (details: string) => `<?xml version="1.0"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt><Stmt><Id>B/1</Id>
    <Ntry>
      <Amt Ccy="EUR">50.00</Amt>
      <CdtDbtInd>CRDT</CdtDbtInd>
      <BookgDt><Dt>2026-07-02</Dt></BookgDt>
      <AcctSvcrRef>BATCH-REF-1</AcctSvcrRef>
      <NtryDtls>${details}</NtryDtls>
    </Ntry>
  </Stmt></BkToCstmrStmt>
</Document>`;

  // Entry-level ref only, two details WITH amounts → per-detail suffixed
  // keys, never the same key twice (same key would dedupe-drop line 2).
  const suffixed = parseCamt053(
    batchXml(
      `<TxDtls><Amt Ccy="EUR">30.00</Amt></TxDtls><TxDtls><Amt Ccy="EUR">20.00</Amt></TxDtls>`
    )
  )[0].transactions;
  check("batch entry-ref keys are suffixed", suffixed[0].externalTxId === "BATCH-REF-1:1" && suffixed[1].externalTxId === "BATCH-REF-1:2");
  check("batch per-tx amounts kept", suffixed[0].amountCents === 3000 && suffixed[1].amountCents === 2000);

  // Single detail keeps the bare entry ref + may fall back to entry amount.
  const single = parseCamt053(batchXml(`<TxDtls></TxDtls>`))[0].transactions;
  check("single detail keeps bare entry ref", single[0].externalTxId === "BATCH-REF-1");
  check("single detail falls back to entry amount", single[0].amountCents === 5000);

  // Batch WITHOUT per-tx amounts must throw — falling back to the entry
  // total would book the batch total once per detail (N× phantom money).
  try {
    parseCamt053(batchXml(`<TxDtls></TxDtls><TxDtls></TxDtls>`));
    failures++;
    console.error("  FAIL batch without per-tx amounts — did not throw");
  } catch (err) {
    check(
      "batch without per-tx amounts throws",
      err instanceof Camt053ParseError &&
        err.message.includes("per-transaction amounts")
    );
  }
}

console.log("malformed inputs");
for (const [name, input] of [
  ["empty string", ""],
  ["not camt", "<?xml version=\"1.0\"?><Other><Foo/></Other>"],
  ["camt without statements", "<?xml version=\"1.0\"?><Document><BkToCstmrStmt><GrpHdr/></BkToCstmrStmt></Document>"],
] as const) {
  try {
    parseCamt053(input);
    failures++;
    console.error(`  FAIL ${name} — did not throw`);
  } catch (err) {
    check(name, err instanceof Camt053ParseError, String(err));
  }
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\nAll camt.053 checks passed.");
