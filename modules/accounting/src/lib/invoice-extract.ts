// Invoice field extractor (BYT-20260512-002 AC 478). Given the TEXT of a
// supplier invoice (from the PDF text layer, or from OCR of a scanned
// image), pull out the four fields the treasurer needs to post an expense:
// IČO, IBAN, variabilný symbol, and the amount to pay. Also grabs DIČ when
// present (AC 440 requires it too).
//
// These are BEST-EFFORT suggestions, never authoritative — the treasurer
// confirms/edits every field before the doklad is created. The function is
// PURE + client-safe (no server-only, no DB) so the golden suite exercises
// the exact extraction the server runs, and it can also run client-side.
//
// Heuristics target SK + CZ invoices. Label-anchored matches win; bare
// pattern fallbacks fill the gaps with lower confidence.

import { normalizeIban, isValidIban } from "./iban";
import { parseCents } from "./money";

export interface InvoiceFields {
  ico: string | null; // 8 digits
  dic: string | null; // SK/CZ tax id (DIČ / IČ DPH)
  iban: string | null; // normalized, MOD-97 valid
  vs: string | null; // 1–10 digits
  amountCents: number | null; // total to pay (brutto)
  /** 0–100 heuristic — how much of the invoice we could read. */
  confidencePct: number;
}

/** Strip diacritics + lowercase for label matching. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// ── IBAN ───────────────────────────────────────────────

function findIban(text: string): string | null {
  // IBANs on invoices are often grouped: "SK68 0720 0002 8919 8742 6353".
  // Grab CC + 2 check digits + up to ~30 grouped alphanumerics, then let
  // normalizeIban strip the spaces and validate MOD-97.
  const re = /\b([A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){10,30})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const normed = normalizeIban(m[1]);
    if (normed && isValidIban(normed)) return normed;
  }
  return null;
}

// ── IČO / DIČ ──────────────────────────────────────────

function findIco(text: string): string | null {
  const n = norm(text);
  // Label-anchored: "IČO: 12345678" / "ICO 12 345 678".
  const labelled = n.match(/ico\s*[:.\s]*((?:\d[ ]?){8})(?!\d)/);
  if (labelled) {
    const digits = labelled[1].replace(/\s/g, "");
    if (digits.length === 8) return digits;
  }
  return null;
}

function findDic(text: string): string | null {
  const n = norm(text);
  // IČ DPH (SK): "SK2020123456"; or DIČ: "2020123456".
  const icDph = n.match(/i[cč]\s*dph\s*[:.\s]*([a-z]{2}\d{9,12})/);
  if (icDph) return icDph[1].toUpperCase();
  const dic = n.match(/di[cč]\s*[:.\s]*(\d{9,12})/);
  if (dic) return dic[1];
  return null;
}

// ── Variabilný symbol ──────────────────────────────────

function findVs(text: string): string | null {
  const n = norm(text);
  // "variabilny symbol: 1234567890", "VS: 1234567890", "V.S. 12345".
  const labelled =
    n.match(/variabiln[yý]\s*symbol\s*[:.\s]*(\d{1,10})(?!\d)/) ??
    n.match(/\bv\.?\s*s\.?\s*[:.\s]+(\d{1,10})(?!\d)/);
  return labelled ? labelled[1] : null;
}

// ── Amount to pay ──────────────────────────────────────

// A printed money amount: integer part EITHER grouped (1-3 digits + one-or-
// more 3-digit groups: "1 234","1,234","1.234") or ungrouped ("1234"),
// then a decimal separator + exactly 2 digits. Trailing (?![\d.,])
// rejects dotted dates ("03.04.2025" is not money).
const MONEY_RE = /-?(?:\d{1,3}(?:[ ,.]\d{3})+|\d+)[.,]\d{2}(?![\d.,])/g;

/** Parse one printed amount ("1 234,56" or "1,234.56") to cents. */
function amountToCents(raw: string): number | null {
  const t = raw.replace(/\u00a0/g, " ").trim();
  // The last separator is the decimal one; the rest are thousands. Strip
  // thousands, then hand parseCents a clean "integer<sep>2-digit" string.
  if (/,\d{2}$/.test(t)) {
    // comma decimal → thousands are space / dot
    return parseCents(t.replace(/[ .]/g, ""), { allowNegative: true });
  }
  if (/\.\d{2}$/.test(t)) {
    // dot decimal → thousands are space / comma
    return parseCents(t.replace(/[ ,]/g, ""), { allowNegative: true });
  }
  return null;
}

function findAmount(text: string): number | null {
  const lines = text.split(/\r?\n/);
  // Prefer a line that names the total to pay.
  const totalLabel =
    /(k\s*[úu]hrade|na\s*[úu]hradu|celkom\s*k?\s*[úu]?hrade?|celkov[aá]\s*suma|suma\s*spolu|spolu\s*k\s*[úu]hrade|to\s*pay|total\s*due|celkem\s*k\s*[úu]hrad[eě])/i;
  const candidates: number[] = [];
  let labelled: number | null = null;
  for (const line of lines) {
    const tokens = line.match(MONEY_RE);
    if (!tokens) continue;
    const centsOnLine = tokens
      .map(amountToCents)
      .filter((c): c is number => c !== null);
    if (centsOnLine.length === 0) continue;
    candidates.push(...centsOnLine);
    if (totalLabel.test(line)) {
      // The largest amount on a "to pay" line is the brutto total.
      labelled = Math.max(labelled ?? 0, ...centsOnLine);
    }
  }
  if (labelled !== null && labelled > 0) return labelled;
  // No labelled total → the largest positive amount is the best guess.
  const positives = candidates.filter((c) => c > 0);
  return positives.length ? Math.max(...positives) : null;
}

// ── public ─────────────────────────────────────────────

export function extractInvoiceFields(text: string): InvoiceFields {
  const ico = findIco(text);
  const dic = findDic(text);
  const iban = findIban(text);
  const vs = findVs(text);
  const amountCents = findAmount(text);

  // Confidence = share of the four core fields found (IČO, IBAN, VS,
  // amount). DIČ is a bonus, not counted.
  const core = [ico, iban, vs, amountCents].filter(
    (v) => v !== null && v !== undefined
  ).length;
  const confidencePct = Math.round((core / 4) * 100);

  return { ico, dic, iban, vs, amountCents, confidencePct };
}
