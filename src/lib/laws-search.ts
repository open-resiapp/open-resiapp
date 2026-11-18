// Legal-basis search + provision lookup for the MCP law tools. Pure: the
// caller passes LawDocuments (laws.server.ts) — no I/O here.
//
// Unlike the reader's `searchLaw` (one exact phrase inside one act), this
// ranks PARAGRAPHS across every act of a jurisdiction by term overlap with
// a natural-language question: diacritics/case-insensitive, crude Slavic
// stemming (word-start prefix match), IDF weighting, topic boost.

import type { LawDocument, LawItem, LawNode, LawParagraph, LawProvision } from "./laws";
import { foldText } from "./laws-reader";

// ---------------------------------------------------------------------------
// Provision lookup
// ---------------------------------------------------------------------------

function* provisions(nodes: LawNode[]): Generator<LawProvision> {
  for (const node of nodes) {
    if (node.type === "provision") yield node;
    else if (node.type === "section") yield* provisions(node.children);
  }
}

export interface LocatedAnchor {
  provision: LawProvision;
  /** Paragraph holding the anchor (absent when the anchor is the provision). */
  paragraph?: LawParagraph;
  /** Item chain from the paragraph down to the anchor (outer → inner). */
  items: LawItem[];
}

function findItemPath(list: LawItem[] | undefined, anchor: string): LawItem[] | null {
  for (const it of list ?? []) {
    if (it.anchor === anchor) return [it];
    const inner = findItemPath(it.items, anchor);
    if (inner) return [it, ...inner];
  }
  return null;
}

/** Provision / paragraph / item an anchor points at; null when unknown. */
export function locateAnchor(law: LawDocument, anchor: string): LocatedAnchor | null {
  for (const p of provisions(law.parts)) {
    if (p.anchor === anchor) return { provision: p, items: [] };
    // Paragraph / item anchors start with the provision anchor + "-".
    if (!anchor.startsWith(`${p.anchor}-`)) continue;
    for (const para of p.paragraphs) {
      if (para.anchor === anchor) return { provision: p, paragraph: para, items: [] };
      const path = findItemPath(para.items, anchor);
      if (path) return { provision: p, paragraph: para, items: path };
    }
  }
  return null;
}

export function listProvisionAnchors(law: LawDocument): Set<string> {
  const out = new Set<string>();
  for (const p of provisions(law.parts)) out.add(p.anchor);
  return out;
}

function itemLines(list: LawItem[] | undefined, depth: number, out: string[]): void {
  for (const it of list ?? []) {
    const indent = "  ".repeat(depth);
    out.push(`${indent}${it.label ? `${it.label} ` : ""}${it.text}`.trimEnd());
    itemLines(it.items, depth + 1, out);
    if (it.tail) out.push(`${indent}${it.tail}`);
  }
}

/** Plain text of one paragraph with its items: "(4) text\n a) …". */
export function paragraphText(para: LawParagraph): string {
  const out = [`${para.n ? `(${para.n}) ` : ""}${para.text}`.trimEnd()];
  itemLines(para.items, 1, out);
  if (para.tail) out.push(para.tail);
  return out.join("\n");
}

/** Plain text of a whole provision: label + heading, then every paragraph. */
export function provisionText(p: LawProvision): string {
  const head = [p.label, p.heading].filter(Boolean).join(" ");
  return [head, ...p.paragraphs.map(paragraphText)].join("\n");
}

// ---------------------------------------------------------------------------
// Search corpus
// ---------------------------------------------------------------------------

interface Segment {
  /** Paragraph or item anchor. */
  anchor: string;
  /** Offset of this segment in the unit's joined text. */
  start: number;
  /** "a) " for items, "" for the paragraph's own text and tails. */
  prefix: string;
  text: string;
  /** Item labels from the paragraph down to this segment (["b)", "1."]). */
  labels: string[];
}

/** One paragraph (odsek) — the search and citation granularity. */
export interface SearchUnit {
  lawId: string;
  provisionAnchor: string;
  /** "§ 14b" */
  label: string;
  heading?: string;
  foldedHeading: string;
  /** Paragraph anchor ("p14b-2"). */
  anchor: string;
  /** Paragraph number, absent for unnumbered paragraphs. */
  n?: string;
  text: string;
  folded: string;
  segments: Segment[];
}

