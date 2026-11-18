// Citation parsing + formatting for the laws library. Pure: no I/O, no
// server APIs, errors are stable CODES (never prose) so callers map them to
// their own messages (MCP error details, i18n catalog).
//
//   parseCitation("§ 14 ods. 4 182/1993")      → { section: "14", paragraph: "4", law: { number: "182/1993" } }
//   parseCitation("§ 14a odst. 2 zák. 89/2012") → { section: "14a", paragraph: "2", law: { number: "89/2012" } }
//   parseCitation("OZ § 151")                   → { section: "151", law: { alias: "civil_code" } }
//
// `resolveCitationLaw` maps the law reference onto an index entry, and
// `anchorCandidates` turns the parsed parts into reader anchors
// (p14a, p14a-4, p14a-4-a, p1208-x1-a, cl2, priloha1).

import type { LawJurisdiction, LawMeta } from "./laws";
import { foldText } from "./laws-reader";

export type CitationErrorCode =
  | "citation.empty"
  | "citation.no_provision"
  | "citation.law_missing"
  | "citation.law_unknown";

export type LawAlias = "civil_code";

export interface ParsedCitation {
  /** "14a" for § 14a; absent for articles / annexes. */
  section?: string;
  /** Article number as arabic digits ("2" for Čl. II). */
  article?: string;
  /** Annex number ("1" for Príloha č. 1). */
  annex?: string;
  /** Paragraph (odsek / odstavec) number. */
  paragraph?: string;
  /** Item letter (písm. a)). */
  letter?: string;
  /** Point number inside an item (bod 1). */
  point?: string;
  law?: { number?: string; alias?: LawAlias };
  /** Jurisdiction implied by the collection suffix (Z. z. / Zb. → sk, Sb. → cz). */
  jurisdictionHint?: LawJurisdiction;
}

export type ParseResult =
  | { ok: true; citation: ParsedCitation }
  | { ok: false; code: CitationErrorCode };

const ROMAN: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };

function romanToInt(s: string): number | null {
  let total = 0;
  let prev = 0;
  for (const ch of s.toLowerCase().split("").reverse()) {
    const v = ROMAN[ch];
    if (!v) return null;
    total += v < prev ? -v : v;
    prev = Math.max(prev, v);
  }
  return total > 0 ? total : null;
}

// Matched against foldText(input): lowercase, no diacritics.
const SECTION_RE = /(?:§|\bpar(?:agraf[a-z]*)?\.?)\s*(\d{1,4}[a-z]{0,2})\b/;
const SECTION_PAREN_RE = /§\s*\d{1,4}[a-z]{0,2}\s*\((\d{1,3})\)/;
const PARAGRAPH_RE = /\b(?:ods|odst|odsek[a-z]*|odstav[a-z]*)\.?\s*(\d{1,3})\b/;
const LETTER_RE = /\bpism(?:eno|ena)?\.?\s*([a-z]{1,2})\)?(?![a-z])/;
const POINT_RE = /\bbod(?:u|e)?\.?\s*(\d{1,3})\b/;
const ARTICLE_RE = /\bcl(?:anok|anek|anku)?\.?\s*([ivxlc]+|\d{1,3})\b/;
const ANNEX_RE = /\bprilo(?:ha|hy|he|ze|hou)\s*(?:c\.?\s*)?(\d{1,3})\b/;
const NUMBER_RE = /\b(\d{1,4})\s*\/\s*(\d{4})\b/;
const SK_SUFFIX_RE = /\b(?:z\.\s*z\.|zb\.)/;
const CZ_SUFFIX_RE = /\bsb\.?(?![a-z])/;
const CIVIL_CODE_RE = /\b(?:oz|obcz|obc\.\s*z(?:ak)?\.?|obcians[a-z]*\s+zakonni[a-z]*|obcans[a-z]*\s+zakoni[a-z]*)(?![a-z])/;

/** Parses a free-form citation. Never throws. */
export function parseCitation(input: string): ParseResult {
  const raw = input.trim();
  if (!raw) return { ok: false, code: "citation.empty" };
  const s = foldText(raw).replace(/\s+/g, " ");

  const c: ParsedCitation = {};
  const section = SECTION_RE.exec(s);
  if (section) c.section = section[1];
  const article = ARTICLE_RE.exec(s);
  if (!c.section && article) {
    const n = /^\d+$/.test(article[1]) ? Number(article[1]) : romanToInt(article[1]);
    if (n) c.article = String(n);
  }
  const annex = ANNEX_RE.exec(s);
  if (!c.section && !c.article && annex) c.annex = annex[1];
  if (!c.section && !c.article && !c.annex) return { ok: false, code: "citation.no_provision" };

  const para = PARAGRAPH_RE.exec(s) ?? SECTION_PAREN_RE.exec(s);
  if (para) c.paragraph = para[1];
  const letter = LETTER_RE.exec(s);
  if (letter) c.letter = letter[1];
  const point = POINT_RE.exec(s);
  if (point && (c.letter || c.article)) c.point = point[1];

  const num = NUMBER_RE.exec(s);
  if (num) c.law = { number: `${Number(num[1])}/${num[2]}` };
  else if (CIVIL_CODE_RE.test(s)) c.law = { alias: "civil_code" };

  if (CZ_SUFFIX_RE.test(s)) c.jurisdictionHint = "cz";
  else if (SK_SUFFIX_RE.test(s)) c.jurisdictionHint = "sk";
  return { ok: true, citation: c };
}

