// Vyúčtovanie-PDF opening-balance ingest (BYT-20260512-002 AC 508).
//
// A treasurer inheriting an SVB that already ran THIS app has last year's
// per-unit ročné vyúčtovanie PDFs. Instead of re-keying every closing
// balance into the opening-balance wizard, they drop the PDFs in and the
// per-unit služby closing balance (the nedoplatok / preplatok result) is
// carried forward as the unit's opening zálohy position.
//
// Scope + honesty:
//  - This targets the app's OWN SK statutory vyúčtovanie PDF only
//    (VyuctovaniePDFSk). A third-party PDF is REJECTED — the parser
//    requires the § 7b ods. 3 zák. 182/1993 statutory anchor, so a random
//    document can't be mistaken for our layout.
//  - Fond opráv is intentionally NOT on the statutory vyúčtovanie ("fond
//    opráv sa nevyúčtováva" — Phase 4 decision), so the PDF path fills ONLY
//    the zálohy column. The treasurer completes fond opráv via the CSV /
//    manual path. Each covered unit is reported so the UI can show that its
//    fond-opráv value still needs a value.
//
// PURE + client-safe by design (no "server-only", no DB, no next/*): the
// wizard runs the text parse in the browser and the golden check exercises
// the exact same code. The only non-pure seam is turning the uploaded PDF
// BYTES into text — that lives in a thin server wrapper (pdf-parse) and is
// verified by the golden fixture (a real generated PDF, round-tripped).
//
// The parser is i18n-free: it anchors on the LOCALE-INVARIANT content of
// the SK template — the fixed Slovak title / statutory citation and the
// sk-SK money format (formatEur is hardcoded to sk-SK) — never on the
// column-header labels, which arrive translated in the viewer's UI locale.

import { parseCents } from "./money";
import { VS_RE } from "./constants";

// ── public shapes ──────────────────────────────────────

/** Stable, i18n-free codes; the UI maps each to a localized message. */
export type VyuctovaniePdfErrorCode =
  | "not_app_vyuctovanie" // missing the SK statutory anchor — not our PDF
  | "no_year" // could not read the settlement year
  | "no_vs" // no variabilný symbol → cannot match a unit
  | "no_result" // no result (nedoplatok/preplatok) amount found
  | "total_mismatch"; // rows don't tie out to the printed total — corrupt

export interface ParsedVyuctovaniePdf {
  error: VyuctovaniePdfErrorCode | null;
  year: number | null;
  vs: string | null;
  /** unitLabel as printed (display only; matching is by VS). */
  unitLabel: string | null;
  /** Settlement result: >0 nedoplatok (owes), <0 preplatok (credit). */
  differenceCents: number | null;
}

// ── locale-invariant anchors of the SK template ────────

const STATUTORY_RE = /§\s*7b\s+ods\.\s*3\s+z[aá]kona\s+č\.\s*182\/1993/i;
const YEAR_RE = /Vy[uú][cč]tovanie\s+z[aá]loh\s+na\s+plnenia\s+za\s+rok\s+(\d{4})/i;
const REKLAMACIA_RE = /Pr[ií]padn[eé]\s+n[aá]mietky/i;
// The "-- 1 of 1 --" page marker pdf-parse appends between/after pages.
const PAGE_MARKER_RE = /^--\s*\d+\s+of\s+\d+\s*--$/;

// One sk-SK money token: optional minus, digits with space/dot group
// separators (NBSP already normalized to space by toLines), comma
// decimals, trailing €. Global so a line can hold many.
const MONEY_TOKEN_RE = /-?\d[\d .]*,\d{2}\s*€/g;

/** All money tokens on a line, in reading order, as integer cents. */
function moneyCentsOnLine(line: string): number[] {
  const out: number[] = [];
  const matches = line.match(MONEY_TOKEN_RE);
  if (!matches) return out;
  for (const m of matches) {
    const cents = parseCents(m.replace(/€/g, "").trim(), { allowNegative: true });
    if (cents !== null) out.push(cents);
  }
  return out;
}

