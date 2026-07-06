/**
 * Golden-fixture generator for AC 508 (vyúčtovanie-PDF opening-balance
 * ingest). Renders the app's OWN SK settlement component
 * (VyuctovaniePDFSk) with a FIXED seed and writes the binary PDF to
 * scripts/fixtures/vyuctovanie-sk-2025.pdf.
 *
 * Run ONCE to (re)generate the committed fixture:
 *   npx tsx --tsconfig scripts/tsconfig.e2e.json scripts/fixtures/gen-vyuctovanie-pdf.tsx
 *
 * ⚠️ Needs network the first time (VyuctovaniePDFSk registers Roboto from
 * fonts.gstatic.com). The GOLDEN SUITE does NOT run this — it reads the
 * committed PDF and pdf-parses it offline, so the parser is checked against
 * real renderer output, not a hand-authored approximation.
 *
 * The seed below is the single source of truth for the expected values the
 * golden suite (accounting-vyuctovanie-pdf-check.ts) asserts.
 */
import "dotenv/config";
import React from "react";
import { writeFileSync } from "fs";
import { renderToBuffer } from "@react-pdf/renderer";
import VyuctovaniePDFSk from "@modules/accounting/src/components/VyuctovaniePDFSk";
import { formatEur } from "@modules/accounting/src/lib/money";

// FIXED SEED — keep in sync with accounting-vyuctovanie-pdf-check.ts.
export const SEED = {
  year: 2025,
  unitLabel: "101",
  vs: "1010001",
  rows: [
    { name: "Výťah", prescribedC: 12000, advancesC: 12000, costC: 13500, diffC: 1500 },
    { name: "Upratovanie", prescribedC: 6000, advancesC: 6000, costC: 5200, diffC: -800 },
  ],
  totalAdvancesC: 18000,
  totalCostC: 18700,
  totalDiffC: 700, // nedoplatok 7,00 € → opening zálohy = -700
};

async function main() {
  const buf = await renderToBuffer(
    <VyuctovaniePDFSk
      building={{ name: "SVB Testovacia 1", address: "Testovacia 1, 811 01 Bratislava", ico: "12345678" }}
      // Real sk.json Accounting.vyuctovaniePdf labels — the common case
      // (SK-locale treasurer generated the settlement). VS label is
      // "Variabilný symbol"; the parser anchors on the "symbol" substring
      // shared by all three locale labels.
      labels={{
        unit: "Byt", vs: "Variabilný symbol", service: "Služba",
        prescribed: "Predpísané", advances: "Uhradené zálohy",
        cost: "Skutočné náklady", difference: "Rozdiel", total: "Spolu",
        nedoplatok: "NEDOPLATOK — na úhradu", preplatok: "PREPLATOK — na vrátenie",
        settled: "Vyrovnané", qrTitle: "Úhrada nedoplatku cez PAY by square",
        iban: "IBAN", footer: "Vygenerované systémom OpenResiApp.",
      }}
      year={SEED.year}
      unitLabel={SEED.unitLabel}
      vs={SEED.vs}
      rows={SEED.rows.map((r) => ({
        name: r.name,
        prescribed: formatEur(r.prescribedC),
        advances: formatEur(r.advancesC),
        cost: formatEur(r.costC),
        difference: formatEur(r.diffC),
      }))}
      totals={{
        advances: formatEur(SEED.totalAdvancesC),
        cost: formatEur(SEED.totalCostC),
        difference: formatEur(SEED.totalDiffC),
      }}
      totalDifferenceCents={SEED.totalDiffC}
      iban="SK6807200002891987426353"
      qrDataUrl={null}
    />
  );
  const out = "scripts/fixtures/vyuctovanie-sk-2025.pdf";
  writeFileSync(out, buf);
  console.log(`wrote ${out} (${buf.length} bytes)`);
}
main().catch((e) => {
  console.error("fixture generation failed:", e?.message ?? e);
  process.exit(2);
});
