/**
 * BYT-20260512-002 opening-balance CSV import check
 * (run: `pnpm test:accounting-opening-import`).
 *
 * Self-contained tsx script — NO database, NO server. Guards the pure
 * parser/template in modules/accounting/src/lib/opening-balance-import.ts,
 * which the on-boarding wizard runs client-side to fill the per-unit table
 * from a treasurer's spreadsheet. What this pins down:
 *   - delimiter auto-detect (SK/CZ ';' vs EN ',' vs tab)
 *   - header aliases across SK/CZ/EN spellings + accents + "(€)" noise
 *   - decimal-comma / spaces / negatives via the shared money parser
 *   - unknown / ambiguous / duplicate unit + bad-amount error codes
 *   - which dom units a file still leaves uncovered
 *   - template round-trip: build → parse → every unit re-matches
 */
import {
  parseOpeningBalanceCsv,
  buildOpeningBalanceTemplate,
  type OpeningImportUnit,
} from "@modules/accounting/src/lib/opening-balance-import";

let failures = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const UNITS: OpeningImportUnit[] = [
  { id: "u101", label: "101" },
  { id: "u102", label: "102" },
  { id: "u103", label: "103" },
  { id: "u104", label: "104" },
];

// ── happy path: SK Excel (';' delimiter, decimal comma) ────────────────
console.log("semicolon + decimal comma");
{
  const csv =
    "byt;fond_oprav;zalohy\r\n" +
    "101;1 000,00;300,50\r\n" +
    "102;-50,00;0\r\n" +
    "103;250;\r\n" + // empty zalohy → 0
    "104;;\r\n"; // both empty → 0/0
  const r = parseOpeningBalanceCsv(csv, UNITS);
  check("no file error", r.fileError === null, String(r.fileError));
  check("4 matched", r.matchedCount === 4, String(r.matchedCount));
  check("0 errors", r.errorCount === 0, String(r.errorCount));
  check("101 fpuo", r.matched.u101?.fpuoCents === 100000);
  check("101 zalohy", r.matched.u101?.zalohyCents === 30050);
  check("102 negative fpuo (debt)", r.matched.u102?.fpuoCents === -5000);
  check("103 empty zalohy = 0", r.matched.u103?.zalohyCents === 0);
  check("104 both empty = 0/0",
    r.matched.u104?.fpuoCents === 0 && r.matched.u104?.zalohyCents === 0);
  check("nothing left uncovered", r.unmatchedUnitLabels.length === 0);
}

// ── English Excel (',' delimiter, dot decimals, EN headers) ────────────
console.log("comma + dot decimals + EN headers");
{
  const csv =
    "flat_number,repair_fund,service_advances\n" +
    "101,1000.00,300.50\n" +
    "102,10.00,5.00\n";
  const r = parseOpeningBalanceCsv(csv, UNITS);
  check("no file error", r.fileError === null, String(r.fileError));
  check("2 matched", r.matchedCount === 2);
  check("101 fpuo", r.matched.u101?.fpuoCents === 100000);
  check("101 zalohy", r.matched.u101?.zalohyCents === 30050);
  check("103 + 104 uncovered",
    r.unmatchedUnitLabels.includes("103") &&
      r.unmatchedUnitLabels.includes("104"));
}

// ── accented + noisy headers, quoted amounts, tab delimiter ────────────
console.log("accented headers + quoted amount + tab");
{
  const csv =
    "Byt č.\tFond opráv (€)\tZálohy na služby\n" +
    '101\t"1 234,56"\t"78,90"\n';
  const r = parseOpeningBalanceCsv(csv, UNITS);
  check("no file error", r.fileError === null, String(r.fileError));
  check("quoted decimal-comma amount", r.matched.u101?.fpuoCents === 123456);
  check("quoted zalohy", r.matched.u101?.zalohyCents === 7890);
}

// ── column order swapped, extra columns ignored ───────────────────────
console.log("swapped/extra columns");
{
  const csv =
    "note;zalohy;byt;fond_oprav\n" +
    "x;10,00;102;20,00\n";
  const r = parseOpeningBalanceCsv(csv, UNITS);
  check("maps by header not position",
    r.matched.u102?.fpuoCents === 2000 && r.matched.u102?.zalohyCents === 1000);
}

// ── only one amount column present ────────────────────────────────────
console.log("fond-only file (zalohy default 0)");
{
  const csv = "byt;fond_oprav\n101;500,00\n";
  const r = parseOpeningBalanceCsv(csv, UNITS);
  check("no file error", r.fileError === null, String(r.fileError));
  check("101 fpuo set", r.matched.u101?.fpuoCents === 50000);
  check("101 zalohy defaults 0", r.matched.u101?.zalohyCents === 0);
}

