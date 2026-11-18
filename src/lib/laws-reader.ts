// Pure helpers for the laws reader (/zakony): split a law into chapters
// (one page each), resolve a stable anchor to its chapter, search the
// whole law. No I/O — callers pass a LawDocument from laws.server.ts.

import type { LawDocument, LawItem, LawNode, LawProvision, LawSection } from "./laws";

export interface LawChapter {
  /** 1-based, used in the URL (?kapitola=n). */
  index: number;
  kind: "content" | "footnotes";
  /** Labels of the sections this chapter sits in (e.g. ["Čl. I", "DRUHÁ ČASŤ · …"]). */
  trail: string[];
  /** "PRVÁ ČASŤ · ZÁKLADNÉ USTANOVENIA", "§ 1 – § 9"; empty for the footnotes chapter. */
  title: string;
  nodes: LawNode[];
  provisions: { anchor: string; label: string; heading?: string }[];
  /** Render the law's footnotes below this chapter (single-page acts). */
  withFootnotes?: boolean;
}

/** Acts up to this many provisions are read on a single page. */
const WHOLE_ACT_MAX_PROVISIONS = 40;
/** A part (časť) bigger than this is split into its hlavy / oddiely. */
const CHAPTER_SPLIT_PROVISIONS = 60;

export function sectionTitle(s: Pick<LawSection, "label" | "heading">): string {
  return [s.label, s.heading].filter(Boolean).join(" · ");
}

function countProvisions(nodes: LawNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "provision") n++;
    else if (node.type === "section") n += countProvisions(node.children);
  }
  return n;
}

function collectProvisions(nodes: LawNode[], out: LawProvision[] = []): LawProvision[] {
  for (const node of nodes) {
    if (node.type === "provision") out.push(node);
    else if (node.type === "section") collectProvisions(node.children, out);
  }
  return out;
}

interface DraftChapter {
  trail: string[];
  title: string;
  nodes: LawNode[];
}

