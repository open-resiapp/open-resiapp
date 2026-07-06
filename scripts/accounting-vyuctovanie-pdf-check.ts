/**
 * BYT-20260512-002 vyúčtovanie-PDF opening-balance ingest check — AC 508
 * (run: `pnpm test:accounting-vyuctovanie-pdf`).
 *
 * Self-contained tsx script — NO database, NO server, NO network. Two
 * layers:
 *   1. REAL round-trip: pdf-parse the committed fixture
 *      scripts/fixtures/vyuctovanie-sk-2025.pdf (generated ONCE from the
 *      app's own VyuctovaniePDFSk component via gen-vyuctovanie-pdf.tsx) and
 *      assert the pure parser extracts the seeded year / VS / difference.
 *      This pins the parser to ACTUAL renderer output, not an approximation.
 *   2. PURE text cases: QR-section robustness, tie-out mismatch → hard
 *      error, missing statutory anchor / VS, preplatok sign.
 */
import { readFileSync } from "fs";
import { PDFParse } from "pdf-parse";
import {
  parseVyuctovaniePdfText,
  matchVyuctovaniePdfsToUnits,
  type VyuctovaniePdfUnit,
} from "@modules/accounting/src/lib/vyuctovanie-pdf-import";
import { SEED } from "./fixtures/gen-vyuctovanie-pdf";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. REAL round-trip against the committed fixture PDF ───────────────
async function fixtureText(): Promise<string> {
  const data = new Uint8Array(readFileSync("scripts/fixtures/vyuctovanie-sk-2025.pdf"));
  const parsed = await new PDFParse({ data }).getText();
  return parsed.text;
}

// ── canonical app text (mirrors renderer output, WITH a QR section) ────
const APP_TEXT_WITH_QR = [
  "SVB Testovacia 1",
  "Testovacia 1, 811 01 Bratislava",
  "IČO: 12345678",
  "Vyúčtovanie záloh na plnenia za rok 2025",
  "Vyúčtovanie úhrad za plnenia spojené s užívaním bytu",
  "podľa § 7b ods. 3 zákona č. 182/1993 Z.z. o vlastníctve bytov a nebytových priestorov v znení neskorších predpisov",
  "Byt",
  "101",
  "Variabilný symbol",
  "1010001",
  "Služba Predpísané Uhradené zálohy Skutočné náklady Rozdiel",
  "Výťah 120,00 € 120,00 € 135,00 € 15,00 €",
  "Upratovanie 60,00 € 60,00 € 52,00 € -8,00 €",
  "Spolu 180,00 € 187,00 € 7,00 €",
  "NEDOPLATOK — na úhradu 7,00 €",
  "Úhrada nedoplatku cez PAY by square",
  "IBAN: SK6807200002891987426353",
  "Variabilný symbol: 1010001",
  "Prípadné námietky proti tomuto vyúčtovaniu uplatnite písomne u predsedu spoločenstva. Nedoplatok je splatný a preplatok bude vrátený v lehote podľa",
  "zmluvy o spoločenstve, spravidla do 30 dní od doručenia vyúčtovania.",
  "Vygenerované aplikáciou",
  "-- 1 of 1 --",
].join("\n");