/** Collapse NBSP → space, split into trimmed non-empty lines, drop the
 *  pdf-parse page marker. */
function toLines(text: string): string[] {
  return text
    .replace(/\u00a0/g, " ") // NBSP thousands sep / currency gap → plain space
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l !== "" && !PAGE_MARKER_RE.test(l));
}

// ── single-PDF parse ───────────────────────────────────

const FAIL = (
  error: VyuctovaniePdfErrorCode,
  partial: Partial<ParsedVyuctovaniePdf> = {}
): ParsedVyuctovaniePdf => ({
  error,
  year: null,
  vs: null,
  unitLabel: null,
  differenceCents: null,
  ...partial,
});

/**
 * Parse the text of ONE app-generated SK vyúčtovanie PDF (as returned by
 * pdf-parse) into the fields needed to carry the unit forward.
 */
export function parseVyuctovaniePdfText(text: string): ParsedVyuctovaniePdf {
  const lines = toLines(text);
  const joined = lines.join("\n");

  // 1. Identity gate — must be OUR SK statutory template.
  if (!STATUTORY_RE.test(joined)) return FAIL("not_app_vyuctovanie");

  // 2. Year from the fixed Slovak title.
  const yearMatch = joined.match(YEAR_RE);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (!year) return FAIL("no_year");

  // Locate the statutory line, the reklamácia line, and the first data row
  // (first line carrying >= 4 money tokens — each row prints prescribed,
  // advances, cost, difference). Everything between statutory and the data
  // is the meta block (unit + VS); everything after the last multi-money
  // line up to reklamácia holds the result.
  const statutoryIdx = lines.findIndex((l) => STATUTORY_RE.test(l));
  const reklamaciaIdx = lines.findIndex((l) => REKLAMACIA_RE.test(l));
  const firstDataIdx = lines.findIndex(
    (l, i) => i > statutoryIdx && moneyCentsOnLine(l).length >= 4
  );
  if (firstDataIdx < 0) return FAIL("no_result", { year });

  // 3. VS from the meta block. The component prints the unit pair then the
  //    VS pair: [unitLabel, unitValue, vsLabel, vsValue]. Anchor on the VS
  //    LABEL, not on "a numeric line" — the unit label can itself be numeric
  //    ("101"), so a bare-numeric heuristic would confuse the two. The VS
  //    label is locale-variable ("Variabilný symbol" / "Variable symbol" /
  //    "Variabilní symbol") but every locale's label contains "symbol".
  const metaEnd = firstDataIdx - 1; // firstDataIdx-1 is the column header
  const metaLines = lines.slice(statutoryIdx + 1, metaEnd);
  const symbolIdx = metaLines.findIndex((l) => /symbol/i.test(l));
  let vs: string | null = null;
  if (symbolIdx >= 0) {
    // Value is the next line, or trails the label on the same line
    // ("Variabilný symbol: 1010001") if pdf-parse merged them.
    const sameLine = metaLines[symbolIdx].match(/(\d{1,10})\s*$/);
    const next = metaLines[symbolIdx + 1] ?? "";
    if (sameLine && VS_RE.test(sameLine[1])) vs = sameLine[1];
    else if (VS_RE.test(next)) vs = next;
  }
  if (!vs) return FAIL("no_vs", { year });
  // Unit value is the line just before the VS label.
  const unitLabel = symbolIdx >= 1 ? metaLines[symbolIdx - 1] : null;

  // 4. Result + tie-out. Classify the lines from the data block to
  //    reklamácia by money-token count: data rows = 4, total row = 3,
  //    result box = 1.
  const tail = lines.slice(
    firstDataIdx,
    reklamaciaIdx >= 0 ? reklamaciaIdx : lines.length
  );
  let totalDiff: number | null = null; // 3-token total row, last token
  let resultDiff: number | null = null; // 1-token result box
  let sumRowDiff = 0;
  let sawRow = false;
  for (const l of tail) {
    const m = moneyCentsOnLine(l);
    if (m.length >= 4) {
      sumRowDiff += m[m.length - 1];
      sawRow = true;
    } else if (m.length === 3) {
      totalDiff = m[m.length - 1];
    } else if (m.length === 1) {
      resultDiff = m[0];
    }
  }
  if (resultDiff === null) return FAIL("no_result", { year, vs, unitLabel });

  // The result box amount must equal the total-row difference, and the
  // per-service differences must sum to it — otherwise the PDF is
  // internally inconsistent (corrupted / hand-edited), a hard error.
  if (totalDiff !== null && totalDiff !== resultDiff) {
    return FAIL("total_mismatch", { year, vs, unitLabel });
  }
  if (sawRow && sumRowDiff !== resultDiff) {
    return FAIL("total_mismatch", { year, vs, unitLabel });
  }

  return { error: null, year, vs, unitLabel, differenceCents: resultDiff };
}

