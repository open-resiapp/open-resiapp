/**
 * BYT-20260512-002 invoice field extractor check — AC 478
 * (run: `pnpm test:accounting-invoice-extract`).
 *
 * Self-contained tsx script — NO database, NO server, NO network. Two
 * layers:
 *   1. PURE text cases: SK + CZ invoice layouts, grouped IBANs, labelled vs
 *      unlabelled totals, OCR noise, confidence scoring.
 *   2. REAL round-trip: pdf-parse the committed fixture invoice PDF
 *      (scripts/fixtures/invoice-sample.pdf) and assert the 4 fields come
 *      back within tolerance — the extractor pinned to actual PDF text.
 */
import { readFileSync } from "fs";
import { PDFParse } from "pdf-parse";
import { extractInvoiceFields } from "@modules/accounting/src/lib/invoice-extract";
import { INVOICE_SEED } from "./fixtures/gen-invoice-pdf";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  // ── 1. SK invoice, grouped IBAN, labelled total ─────────────────────
  console.log("SK invoice — grouped IBAN + labelled total");
  {
    const text = [
      "Výťahy Servis s.r.o.",
      "Kováčska 12, 040 01 Košice",
      "IČO: 36721530",
      "IČ DPH: SK2022334455",
      "Faktúra č. 2025014",
      "Dátum vystavenia: 03.04.2025",
      "IBAN: SK89 7500 0000 0000 1234 5671",
      "Variabilný symbol: 2025014",
      "Základ dane: 100,00 €",
      "DPH 23%: 23,00 €",
      "Celkom k úhrade: 123,00 €",
    ].join("\n");
    const f = extractInvoiceFields(text);
    check("IČO", f.ico === "36721530", String(f.ico));
    check("DIČ / IČ DPH", f.dic === "SK2022334455", String(f.dic));
    check("IBAN normalized", f.iban === "SK8975000000000012345671", String(f.iban));
    check("VS", f.vs === "2025014", String(f.vs));
    check("amount = labelled total 123,00", f.amountCents === 12300, String(f.amountCents));
    check("full confidence", f.confidencePct === 100, String(f.confidencePct));
  }

  // ── 2. CZ invoice, dot-thousands / comma nothing, no VS label ─────────
  console.log("CZ invoice — decimal comma, IBAN inline");
  {
    const text = [
      "Úklid Morava s.r.o.",
      "IČO 24681012",
      "DIČ: CZ24681012",
      "Bankovní účet IBAN CZ6508000000192000145399",
      "VS 778899",
      "Cena celkem 1 250,00 Kč",
      "K úhradě 1 250,00 Kč",
    ].join("\n");
    const f = extractInvoiceFields(text);
    check("CZ IČO", f.ico === "24681012", String(f.ico));
    check("CZ IBAN", f.iban === "CZ6508000000192000145399", String(f.iban));
    check("CZ VS", f.vs === "778899", String(f.vs));
    check("CZ amount 1 250,00", f.amountCents === 125000, String(f.amountCents));
  }

  // ── 3. EN decimal-dot amount, largest-wins fallback (no total label) ──
  console.log("decimal-dot amount, unlabelled");
  {
    const text = [
      "ACME Facility Ltd",
      "ICO: 11223344",
      "IBAN SK8975000000000012345671",
      "Line A 40.00",
      "Line B 1,234.56",
      "Net 1,274.56",
    ].join("\n");
    const f = extractInvoiceFields(text);
    check("dot IČO", f.ico === "11223344", String(f.ico));
    // largest positive amount = 1,274.56 → 127456 cents
    check("largest amount picked", f.amountCents === 127456, String(f.amountCents));
    check("no VS → null", f.vs === null, String(f.vs));
  }

  // ── 4. OCR noise: extra spaces, IČO spaced, still extracts ───────────
  console.log("OCR noise tolerance");
  {
    const text =
      "SVB dodavatel  I C O  neuvedene\n" +
      "ICO :  36 721 530\n" +
      "I B A N : SK89 7500 0000 0000 1234 5671\n" +
      "V.S.  2025014\n" +
      "K uhrade  99,90 EUR\n";
    const f = extractInvoiceFields(text);
    check("spaced IČO", f.ico === "36721530", String(f.ico));
    check("spaced IBAN", f.iban === "SK8975000000000012345671", String(f.iban));
    check("V.S. dotted", f.vs === "2025014", String(f.vs));
    check("amount 99,90", f.amountCents === 9990, String(f.amountCents));
  }

  // ── 4b. date tails must not read as money (2-digit + 4-digit years) ──
  console.log("dates are not amounts");
  {
    const f = extractInvoiceFields("Faktúra 03.04.2025\nK úhrade do 15.05.25 suma 3,00 €");
    check("2-digit-year date not taken as amount", f.amountCents === 300, String(f.amountCents));
    const f2 = extractInvoiceFields("Splatnosť 31.12.2025\nCelkom k úhrade 12,00 €");
    check("4-digit-year date not taken as amount", f2.amountCents === 1200, String(f2.amountCents));
  }

  // ── 4c. IBAN with a trailing token on the same line ──────────────────
  console.log("IBAN followed by another token");
  {
    const f = extractInvoiceFields("IBAN SK8975000000000012345671 VS 2025014\nK úhrade 5,00 €");
    check("IBAN recovered despite trailing VS", f.iban === "SK8975000000000012345671", String(f.iban));
    check("VS still read", f.vs === "2025014", String(f.vs));
  }

  // ── 5. empty / garbage → all null, zero confidence ───────────────────
  console.log("empty + garbage");
  {
    const f = extractInvoiceFields("nič tu nie je\nžiadne čísla");
    check("no fields", !f.ico && !f.iban && !f.vs && f.amountCents === null);
    check("zero confidence", f.confidencePct === 0, String(f.confidencePct));
    const invalidIban = extractInvoiceFields("IBAN: SK0000000000000000000000");
    check("invalid IBAN rejected (MOD-97)", invalidIban.iban === null, String(invalidIban.iban));
  }

  // ── 6. REAL fixture invoice PDF round-trip ───────────────────────────
  console.log("real fixture invoice PDF round-trip");
  {
    const data = new Uint8Array(readFileSync("scripts/fixtures/invoice-sample.pdf"));
    const parsed = await new PDFParse({ data }).getText();
    const f = extractInvoiceFields(parsed.text);
    check("fixture IČO", f.ico === INVOICE_SEED.ico, String(f.ico));
    check("fixture IBAN", f.iban === INVOICE_SEED.iban, String(f.iban));
    check("fixture VS", f.vs === INVOICE_SEED.vs, String(f.vs));
    check("fixture amount", f.amountCents === INVOICE_SEED.amountCents, String(f.amountCents));
    check("fixture confidence 100", f.confidencePct === 100, String(f.confidencePct));
  }

  console.log(
    failures === 0
      ? "\nAll invoice-extract checks passed."
      : `\n${failures} check(s) FAILED.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