export function buildSearchUnits(law: LawDocument): SearchUnit[] {
  const units: SearchUnit[] = [];
  for (const p of provisions(law.parts)) {
    for (const para of p.paragraphs) {
      const segments: Segment[] = [];
      let text = "";
      const add = (anchor: string, prefix: string, body: string, labels: string[]) => {
        if (!body) return;
        if (text) text += " ";
        segments.push({ anchor, start: text.length, prefix, text: body, labels });
        text += prefix + body;
      };
      add(para.anchor, "", para.text, []);
      const walk = (list: LawItem[] | undefined, path: string[]) => {
        for (const it of list ?? []) {
          const labels = it.label ? [...path, it.label] : path;
          add(it.anchor, it.label ? `${it.label} ` : "", it.text, labels);
          walk(it.items, labels);
          if (it.tail) add(it.anchor, "", it.tail, labels);
        }
      };
      walk(para.items, []);
      if (para.tail) add(para.anchor, "", para.tail, []);
      if (!text) continue;
      units.push({
        lawId: law.id,
        provisionAnchor: p.anchor,
        label: p.label,
        ...(p.heading ? { heading: p.heading } : {}),
        foldedHeading: p.heading ? foldText(p.heading) : "",
        anchor: para.anchor,
        ...(para.n ? { n: para.n } : {}),
        text,
        folded: foldText(text),
        segments,
      });
    }
  }
  return units;
}

// ---------------------------------------------------------------------------
// Query terms
// ---------------------------------------------------------------------------

// Folded SK / CZ / EN function words and question words.
const STOPWORDS = new Set(
  (
    "a aj ale alebo ani ak ako aky aka ake akeho alebo by bol bola bolo bude budu ci co do " +
    "for from has have how i in is it je jak jaka jake jaky jako jsou k kam kde kdo kdy kedy " +
    "kolik kolko kto ktora ktore ktory ktera ktere ktery ku ma maju mam mame many mat mi " +
    "moze mozu muze musi musia musim musime na nad nas nase nasho nasom nasem nebo no o od " +
    "of on ona ono or po pod pokial pokud potrebne potreba pre pred pri pro s sa se si so su " +
    "ta tak take takze the to tom treba u v vo ve what when which who why z za ze zo"
  ).split(" ")
);

/** Crude Slavic stemmer: drop the inflection ending, keep a word-start prefix. */
function stem(token: string): string {
  if (token.length <= 4) return token;
  if (token.length <= 6) return token.slice(0, token.length - 1);
  return token.slice(0, token.length - 2);
}

export function queryStems(question: string): string[] {
  const tokens = foldText(question)
    .split(/[^a-z0-9]+/)
    // Digits belong to citations (§ 14b, 182/1993), handled as exact matches.
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/\d/.test(t));
  return [...new Set(tokens.map(stem))];
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface BasisOptions {
  /** lawId → provision anchors on topic; null = the whole act. */
  scope: ReadonlyMap<string, ReadonlySet<string> | null>;
  /**
   * "strict": on-topic hits always rank first (topic chosen by the caller).
   * "boost": on-topic hits get a score bonus only (topic guessed from
   * keywords — a wrong guess must not bury a strong off-topic match).
   */
  scopeMode: "strict" | "boost";
  /** Provision anchors cited in the question ("§ 14b" → p14b), optionally per law. */
  exact: ReadonlyArray<{ lawId?: string; anchor: string }>;
  limit: number;
  /** Max hits from one provision (diversity). */
  perProvision?: number;
}

export interface BasisHit {
  unit: SearchUnit;
  inScope: boolean;
  exact: boolean;
  score: number;
  /** Most specific anchor holding the best match (item or paragraph). */
  anchor: string;
  /** Item labels on the path to `anchor` (for the citation), e.g. ["b)"]. */
  itemLabels: string[];
  snippet: string;
}

const SNIPPET_MAX = 400;
// Footnote references like "¹²ᶜᵃ)" — noise in a snippet.
const FOOTNOTE_REF = /[²³¹⁰-₟ᴬ-ᶿ]+\)/g;