// ── match a set of PDFs to the dom's units ──────────────

export interface VyuctovaniePdfUnit {
  id: string;
  label: string;
  /** The unit's variabilný symbol — the match key. null = unassigned. */
  vs: string | null;
}

/** One uploaded file's outcome, for the UI report. */
export interface VyuctovaniePdfFileResult {
  fileName: string;
  parsed: ParsedVyuctovaniePdf;
  /** Matched unit id, or null when VS resolved to no / an ambiguous unit. */
  unitId: string | null;
  /** Extra, non-parse problems raised while matching against the dom. */
  matchError: "unknown_vs" | "ambiguous_vs" | "duplicate_unit" | null;
}

export interface VyuctovaniePdfImportResult {
  files: VyuctovaniePdfFileResult[];
  /** unitId → carried-forward zálohy opening (=-difference). */
  matched: Record<string, { zalohyCents: number }>;
  matchedCount: number;
  /** Labels of matched units whose fond-opráv value the PDF can't provide. */
  fondOpravStillNeeded: string[];
}

/**
 * Resolve parsed PDFs to units by VS and turn each settlement result into
 * an opening zálohy balance. zálohy_opening = -difference: a nedoplatok
 * (owner owed money, difference > 0) becomes a negative advance the SVB
 * carries against the unit; a preplatok (difference < 0) becomes a positive
 * advance. The opening-balance model already allows negative zálohy.
 */
export function matchVyuctovaniePdfsToUnits(
  files: { fileName: string; text: string }[],
  units: VyuctovaniePdfUnit[]
): VyuctovaniePdfImportResult {
  // VS → unitId, with ambiguity detection (two units sharing a VS).
  const byVs = new Map<string, string | "AMBIGUOUS">();
  for (const u of units) {
    if (!u.vs) continue;
    byVs.set(u.vs, byVs.has(u.vs) ? "AMBIGUOUS" : u.id);
  }
  const labelById = new Map(units.map((u) => [u.id, u.label]));

  const results: VyuctovaniePdfFileResult[] = [];
  const matched: Record<string, { zalohyCents: number }> = {};
  const seenUnits = new Set<string>();

  for (const f of files) {
    const parsed = parseVyuctovaniePdfText(f.text);
    let unitId: string | null = null;
    let matchError: VyuctovaniePdfFileResult["matchError"] = null;

    if (!parsed.error && parsed.vs) {
      const hit = byVs.get(parsed.vs);
      if (hit === undefined) matchError = "unknown_vs";
      else if (hit === "AMBIGUOUS") matchError = "ambiguous_vs";
      else if (seenUnits.has(hit)) matchError = "duplicate_unit";
      else {
        unitId = hit;
        seenUnits.add(hit);
        matched[hit] = { zalohyCents: -(parsed.differenceCents ?? 0) };
      }
    }

    results.push({ fileName: f.fileName, parsed, unitId, matchError });
  }

  const fondOpravStillNeeded = [...seenUnits].map(
    (id) => labelById.get(id) ?? id
  );

  return {
    files: results,
    matched,
    matchedCount: seenUnits.size,
    fondOpravStillNeeded,
  };
}