async function main() {
  console.log("real fixture PDF round-trip (pdf-parse)");
  {
    const text = await fixtureText();
    const p = parseVyuctovaniePdfText(text);
    check("no parse error", p.error === null, String(p.error));
    check("year 2025", p.year === SEED.year, String(p.year));
    check("vs 1010001", p.vs === SEED.vs, String(p.vs));
    check("unitLabel 101", p.unitLabel === SEED.unitLabel, String(p.unitLabel));
    check(
      "difference = seed nedoplatok",
      p.differenceCents === SEED.totalDiffC,
      String(p.differenceCents)
    );

    const units: VyuctovaniePdfUnit[] = [
      { id: "u101", label: "101", vs: "1010001" },
      { id: "u102", label: "102", vs: "1020002" },
    ];
    const r = matchVyuctovaniePdfsToUnits(
      [{ fileName: "vyuctovanie-2025-1010001.pdf", text }],
      units
    );
    check("1 matched", r.matchedCount === 1, String(r.matchedCount));
    // nedoplatok 7,00 € → the unit carries a -700 opening zálohy (owes).
    check("zálohy = -difference", r.matched.u101?.zalohyCents === -700, JSON.stringify(r.matched));
    check("fond opráv reported still-needed", r.fondOpravStillNeeded.includes("101"));
    check("file matched to u101", r.files[0].unitId === "u101");
    check("no match error", r.files[0].matchError === null);
  }

  // ── 2. QR-section robustness (VS repeats; parser ignores QR block) ───
  console.log("pure text — QR section present");
  {
    const p = parseVyuctovaniePdfText(APP_TEXT_WITH_QR);
    check("parses with QR", p.error === null, String(p.error));
    check("vs from meta not QR", p.vs === "1010001", String(p.vs));
    check("difference 700", p.differenceCents === 700, String(p.differenceCents));
  }

  // ── 3. tie-out mismatch → hard error ─────────────────────────────────
  console.log("pure text — tie-out mismatches");
  {
    // Result box says a different total than the total row.
    const tampered = APP_TEXT_WITH_QR.replace(
      "NEDOPLATOK — na úhradu 7,00 €",
      "NEDOPLATOK — na úhradu 9,00 €"
    );
    check(
      "result ≠ total row → total_mismatch",
      parseVyuctovaniePdfText(tampered).error === "total_mismatch"
    );
    // Rows no longer sum to the total (bump a row difference).
    const tampered2 = APP_TEXT_WITH_QR.replace(
      "Výťah 120,00 € 120,00 € 135,00 € 15,00 €",
      "Výťah 120,00 € 120,00 € 135,00 € 25,00 €"
    );
    check(
      "rows don't sum to total → total_mismatch",
      parseVyuctovaniePdfText(tampered2).error === "total_mismatch"
    );
  }

  // ── 4. identity + VS guards ──────────────────────────────────────────
  console.log("pure text — identity + VS guards");
  {
    const noStatute = APP_TEXT_WITH_QR.replace(
      "podľa § 7b ods. 3 zákona č. 182/1993 Z.z. o vlastníctve bytov a nebytových priestorov v znení neskorších predpisov",
      "Nejaký cudzí dokument bez zákonnej hlavičky"
    );
    check(
      "no statutory anchor → not_app_vyuctovanie",
      parseVyuctovaniePdfText(noStatute).error === "not_app_vyuctovanie"
    );
    check(
      "random third-party text rejected",
      parseVyuctovaniePdfText("Faktúra č. 2025/001\nSuma: 500,00 €").error ===
        "not_app_vyuctovanie"
    );
    // Drop the meta VS pair (the QR-section "Variabilný symbol: …" line
    // stays, but it's after the table so it isn't in the meta block).
    const noVs = APP_TEXT_WITH_QR.replace("Variabilný symbol\n1010001\n", "");
    check("no VS in meta → no_vs", parseVyuctovaniePdfText(noVs).error === "no_vs");
  }

  // ── 5. preplatok (negative difference → positive opening zálohy) ─────
  console.log("pure text — preplatok sign");
  {
    const preplatok = [
      "SVB Testovacia 1",
      "podľa § 7b ods. 3 zákona č. 182/1993 Z.z. o vlastníctve bytov",
      "Vyúčtovanie záloh na plnenia za rok 2024",
      "Byt",
      "102",
      "Variabilný symbol",
      "1020002",
      "Služba Predpísané Uhradené zálohy Skutočné náklady Rozdiel",
      "Výťah 100,00 € 100,00 € 88,00 € -12,00 €",
      "Spolu 100,00 € 88,00 € -12,00 €",
      "PREPLATOK — na vrátenie -12,00 €",
      "Prípadné námietky proti tomuto vyúčtovaniu",
    ].join("\n");
    const p = parseVyuctovaniePdfText(preplatok);
    check("preplatok parses", p.error === null, String(p.error));
    check("difference -1200", p.differenceCents === -1200, String(p.differenceCents));
    const units: VyuctovaniePdfUnit[] = [{ id: "u102", label: "102", vs: "1020002" }];
    const r = matchVyuctovaniePdfsToUnits([{ fileName: "p.pdf", text: preplatok }], units);
    check("preplatok → positive zálohy 1200", r.matched.u102?.zalohyCents === 1200, JSON.stringify(r.matched));
  }

  // ── 6. match errors: unknown / duplicate VS ──────────────────────────
  console.log("pure text — match errors");
  {
    const units: VyuctovaniePdfUnit[] = [{ id: "u999", label: "999", vs: "9990009" }];
    const r = matchVyuctovaniePdfsToUnits(
      [{ fileName: "a.pdf", text: APP_TEXT_WITH_QR }],
      units
    );
    check("unknown VS → unknown_vs", r.files[0].matchError === "unknown_vs");
    check("nothing matched", r.matchedCount === 0);

    const units2: VyuctovaniePdfUnit[] = [{ id: "u101", label: "101", vs: "1010001" }];
    const r2 = matchVyuctovaniePdfsToUnits(
      [
        { fileName: "a.pdf", text: APP_TEXT_WITH_QR },
        { fileName: "b.pdf", text: APP_TEXT_WITH_QR },
      ],
      units2
    );
    check("first file matches", r2.files[0].unitId === "u101");
    check("second same-VS file → duplicate_unit", r2.files[1].matchError === "duplicate_unit");
  }

  console.log(
    failures === 0
      ? "\nAll vyúčtovanie-PDF checks passed."
      : `\n${failures} check(s) FAILED.`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