function clean(s: string): string {
  return s.replace(FOOTNOTE_REF, "").replace(/\s+/g, " ").trim();
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

const TOPIC_BOOST = 1.5;
const LEAD_MAX = 160;

/**
 * `max` chars of `text` showing the match at `at`. The paragraph's opening
 * (subject, duty, deadline) is kept: a far match becomes
 * "<opening> … <text around the match>…".
 */
function window(text: string, at: number, max: number): string {
  if (text.length <= max) return text;
  if (at < max * 0.6) return clip(text, max);
  const lead = text.slice(0, LEAD_MAX).replace(/\s+\S*$/, "");
  // Start the second part on a word boundary shortly before the match.
  let start = Math.max(lead.length, at - 40);
  const space = text.indexOf(" ", start);
  if (space !== -1 && space < at) start = space + 1;
  const room = max - lead.length - 4;
  const body = text.slice(start, start + room);
  return `${lead} … ${body}${start + room < text.length ? "…" : ""}`;
}

function makeSnippet(unit: SearchUnit, at: number): { snippet: string; segment: Segment } {
  let seg = unit.segments[0];
  for (const s of unit.segments) if (s.start <= at) seg = s;
  if (seg === unit.segments[0] || !seg.labels.length) {
    // Window on the raw text (match offsets index it), then clean.
    return { snippet: clean(window(unit.text, Math.max(0, at), SNIPPET_MAX)), segment: seg };
  }
  // Match inside an item: lead-in of the paragraph + that item.
  const item = clean(`${seg.prefix || `${seg.labels[seg.labels.length - 1]} … `}${seg.text}`);
  const lead = clip(clean(unit.segments[0].text), Math.max(80, Math.min(LEAD_MAX, SNIPPET_MAX - item.length - 3)));
  return { snippet: clip(`${lead} … ${item}`, SNIPPET_MAX), segment: seg };
}

function stemRegex(s: string, flags = ""): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])${s}`, flags);
}

/**
 * Ranks paragraphs for a question. Order: on-topic first (strict mode),
 * then a § cited in the question, then weighted term overlap. A unit needs
 * at least min(2, #terms) matching terms unless its § was cited explicitly.
 */
export function findBasis(units: readonly SearchUnit[], question: string, opts: BasisOptions): BasisHit[] {
  const stems = queryStems(question);
  if (!stems.length && !opts.exact.length) return [];
  const res = stems.map((s) => stemRegex(s));

  // Pass 1: per-unit matches (first match offset per stem) + document frequency.
  const df = new Array<number>(stems.length).fill(0);
  const matches: Array<{ unit: SearchUnit; at: number[]; exact: boolean }> = [];
  for (const unit of units) {
    const at = res.map((re, i) => {
      const m = re.exec(unit.folded);
      return m ? m.index + (m[0].length - stems[i].length) : -1;
    });
    const exact = opts.exact.some(
      (e) => e.anchor === unit.provisionAnchor && (!e.lawId || e.lawId === unit.lawId)
    );
    let hit = false;
    at.forEach((a, i) => {
      if (a >= 0) {
        df[i]++;
        hit = true;
      }
    });
    if (hit || exact) matches.push({ unit, at, exact });
  }

  const n = units.length || 1;
  const idf = df.map((d) => Math.log(1 + n / (1 + d)));
  const minTerms = Math.min(2, stems.length);

  const scored: BasisHit[] = [];
  for (const { unit, at, exact } of matches) {
    const matched = at.filter((a) => a >= 0).length;
    if (!exact && matched < minTerms) continue;
    let score = 0;
    at.forEach((a, i) => {
      if (a < 0) return;
      score += idf[i];
      if (unit.foldedHeading && res[i].test(unit.foldedHeading)) score += idf[i] / 2;
    });
    if (stems.length) score *= 0.5 + (0.5 * matched) / stems.length;

    const scope = opts.scope.get(unit.lawId);
    const inScope = scope !== undefined && (scope === null || scope.has(unit.provisionAnchor));
    if (inScope && opts.scopeMode === "boost") score *= TOPIC_BOOST;

    // Snippet around the rarest matched term.
    let best = -1;
    at.forEach((a, i) => {
      if (a >= 0 && (best < 0 || idf[i] > idf[best])) best = i;
    });
    const { snippet, segment } = makeSnippet(unit, best >= 0 ? at[best] : 0);
    scored.push({
      unit,
      inScope,
      exact,
      score,
      anchor: segment.anchor,
      itemLabels: segment.labels,
      snippet,
    });
  }

  const strict = opts.scopeMode === "strict";
  scored.sort(
    (a, b) =>
      (strict ? Number(b.inScope) - Number(a.inScope) : 0) ||
      Number(b.exact) - Number(a.exact) ||
      b.score - a.score
  );

  const perProvision = opts.perProvision ?? 2;
  const count = new Map<string, number>();
  const out: BasisHit[] = [];
  for (const hit of scored) {
    const key = `${hit.unit.lawId}#${hit.unit.provisionAnchor}`;
    const c = count.get(key) ?? 0;
    if (c >= perProvision) continue;
    count.set(key, c + 1);
    out.push(hit);
    if (out.length >= opts.limit) break;
  }
  return out;
}