// ── row-level errors ──────────────────────────────────────────────────
console.log("row errors: unknown / duplicate / bad amount");
{
  const csv =
    "byt;fond_oprav;zalohy\n" +
    "999;10,00;0\n" + // unknown unit
    "101;10,00;0\n" +
    "101;20,00;0\n" + // duplicate
    "102;abc;0\n" + // bad fpuo
    "103;10,00;xx\n"; // bad zalohy
  const r = parseOpeningBalanceCsv(csv, UNITS);
  check("unknown_unit flagged",
    r.rows.some((x) => x.rawLabel === "999" && x.errors.includes("unknown_unit")));
  check("duplicate_unit flagged",
    r.rows.filter((x) => x.rawLabel === "101").some((x) => x.errors.includes("duplicate_unit")));
  check("first 101 still matched", r.matched.u101?.fpuoCents === 1000);
  check("bad_fpuo flagged",
    r.rows.some((x) => x.rawLabel === "102" && x.errors.includes("bad_fpuo")));
  check("bad_zalohy flagged",
    r.rows.some((x) => x.rawLabel === "103" && x.errors.includes("bad_zalohy")));
  check("102/103 not matched (had errors)",
    r.matched.u102 === undefined && r.matched.u103 === undefined);
  check("errorCount = 4", r.errorCount === 4, String(r.errorCount));
}

// ── ambiguous labels (two units share a label) ────────────────────────
console.log("ambiguous unit label");
{
  const dup: OpeningImportUnit[] = [
    { id: "a", label: "Byt" },
    { id: "b", label: "Byt" },
  ];
  const r = parseOpeningBalanceCsv("byt;fond_oprav\nByt;10,00\n", dup);
  check("ambiguous_unit flagged",
    r.rows.some((x) => x.errors.includes("ambiguous_unit")));
  check("neither matched", Object.keys(r.matched).length === 0);
}

// ── file-level errors ─────────────────────────────────────────────────
console.log("file errors");
{
  check("empty file",
    parseOpeningBalanceCsv("", UNITS).fileError === "empty_file");
  check("whitespace-only file",
    parseOpeningBalanceCsv("\n\n  \n", UNITS).fileError === "empty_file");
  check("no recognizable header",
    parseOpeningBalanceCsv("foo;bar;baz\n1;2;3\n", UNITS).fileError === "no_header");
  check("missing flat column",
    parseOpeningBalanceCsv("fond_oprav;zalohy\n1;2\n", UNITS).fileError ===
      "missing_flat_column");
  check("missing amount column",
    parseOpeningBalanceCsv("byt;note\n101;x\n", UNITS).fileError ===
      "missing_amount_column");
}

// ── blank / spacer rows ignored ───────────────────────────────────────
console.log("spacer rows");
{
  const csv = "byt;fond_oprav;zalohy\n\n101;10,00;0\n;;;\n102;20,00;0\n";
  const r = parseOpeningBalanceCsv(csv, UNITS);
  check("blank + empty-label rows skipped, 2 matched", r.matchedCount === 2);
  check("no spurious errors", r.errorCount === 0, String(r.errorCount));
}

// ── template round-trip: build → parse → all units re-match at 0 ──────
console.log("template round-trip");
{
  const tpl = buildOpeningBalanceTemplate(UNITS.map((u) => ({ label: u.label })));
  check("has BOM", tpl.charCodeAt(0) === 0xfeff);
  check("CRLF line endings", tpl.includes("\r\n"));
  const r = parseOpeningBalanceCsv(tpl, UNITS);
  check("template parses cleanly", r.fileError === null && r.errorCount === 0);
  check("every unit present as a row (empty → 0/0)", r.matchedCount === 4);
  check("all zero", UNITS.every((u) => r.matched[u.id]?.fpuoCents === 0));
  check("nothing uncovered", r.unmatchedUnitLabels.length === 0);
}

// ── template escapes a label containing the delimiter ─────────────────
console.log("template quoting");
{
  const tpl = buildOpeningBalanceTemplate([{ label: "A;B" }]);
  check("delimiter-bearing label quoted", tpl.includes('"A;B"'));
  const r = parseOpeningBalanceCsv(tpl, [{ id: "x", label: "A;B" }]);
  check("quoted label round-trips", r.matchedCount === 1);
}

console.log(
  failures === 0
    ? "\nAll opening-import checks passed."
    : `\n${failures} check(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