const CIVIL_CODE: Record<LawJurisdiction, string> = { sk: "sk-40-1964", cz: "cz-89-2012" };

/**
 * Index entry the citation refers to. `fallbackLawId` (an explicit lawId
 * argument) wins over the parsed reference.
 */
export function resolveCitationLaw(
  citation: ParsedCitation,
  laws: readonly LawMeta[],
  jurisdiction: LawJurisdiction,
  fallbackLawId?: string
): { ok: true; law: LawMeta } | { ok: false; code: CitationErrorCode } {
  if (fallbackLawId) {
    const law = laws.find((l) => l.id === fallbackLawId);
    return law ? { ok: true, law } : { ok: false, code: "citation.law_unknown" };
  }
  const ref = citation.law;
  if (!ref) return { ok: false, code: "citation.law_missing" };
  const juris = citation.jurisdictionHint ?? jurisdiction;
  if (ref.alias === "civil_code") {
    const law = laws.find((l) => l.id === CIVIL_CODE[juris]);
    return law ? { ok: true, law } : { ok: false, code: "citation.law_unknown" };
  }
  const matches = laws.filter((l) => l.number.split(" ")[0] === ref.number);
  const law = matches.find((l) => l.jurisdiction === juris) ?? matches[0];
  return law ? { ok: true, law } : { ok: false, code: "citation.law_unknown" };
}

/** Reader anchor of the provision itself (p14a / cl2 / priloha1). */
export function provisionAnchor(c: ParsedCitation): string | null {
  if (c.section) return `p${c.section}`;
  if (c.article) return `cl${c.article}`;
  if (c.annex) return `priloha${c.annex}`;
  return null;
}

/**
 * Most specific → least specific anchors to try. Unnumbered paragraphs are
 * stored as `-x1`, so "§ 1208 písm. c)" resolves to p1208-x1-c.
 */
export function anchorCandidates(c: ParsedCitation): string[] {
  const base = provisionAnchor(c);
  if (!base) return [];
  const paras = c.paragraph ? [`${base}-${c.paragraph}`] : c.letter ? [`${base}-x1`] : [];
  const out: string[] = [];
  for (const p of paras) {
    if (c.letter && c.point) out.push(`${p}-${c.letter}-${c.point}`);
    if (c.letter) out.push(`${p}-${c.letter}`);
    out.push(p);
  }
  out.push(base);
  return out;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Genitive form of the act type, from its title ("zákona", "vyhlášky" …). */
function actGenitive(law: Pick<LawMeta, "title" | "jurisdiction">): string {
  const t = foldText(law.title);
  if (t.startsWith("vyhlask")) return "vyhlášky";
  if (t.startsWith("nariadeni")) return "nariadenia vlády";
  if (t.startsWith("narizeni")) return "nařízení vlády";
  return "zákona";
}

/** "zákona č. 182/1993 Z. z." */
export function lawReference(law: Pick<LawMeta, "title" | "jurisdiction" | "number">): string {
  return `${actGenitive(law)} č. ${law.number}`;
}

export interface CitationParts {
  /** Provision label as stored ("§ 14", "Čl. II", "Príloha č. 1 k …"). */
  label: string;
  /** Paragraph number, absent for unnumbered paragraphs. */
  paragraph?: string;
  /** Item labels from outer to inner ("a)", "1."). */
  items?: string[];
}

/**
 * Human citation: "§ 14 ods. 4 písm. a) zákona č. 182/1993 Z. z." /
 * "§ 1206 odst. 1 zákona č. 89/2012 Sb.". Annexes carry the act in their
 * own label and are returned as stored.
 */
export function formatCitation(
  law: Pick<LawMeta, "title" | "jurisdiction" | "number">,
  parts: CitationParts
): string {
  const label = parts.label.replace(/\s+/g, " ").trim();
  if (/^pr[ií]loh/i.test(label)) return label;
  const cz = law.jurisdiction === "cz";
  const bits = [label.replace(/^Čl\./, "čl.")];
  if (parts.paragraph) bits.push(`${cz ? "odst." : "ods."} ${parts.paragraph}`);
  for (const [i, item] of (parts.items ?? []).entries()) {
    const l = item.trim();
    if (!l || l === "–" || l === "-") continue;
    if (i === 0 && /^[a-z]{1,2}\)$/.test(l)) bits.push(`písm. ${l}`);
    else bits.push(`bod ${l.replace(/[.)]$/, "")}`);
  }
  return `${bits.join(" ")} ${lawReference(law)}`;
}

/**
 * `§ 1158 – § 1222` from a partial-scope note, as [from, to] section
 * numbers; null when the note has no § range.
 */
export function scopeSectionRange(scope: string | undefined): [number, number] | null {
  if (!scope) return null;
  const m = /§\s*(\d+)\s*[–-]\s*§\s*(\d+)/.exec(scope);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Is `section` ("1206", "14a") outside the stored partial range? */
export function isOutOfScope(scope: string | undefined, section: string | undefined): boolean {
  const range = scopeSectionRange(scope);
  if (!range || !section) return false;
  const n = parseInt(section, 10);
  return Number.isFinite(n) && (n < range[0] || n > range[1]);
}