function looseTitle(nodes: LawNode[]): string {
  const provisions = collectProvisions(nodes);
  if (!provisions.length) return "";
  const first = provisions[0].label;
  const last = provisions[provisions.length - 1].label;
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Text / headings that stand before any provision (e.g. the enacting
 * formula) are carried into the next chapter instead of becoming a page.
 */
function splitNodes(nodes: LawNode[], trail: string[], out: DraftChapter[], carry: LawNode[]): void {
  let loose: LawNode[] = [];
  const push = (chapter: DraftChapter) => {
    if (carry.length) chapter.nodes = [...carry.splice(0), ...chapter.nodes];
    out.push(chapter);
  };
  const flushLoose = () => {
    if (!loose.length) return;
    const title = looseTitle(loose);
    if (title) push({ trail, title, nodes: loose });
    else carry.push(...loose);
    loose = [];
  };

  for (const node of nodes) {
    if (node.type !== "section") {
      loose.push(node);
      continue;
    }
    flushLoose();
    const hasSubsections = node.children.some((c) => c.type === "section");
    const big = countProvisions(node.children) > CHAPTER_SPLIT_PROVISIONS;
    // An article (Čl. I) that wraps the whole act is never a chapter itself.
    const wrapper = node.kind === "clanok";
    if (hasSubsections && (big || wrapper)) {
      splitNodes(node.children, [...trail, sectionTitle(node)], out, carry);
    } else {
      push({ trail, title: sectionTitle(node), nodes: [node] });
    }
  }
  flushLoose();
}

function toChapter(draft: DraftChapter, index: number): LawChapter {
  return {
    index,
    kind: "content",
    trail: draft.trail,
    title: draft.title,
    nodes: draft.nodes,
    provisions: collectProvisions(draft.nodes).map((p) => ({
      anchor: p.anchor,
      label: p.label,
      ...(p.heading ? { heading: p.heading } : {}),
    })),
  };
}

const chapterCache = new WeakMap<LawDocument, LawChapter[]>();

/**
 * Chapters of a law, in reading order.
 * - ≤ 40 provisions: the whole act is one chapter.
 * - Otherwise each top-level section (časť / hlava / článok …) is a chapter;
 *   a wrapping "Čl. I" is opened, and a section with more than 60 provisions
 *   is split into its sub-sections. Consecutive provisions outside any
 *   section form one chapter ("§ 1 – § 9").
 * - Footnotes, when present, are the last chapter (end of the page for a
 *   single-page act).
 */
export function getChapters(law: LawDocument): LawChapter[] {
  const cached = chapterCache.get(law);
  if (cached) return cached;

  const drafts: DraftChapter[] = [];
  if (countProvisions(law.parts) <= WHOLE_ACT_MAX_PROVISIONS) {
    drafts.push({ trail: [], title: "", nodes: law.parts });
  } else {
    const carry: LawNode[] = [];
    splitNodes(law.parts, [], drafts, carry);
    if (carry.length) {
      if (drafts.length) drafts[drafts.length - 1].nodes.push(...carry);
      else drafts.push({ trail: [], title: "", nodes: carry });
    }
  }
  const chapters = drafts.map((d, i) => toChapter(d, i + 1));
  if (law.footnotes.length && chapters.length === 1) {
    // Single-page act: footnotes go at the end of that page.
    chapters[0].withFootnotes = true;
  } else if (law.footnotes.length) {
    chapters.push({
      index: chapters.length + 1,
      kind: "footnotes",
      trail: [],
      title: "",
      nodes: [],
      provisions: [],
    });
  }
  chapterCache.set(law, chapters);
  return chapters;
}

function collectAnchors(nodes: LawNode[], add: (anchor: string) => void): void {
  const items = (list: LawItem[] | undefined) => {
    for (const it of list ?? []) {
      add(it.anchor);
      items(it.items);
    }
  };
  for (const node of nodes) {
    if (node.type === "text") continue;
    add(node.anchor);
    if (node.type === "section") collectAnchors(node.children, add);
    else if (node.type === "provision") {
      for (const p of node.paragraphs) {
        add(p.anchor);
        items(p.items);
      }
    }
  }
}

const anchorCache = new WeakMap<LawDocument, Map<string, number>>();

/** Chapter index that contains `anchor`, or null for an unknown anchor. */
export function findChapterForAnchor(law: LawDocument, anchor: string): number | null {
  let map = anchorCache.get(law);
  if (!map) {
    const m = new Map<string, number>();
    for (const ch of getChapters(law)) {
      if (ch.kind === "footnotes" || ch.withFootnotes) {
        for (const f of law.footnotes) m.set(f.anchor, ch.index);
      }
      if (ch.kind === "content") {
        collectAnchors(ch.nodes, (a) => {
          if (!m.has(a)) m.set(a, ch.index);
        });
      }
    }
    map = m;
    anchorCache.set(law, map);
  }
  return map.get(anchor) ?? null;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Lowercase + strip diacritics, one output char per input UTF-16 unit. */
export function foldText(s: string): string {
  return s.toLowerCase().replace(/[^\u0000-\u007f]/g, (c) => c.normalize("NFD")[0] ?? c);
}

export interface LawSearchHit {
  chapter: number;
  /** Most specific anchor holding the match (paragraph / item / provision). */
  anchor: string;
  /** Provision label, e.g. "§ 14". */
  label: string;
  heading?: string;
  /** Plain-text snippet split around the match (render the match in <mark>). */
  before: string;
  match: string;
  after: string;
}

export interface LawSearchResult {
  hits: LawSearchHit[];
  /** Number of matching provisions (hits are capped). */
  total: number;
  /** Provision whose label equals the query ("§ 14"), for a direct jump. */
  exact: { chapter: number; anchor: string; label: string } | null;
}

const SNIPPET_RADIUS = 80;

function snippet(text: string, at: number, len: number) {
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + len + SNIPPET_RADIUS);
  const clean = (s: string) => s.replace(/\s+/g, " ");
  return {
    before: (start > 0 ? "…" : "") + clean(text.slice(start, at)).trimStart(),
    match: text.slice(at, at + len),
    after: clean(text.slice(at + len, end)).trimEnd() + (end < text.length ? "…" : ""),
  };
}

function provisionUnits(p: LawProvision): { anchor: string; text: string }[] {
  const units: { anchor: string; text: string }[] = [];
  if (p.heading) units.push({ anchor: p.anchor, text: p.heading });
  const items = (list: LawItem[] | undefined) => {
    for (const it of list ?? []) {
      units.push({ anchor: it.anchor, text: it.text });
      items(it.items);
      if (it.tail) units.push({ anchor: it.anchor, text: it.tail });
    }
  };
  for (const para of p.paragraphs) {
    units.push({ anchor: para.anchor, text: para.text });
    items(para.items);
    if (para.tail) units.push({ anchor: para.anchor, text: para.tail });
  }
  return units;
}

/** Full-text search over every chapter; diacritics- and case-insensitive. */
export function searchLaw(law: LawDocument, query: string, limit = 50): LawSearchResult {
  const q = foldText(query.trim().replace(/\s+/g, " "));
  const result: LawSearchResult = { hits: [], total: 0, exact: null };
  if (q.length < 2) return result;

  const labelQuery = q.replace(/^§\s*/, "§ ");
  for (const ch of getChapters(law)) {
    if (ch.kind !== "content") continue;
    for (const p of collectProvisions(ch.nodes)) {
      if (!result.exact && foldText(p.label) === labelQuery) {
        result.exact = { chapter: ch.index, anchor: p.anchor, label: p.label };
      }
      for (const unit of provisionUnits(p)) {
        const at = foldText(unit.text).indexOf(q);
        if (at === -1) continue;
        result.total++;
        if (result.hits.length < limit) {
          result.hits.push({
            chapter: ch.index,
            anchor: unit.anchor,
            label: p.label,
            ...(p.heading ? { heading: p.heading } : {}),
            ...snippet(unit.text, at, q.length),
          });
        }
        break; // one hit per provision
      }
    }
  }
  return result;
}
