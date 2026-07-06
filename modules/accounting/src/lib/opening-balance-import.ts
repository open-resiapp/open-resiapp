// Opening-balance CSV import (BYT-20260512-002 §Opening-balance tool,
// "CSV upload alebo manual table"). The concierge on-boarding path: a
// treasurer inheriting an SVB with 100 units downloads a pre-filled
// template (one row per unit), fills the two balance columns in Excel,
// and re-uploads — instead of hand-typing 200 amounts into the wizard.
//
// PURE + client-safe by design (no "server-only", no DB, no next/*): the
// opening-balance wizard runs the parse in the browser to fill the table,
// and the golden check (`pnpm test:accounting-opening-import`) exercises
// the exact same code with zero infrastructure. Matching, amount parsing
// and error reporting therefore can't drift between the two.
//
// The parser is deliberately i18n-free: it emits stable error CODES and
// the UI maps them to localized strings. Amounts go through the module's
// single money parser (money.ts) so decimal-comma / spaces / negatives
// behave identically to every hand-typed field.

import { parseCents } from "./money";

// ── public shapes ──────────────────────────────────────

export interface OpeningImportUnit {
  id: string;
  /** flatNumber ?? name — the same label shown everywhere in the module. */
  label: string;
}

/** Stable, i18n-free codes; the UI maps each to a localized message. */
export type OpeningRowErrorCode =
  | "unknown_unit"
  | "ambiguous_unit"
  | "duplicate_unit"
  | "bad_fpuo"
  | "bad_zalohy";

export type OpeningFileErrorCode =
  | "empty_file"
  | "no_header"
  | "missing_flat_column"
  | "missing_amount_column";

export interface ParsedOpeningRow {
  /** 1-based line number in the uploaded file (header = line 1). */
  rowNumber: number;
  /** The unit label exactly as it appeared in the file. */
  rawLabel: string;
  unitId: string | null;
  fpuoCents: number | null;
  zalohyCents: number | null;
  errors: OpeningRowErrorCode[];
}

export interface OpeningImportResult {
  fileError: OpeningFileErrorCode | null;
  rows: ParsedOpeningRow[];
  /** Only rows that matched a unit AND parsed cleanly. */
  matched: Record<string, { fpuoCents: number; zalohyCents: number }>;
  matchedCount: number;
  errorCount: number;
  /** Labels of dom units no clean row covered — still need a value. */
  unmatchedUnitLabels: string[];
}

// ── normalization ──────────────────────────────────────

/** Lowercase, strip diacritics, keep only [a-z0-9] — so "Fond opráv (€)",
 *  "fond_oprav" and "FONDOPRAV" all collapse to one key, and header noise
 *  like "(€)" or "č." can't defeat a match. */
function norm(s: string): string {
  // NFD splits "á" → "a" + combining mark; the final [^a-z0-9] strip then
  // drops the mark, so accents fall away without a separate range regex.
  return s
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

// Header aliases (already normalized via norm()). SK + CZ + EN spellings.
const FLAT_ALIASES = new Set([
  "flatnumber", "flat", "byt", "bytc", "cislobytu", "cbytu", "cislojednotky",
  "cislo", "unit", "unitnumber", "jednotka", "no",
]);
const FPUO_ALIASES = new Set([
  "fpuo", "fondoprav", "fond", "fo", "repairfund", "fpuobalance",
  "fondopravaudrzby",
]);
const ZALOHY_ALIASES = new Set([
  "zalohy", "zaloha", "zalohynasluzby", "preddavky", "sluzby",
  "serviceadvances", "advances", "services", "zalohybalance",
]);

// ── CSV tokenizer (RFC-4180-ish: quotes + doubled-quote escapes) ───────

/** Split one physical line into fields, honouring "quoted; fields". */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  out.push(field);
  return out;
}

/** Count delimiter occurrences outside quotes — for delimiter detection. */
function countOutsideQuotes(line: string, delim: string): number {
  let n = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delim && !inQuotes) n++;
  }
  return n;
}

/** Slovak/Czech Excel exports use ';' (',' is the decimal separator);
 *  English Excel uses ','. Tab is the fallback. Pick by header line. */
function detectDelimiter(headerLine: string): string {
  const candidates = [";", ",", "\t"];
  let best = ";";
  let bestCount = -1;
  for (const d of candidates) {
    const c = countOutsideQuotes(headerLine, d);
    if (c > bestCount) {
      best = d;
      bestCount = c;
    }
  }
  return bestCount > 0 ? best : ";";
}

// ── parse ──────────────────────────────────────────────

export function parseOpeningBalanceCsv(
  text: string,
  units: OpeningImportUnit[]
): OpeningImportResult {
  const empty: OpeningImportResult = {
    fileError: null,
    rows: [],
    matched: {},
    matchedCount: 0,
    errorCount: 0,
    unmatchedUnitLabels: units.map((u) => u.label),
  };

  // Strip a UTF-8 BOM, normalize newlines, drop trailing blank lines.
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const allLines = clean.split("\n");
  while (allLines.length && allLines[allLines.length - 1].trim() === "") {
    allLines.pop();
  }
  if (allLines.length === 0) {
    return { ...empty, fileError: "empty_file" };
  }

  const delim = detectDelimiter(allLines[0]);
  const header = splitCsvLine(allLines[0], delim).map((h) => norm(h));

  // Map header cells → column roles (first cell claiming a role wins).
  let idxFlat = -1;
  let idxFpuo = -1;
  let idxZalohy = -1;
  header.forEach((h, i) => {
    if (idxFlat < 0 && FLAT_ALIASES.has(h)) idxFlat = i;
    else if (idxFpuo < 0 && FPUO_ALIASES.has(h)) idxFpuo = i;
    else if (idxZalohy < 0 && ZALOHY_ALIASES.has(h)) idxZalohy = i;
  });

  if (idxFlat < 0 && idxFpuo < 0 && idxZalohy < 0) {
    return { ...empty, fileError: "no_header" };
  }
  if (idxFlat < 0) return { ...empty, fileError: "missing_flat_column" };
  if (idxFpuo < 0 && idxZalohy < 0) {
    return { ...empty, fileError: "missing_amount_column" };
  }

  // Unit lookup by normalized label, with ambiguity detection (two units
  // sharing a label — e.g. both flatNumber-null falling back to name).
  const byLabel = new Map<string, string | "AMBIGUOUS">();
  for (const u of units) {
    const key = norm(u.label);
    byLabel.set(key, byLabel.has(key) ? "AMBIGUOUS" : u.id);
  }

  const rows: ParsedOpeningRow[] = [];
  const matched: Record<string, { fpuoCents: number; zalohyCents: number }> = {};
  const seenUnits = new Set<string>();

  for (let li = 1; li < allLines.length; li++) {
    const raw = allLines[li];
    if (raw.trim() === "") continue; // spacer row
    const cells = splitCsvLine(raw, delim);
    const rawLabel = (cells[idxFlat] ?? "").trim();
    if (rawLabel === "") continue; // no unit on this row — skip silently

    const errors: OpeningRowErrorCode[] = [];

    // Resolve the unit.
    const hit = byLabel.get(norm(rawLabel));
    let unitId: string | null = null;
    if (hit === undefined) errors.push("unknown_unit");
    else if (hit === "AMBIGUOUS") errors.push("ambiguous_unit");
    else if (seenUnits.has(hit)) errors.push("duplicate_unit");
    else unitId = hit;

    // Parse amounts (empty cell = 0; debts allowed via negatives).
    const parseAmt = (idx: number): number | null =>
      idx < 0
        ? 0
        : parseCents((cells[idx] ?? "").trim(), {
            allowNegative: true,
            emptyAsZero: true,
          });
    const fpuoCents = parseAmt(idxFpuo);
    const zalohyCents = parseAmt(idxZalohy);
    if (fpuoCents === null) errors.push("bad_fpuo");
    if (zalohyCents === null) errors.push("bad_zalohy");

    rows.push({ rowNumber: li + 1, rawLabel, unitId, fpuoCents, zalohyCents, errors });

    if (unitId && errors.length === 0) {
      seenUnits.add(unitId);
      matched[unitId] = { fpuoCents: fpuoCents!, zalohyCents: zalohyCents! };
    }
  }

  const errorCount = rows.reduce((s, r) => s + (r.errors.length ? 1 : 0), 0);
  const unmatchedUnitLabels = units
    .filter((u) => !seenUnits.has(u.id))
    .map((u) => u.label);

  return {
    fileError: null,
    rows,
    matched,
    matchedCount: seenUnits.size,
    errorCount,
    unmatchedUnitLabels,
  };
}

// ── template ───────────────────────────────────────────

/** Escape a field for the given delimiter (quote when needed). */
function csvField(value: string, delim: string): string {
  if (value.includes(delim) || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * A ready-to-fill CSV: BOM (so Excel reads UTF-8), a header row, and one
 * pre-filled row per unit — label in column A, empty balance columns the
 * treasurer completes. Header names are Slovak but the parser also accepts
 * CZ/EN spellings, so a round-trip of this file always re-matches every
 * unit. Semicolon-delimited to match SK/CZ Excel (comma = decimal there).
 */
export function buildOpeningBalanceTemplate(
  units: { label: string }[],
  delim = ";"
): string {
  const header = ["byt", "fond_oprav", "zalohy"]
    .map((h) => csvField(h, delim))
    .join(delim);
  const body = units.map(
    (u) => `${csvField(u.label, delim)}${delim}${delim}`
  );
  return "﻿" + [header, ...body].join("\r\n") + "\r\n";
}
