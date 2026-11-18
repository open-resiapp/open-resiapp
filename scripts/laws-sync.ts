#!/usr/bin/env node
/**
 * `pnpm laws:sync` — download the current consolidated text of the laws in
 * CATALOG and write them as committed JSON under `data/laws/`.
 *
 * Developer / operator tool, NOT a runtime job: the app only reads the
 * committed files (src/lib/laws.server.ts). Re-run it by hand when laws
 * change, review the diff, commit.
 *
 * Sources
 *   SK  Slov-Lex static portal. The history page
 *       https://static.slov-lex.sk/static/SK/ZZ/<year>/<number>/ lists every
 *       consolidated version with data-ucinnostod / data-ucinnostdo; we pick
 *       the one effective today and parse <YYYYMMDD>.html (semantic
 *       `<kind> Skupina` divs with stable ids such as `paragraf-14.odsek-4`).
 *   CZ  e-Sbírka public API (sbr-cache, used by e-sbirka.gov.cz itself):
 *       GET /sbr-cache/dokumenty-sbirky/<staleUrl>            → version metadata
 *       GET /sbr-cache/dokumenty-sbirky/<staleUrl>/fragmenty  → paged flat
 *           fragment list (type, depth, ELI path, xhtml)
 *       Asking for `/sb/<year>/<number>/<today>` resolves to the version
 *       effective today.
 *
 * Output is plain text only (all markup stripped).
 *
 * Usage
 *   pnpm laws:sync                       # whole catalog
 *   pnpm laws:sync --only sk-182-1993    # comma-separated ids
 *   pnpm laws:sync --cache /tmp/laws     # reuse HTTP responses (parser dev)
 */
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import type {
  LawDocument,
  LawFootnote,
  LawIndex,
  LawItem,
  LawJurisdiction,
  LawMeta,
  LawNode,
  LawParagraph,
  LawProvision,
} from "../src/lib/laws";

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

interface CatalogEntry {
  jurisdiction: LawJurisdiction;
  year: number;
  number: number;
  /** Keep only provisions § from..to (inclusive) — for very large codes. */
  range?: { from: number; to: number; scope: string };
}

const CATALOG: CatalogEntry[] = [
  // Slovakia
  { jurisdiction: "sk", year: 1993, number: 182 }, // o vlastníctve bytov a nebytových priestorov
  { jurisdiction: "sk", year: 2015, number: 246 }, // o správcoch bytových domov
  { jurisdiction: "sk", year: 1964, number: 40 }, // Občiansky zákonník (whole)
  { jurisdiction: "sk", year: 2002, number: 431 }, // o účtovníctve
  { jurisdiction: "sk", year: 2018, number: 18 }, // o ochrane osobných údajov
  { jurisdiction: "sk", year: 2005, number: 555 }, // o energetickej hospodárnosti budov
  { jurisdiction: "sk", year: 2004, number: 657 }, // o tepelnej energetike
  { jurisdiction: "sk", year: 2013, number: 150 }, // o Štátnom fonde rozvoja bývania
  { jurisdiction: "sk", year: 2025, number: 25 }, // stavebný zákon
  { jurisdiction: "sk", year: 2001, number: 314 }, // o ochrane pred požiarmi
  { jurisdiction: "sk", year: 2009, number: 508 }, // vyhláška — technické zariadenia
  // Czechia
  {
    jurisdiction: "cz",
    year: 2012,
    number: 89,
    range: { from: 1158, to: 1222, scope: "§ 1158 – § 1222 (bytové spoluvlastnictví)" },
  },
  { jurisdiction: "cz", year: 2013, number: 366 }, // NV o bytovém spoluvlastnictví
  { jurisdiction: "cz", year: 2013, number: 67 }, // služby spojené s užíváním bytů
  { jurisdiction: "cz", year: 1991, number: 563 }, // o účetnictví
  { jurisdiction: "cz", year: 2015, number: 269 }, // vyhláška o rozúčtování tepla a TV
];

const USER_AGENT = "open-housing-laws-sync/1.0";
const REQUEST_DELAY_MS = 800;
// Run from the repository root (pnpm scripts do).
const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "data", "laws");

const lawId = (e: CatalogEntry) => `${e.jurisdiction}-${e.number}-${e.year}`;

function todayIso(): string {
  // sv-SE formats as YYYY-MM-DD; use the region's civil date.
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bratislava" }).format(new Date());
}

// ---------------------------------------------------------------------------
// HTTP (sequential, polite, optional on-disk cache for parser development)
// ---------------------------------------------------------------------------

let cacheDir: string | null = null;
let lastRequestAt = 0;

async function httpGet(url: string): Promise<string> {
  const cacheFile = cacheDir
    ? path.join(cacheDir, createHash("sha1").update(url).digest("hex"))
    : null;
  if (cacheFile) {
    try {
      return await fs.readFile(cacheFile, "utf8");
    } catch {
      /* miss */
    }
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const wait = lastRequestAt + REQUEST_DELAY_MS * attempt - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json" },
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const body = await res.text();
      if (cacheFile) await fs.writeFile(cacheFile, body, "utf8");
      return body;
    } catch (err) {
      lastError = err;
      if (err instanceof Error && /HTTP 4\d\d/.test(err.message)) break;
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Minimal HTML tree parser (sources are machine-generated, well-formed)
// ---------------------------------------------------------------------------

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}
type Node = El | string;

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
]);
const RAW_TEXT_TAGS = new Set(["script", "style"]);

const TAG_RE =
  /<!--[\s\S]*?-->|<![^>]*>|<\?[\s\S]*?\?>|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

function parseHtml(src: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  let pos = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(src))) {
    const top = stack[stack.length - 1];
    if (m.index > pos) top.children.push(src.slice(pos, m.index));
    pos = TAG_RE.lastIndex;
    if (!m[2]) continue; // comment / doctype / PI
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    let a: RegExpExecArray | null;
    while ((a = ATTR_RE.exec(m[3] ?? ""))) {
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
    }
    const el: El = { tag, attrs, children: [] };
    top.children.push(el);
    if (RAW_TEXT_TAGS.has(tag)) {
      const close = src.toLowerCase().indexOf(`</${tag}`, pos);
      const end = close === -1 ? src.length : close;
      pos = src.indexOf(">", end) + 1 || src.length;
      TAG_RE.lastIndex = pos;
      continue;
    }
    if (!m[4] && !VOID_TAGS.has(tag)) stack.push(el);
  }
  if (pos < src.length) stack[stack.length - 1].children.push(src.slice(pos));
  return root;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—",
  bdquo: "„", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", sbquo: "‚", hellip: "…",
  sect: "§", deg: "°", times: "×", minus: "−", shy: "", euro: "€", middot: "·", bull: "•",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const classesOf = (el: El) => (el.attrs.class ?? "").split(/\s+/).filter(Boolean);

function findById(node: El, id: string): El | null {
  if (node.attrs.id === id) return node;
  for (const c of node.children) {
    if (typeof c !== "string") {
      const hit = findById(c, id);
      if (hit) return hit;
    }
  }
  return null;
}

// --- text extraction -------------------------------------------------------

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻",
  a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", f: "ᶠ", g: "ᵍ", h: "ʰ", i: "ⁱ", j: "ʲ", k: "ᵏ", l: "ˡ", m: "ᵐ",
  n: "ⁿ", o: "ᵒ", p: "ᵖ", r: "ʳ", s: "ˢ", t: "ᵗ", u: "ᵘ", v: "ᵛ", w: "ʷ", x: "ˣ", y: "ʸ", z: "ᶻ",
};
const SUBSCRIPT: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋",
};
const BLOCK_TAGS = new Set(["div", "p", "table", "tbody", "thead", "tr", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "math"]);
const BR = "\u0000";

interface TextOptions {
  /** Elements to leave out entirely (e.g. nested structural groups). */
  skip?: (el: El) => boolean;
  /** Map numeric <sup>/<sub> to Unicode super/subscripts (body text). */
  scripts?: boolean;
}

function rawText(nodes: Node[], opts: TextOptions): string {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") {
      out += decodeEntities(n).replace(/\s+/g, " ");
      continue;
    }
    if (opts.skip?.(n)) continue;
    const tag = n.tag;
    if (tag === "br") {
      out += BR;
      continue;
    }
    if (tag === "img" || tag === "script" || tag === "style") continue;
    const inner = rawText(n.children, opts);
    switch (tag) {
      case "sup": {
        const t = inner.trim();
        out += opts.scripts && /^[0-9+-]+[a-pr-z]{0,2}$/.test(t) ? [...t].map((c) => SUPERSCRIPT[c]).join("") : t;
        break;
      }
      case "sub": {
        const t = inner.trim();
        if (!opts.scripts) out += t;
        else out += /^[0-9+-]+$/.test(t) ? [...t].map((c) => SUBSCRIPT[c]).join("") : t ? `_${t}` : "";
        break;
      }
      case "td":
      case "th":
        out += ` ${inner.trim()} |`;
        break;
      case "tr":
        out += `${BR}|${inner}${BR}`;
        break;
      // MathML → linear text
      case "mfrac": {
        const parts = n.children.filter((c): c is El => typeof c !== "string").map((c) => rawText([c], opts).trim());
        out += parts.length === 2 ? `(${parts[0]})/(${parts[1]})` : parts.join("/");
        break;
      }
      case "msub":
      case "msup": {
        const parts = n.children.filter((c): c is El => typeof c !== "string").map((c) => rawText([c], opts).trim());
        out += parts.length === 2 ? `${parts[0]}${tag === "msub" ? "_" : "^"}${parts[1]}` : parts.join("");
        break;
      }
      default:
        out += BLOCK_TAGS.has(tag) ? `${BR}${inner}${BR}` : inner;
    }
  }
  return out;
}

function cleanText(raw: string): string {
  return raw
    .split(BR)
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function textOf(nodes: Node[], opts: TextOptions = { scripts: true }): string {
  return cleanText(rawText(nodes, opts));
}

// ---------------------------------------------------------------------------
// Intermediate tree shared by both sources
// ---------------------------------------------------------------------------

type Role = "section" | "provision" | "paragraph" | "item" | "heading" | "text";

interface Raw {
  role: Role;
  kind: string;
  /** Source identifier used to derive the stable anchor. */
  key: string;
  label?: string;
  heading?: string;
  text?: string;
  children: Raw[];
}

// --- anchors ---------------------------------------------------------------

function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

class AnchorAllocator {
  private used = new Set<string>();
  take(base: string): string {
    let candidate = base;
    for (let i = 2; this.used.has(candidate); i++) candidate = `${base}~${i}`;
    this.used.add(candidate);
    return candidate;
  }
}

function provisionKey(key: string, label: string): string {
  let m = key.match(/(?:^|[.\/])(?:paragraf-|par_)(\d+[a-z]*)$/i);
  if (m) return `p${m[1].toLowerCase()}`;
  m = key.match(/(?:clanok-|clanek_|cl_)(\d+[a-z]*)$/i);
  if (m) return `cl${m[1].toLowerCase()}`;
  m = key.match(/priloha(?:_c)?[_-](\d+[a-z]*)/i);
  if (m) return `priloha${m[1].toLowerCase()}`;
  m = label.match(/^§\s*(\d+[a-z]*)$/i);
  if (m) return `p${m[1].toLowerCase()}`;
  return slug(label || key) || "x";
}

function itemLetter(label: string): string | null {
  const m = label.trim().match(/^\(?([0-9]{1,3}[a-z]{0,2}|[a-z]{1,2}|[ivxlc]+)[).]?$/i);
  return m ? m[1].toLowerCase() : null;
}

// --- Raw → LawNode ---------------------------------------------------------

function joinText(parts: string[]): string {
  return parts.filter(Boolean).join("\n");
}

function buildItems(children: Raw[], parentAnchor: string, anchors: AnchorAllocator) {
  const items: LawItem[] = [];
  const before: string[] = [];
  const after: string[] = [];
  let idx = 0;
  for (const c of children) {
    if (c.role === "text" || c.role === "heading") {
      (items.length ? after : before).push(c.text ?? "");
      continue;
    }
    idx++;
    let label = c.label ?? "";
    let letter = itemLetter(label);
    let ownText = c.text ?? "";
    if (label && !letter && label.length > 8) {
      // Long "labels" are really sub-headings (annex structure).
      ownText = joinText([label, ownText]);
      label = "";
    }
    if (!letter) letter = `i${idx}`;
    const anchor = anchors.take(`${parentAnchor}-${letter}`);
    const nested = buildItems(c.children, anchor, anchors);
    const item: LawItem = {
      anchor,
      label,
      letter,
      text: joinText([ownText, nested.text]),
    };
    if (nested.items.length) item.items = nested.items;
    if (nested.tail) item.tail = nested.tail;
    items.push(item);
  }
  return { items, text: joinText(before), tail: joinText(after) };
}

function buildParagraph(raw: Raw, provAnchor: string, index: number, anchors: AnchorAllocator): LawParagraph {
  const label = (raw.label ?? "").trim();
  const nm = label.match(/^\((\d+[a-z]*)\)$/i);
  const n = nm ? nm[1].toLowerCase() : undefined;
  const anchor = anchors.take(n ? `${provAnchor}-${n}` : `${provAnchor}-x${index}`);
  const built = buildItems(raw.children, anchor, anchors);
  const para: LawParagraph = { anchor, text: joinText([raw.text ?? "", built.text]) };
  if (n) para.n = n;
  else if (label) para.text = joinText([label, para.text]);
  if (built.items.length) para.items = built.items;
  if (built.tail) para.tail = built.tail;
  return para;
}

function buildProvision(raw: Raw, anchors: AnchorAllocator): LawProvision {
  const label = (raw.label ?? "").trim();
  const anchor = anchors.take(provisionKey(raw.key, label));
  const paragraphs: LawParagraph[] = [];
  let pending: Raw[] = [];
  let unnumbered = 0;
  const flush = () => {
    if (!pending.length) return;
    unnumbered++;
    paragraphs.push(
      buildParagraph({ role: "paragraph", kind: "implicit", key: "", children: pending }, anchor, unnumbered, anchors),
    );
    pending = [];
  };
  if (raw.text) pending.push({ role: "text", kind: "text", key: "", text: raw.text, children: [] });
  for (const c of raw.children) {
    if (c.role === "paragraph") {
      flush();
      if (!/^\(\d+[a-z]*\)$/i.test((c.label ?? "").trim())) unnumbered++;
      paragraphs.push(buildParagraph(c, anchor, unnumbered, anchors));
    } else {
      pending.push(c);
    }
  }
  flush();
  const prov: LawProvision = { type: "provision", anchor, label, paragraphs };
  if (raw.heading) prov.heading = raw.heading;
  return prov;
}

function buildNodes(children: Raw[], anchors: AnchorAllocator, sectionPath: string): LawNode[] {
  const out: LawNode[] = [];
  for (const c of children) {
    switch (c.role) {
      case "section": {
        const keyPart = slug(c.key.replace(/skupinaParagrafov-/gi, "g-")) || slug(c.label ?? "") || "s";
        const pathKey = sectionPath ? `${sectionPath}-${keyPart}` : keyPart;
        const anchor = anchors.take(`s-${pathKey}`);
        const kids = buildNodes(c.children, anchors, pathKey);
        if (!kids.length && !c.heading && !c.label) break;
        out.push({
          type: "section",
          anchor,
          kind: c.kind,
          ...(c.label ? { label: c.label } : {}),
          ...(c.heading ? { heading: c.heading } : {}),
          children: kids,
        });
        break;
      }
      case "provision":
        out.push(buildProvision(c, anchors));
        break;
      case "heading":
        if (c.text) out.push({ type: "heading", anchor: anchors.take(`h-${slug(c.text) || "x"}`), text: c.text });
        break;
      case "text":
        if (c.text) out.push({ type: "text", text: c.text });
        break;
      default:
        // Paragraph / item outside a provision: wrap so nothing is lost.
        out.push(buildProvision({ role: "provision", kind: "implicit", key: c.key, label: "", children: [c] }, anchors));
    }
  }
  return out;
}

function provisionNumber(anchor: string): number | null {
  const m = anchor.match(/^p(\d+)/);
  return m ? Number(m[1]) : null;
}

/** Keep only provisions §from..§to and the structure around them. */
function restrictRange(nodes: LawNode[], from: number, to: number): LawNode[] {
  const kept: LawNode[] = [];
  for (const n of nodes) {
    if (n.type === "provision") {
      const num = provisionNumber(n.anchor);
      if (num !== null && num >= from && num <= to) kept.push(n);
    } else if (n.type === "section") {
      const kids = restrictRange(n.children, from, to);
      if (kids.some((k) => k.type !== "heading")) kept.push({ ...n, children: kids });
    } else if (n.type === "heading") {
      kept.push(n);
    }
  }
  // Drop headings that no longer introduce anything.
  return kept.filter((n, i) => n.type !== "heading" || (kept[i + 1] && kept[i + 1].type !== "heading"));
}

function countProvisions(nodes: LawNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.type === "provision") n++;
    else if (node.type === "section") n += countProvisions(node.children);
  }
  return n;
}

// ---------------------------------------------------------------------------
// SK — Slov-Lex
// ---------------------------------------------------------------------------

const SK_SECTION_KINDS = new Set([
  "cast", "hlava", "diel", "oddiel", "pododdiel", "skupinaParagrafov", "prilohy",
]);

function skKind(el: El): string | null {
  const cls = classesOf(el);
  return cls.includes("Skupina") ? cls[0] : null;
}

function skRole(kind: string, el: El): Role {
  if (kind === "paragraf" || kind === "priloha") return "provision";
  if (kind === "clanok") {
    // An article that holds paragraphs is a container; otherwise it is the provision.
    return containsKind(el, "paragraf") ? "section" : "provision";
  }
  if (SK_SECTION_KINDS.has(kind)) return "section";
  if (kind === "odsek") return "paragraph";
  return "item";
}

function containsKind(el: El, kind: string): boolean {
  for (const c of el.children) {
    if (typeof c === "string") continue;
    if (skKind(c) === kind) return true;
    if (containsKind(c, kind)) return true;
  }
  return false;
}

/** Walk the children of a Skupina (or a text div inside one), in order. */
function skWalk(el: El, raw: Raw, buffer: Node[] | null): void {
  let buf: Node[] = buffer ?? [];
  const flush = () => {
    const t = textOf(buf);
    if (t) raw.children.push({ role: "text", kind: "text", key: "", text: t, children: [] });
    buf = [];
  };
  for (const c of el.children) {
    if (typeof c === "string") {
      buf.push(c);
      continue;
    }
    const kind = skKind(c);
    if (kind) {
      flush();
      raw.children.push(skRaw(c, kind));
      continue;
    }
    const cls = classesOf(c)[0] ?? "";
    if (cls.endsWith("Oznacenie")) {
      raw.label = textOf([c], { scripts: false });
    } else if (cls.endsWith("Nadpis")) {
      raw.heading = textOf([c]);
    } else if (cls === "text") {
      flush();
      skWalk(c, raw, null);
    } else if (c.tag === "div" && containsAnySkupina(c)) {
      flush();
      skWalk(c, raw, null);
    } else {
      buf.push(c);
    }
  }
  flush();
}

function containsAnySkupina(el: El): boolean {
  for (const c of el.children) {
    if (typeof c === "string") continue;
    if (skKind(c) || containsAnySkupina(c)) return true;
  }
  return false;
}

function skRaw(el: El, kind: string): Raw {
  const role = skRole(kind, el);
  const id = el.attrs.id ?? "";
  // Sections: last id segment only; buildNodes prefixes the parent path.
  const key = role === "section" ? id.split(".").pop() ?? id : id;
  const raw: Raw = { role, kind: kind === "skupinaParagrafov" ? "group" : kind, key, children: [] };
  skWalk(el, raw, null);
  if (role === "section" && kind === "skupinaParagrafov" && raw.label && !raw.heading) {
    raw.heading = raw.label;
    raw.label = undefined;
  }
  // Text directly inside a provision/paragraph (no item yet) is its own text.
  if (role === "provision" || role === "paragraph" || role === "item") {
    const first = raw.children[0];
    if (first && first.role === "text") {
      raw.text = first.text;
      raw.children.shift();
    }
  }
  return raw;
}

interface SkVersion {
  date: string; // YYYYMMDD
  from: string;
  to: string | null;
}

function pickSkVersion(historyHtml: string, today: string): SkVersion {
  const rows = [...historyHtml.matchAll(
    /data-iri="[^"]*\/(\d{8})"\s+data-vyhlasene="([01])"\s+data-ucinnostod="([^"]*)"\s+data-ucinnostdo="([^"]*)"/g,
  )]
    .filter((m) => m[2] === "0" && m[3])
    .map((m) => ({ date: m[1], from: m[3], to: m[4] || null }));
  if (!rows.length) throw new Error("no consolidated versions in history");
  const current = rows.filter((r) => r.from <= today && (!r.to || r.to >= today));
  if (current.length) return current[current.length - 1];
  const past = rows.filter((r) => r.from <= today);
  if (past.length) return past[past.length - 1];
  throw new Error(`no version effective on ${today}`);
}

async function syncSk(entry: CatalogEntry, today: string) {
  const base = `https://static.slov-lex.sk/static/SK/ZZ/${entry.year}/${entry.number}/`;
  const version = pickSkVersion(await httpGet(base), today);
  const html = await httpGet(`${base}${version.date}.html`);
  const doc = parseHtml(html);

  const predpis = findById(doc, "predpis");
  if (!predpis) throw new Error("#predpis not found");
  const h1 = html.match(/<h1>([^<]+)<\/h1>/);
  const number = h1 ? decodeEntities(h1[1]).replace(/\s+/g, " ").trim() : `${entry.number}/${entry.year} Z. z.`;

  // Official title from the portal page <title> ("182/1993 Zb. Zákon … | Slov-Lex").
  let title = "";
  try {
    const page = await httpGet(`https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/${entry.year}/${entry.number}/`);
    const t = page.match(/<title>([^<]+)<\/title>/);
    if (t) {
      title = decodeEntities(t[1])
        .replace(/\s*\|\s*Slov-Lex\s*$/, "")
        .replace(/^\s*\d+\/\d{4}\s+(?:Zb\.|Z\.\s*z\.)\s*/, "")
        .trim();
    }
  } catch {
    /* fall back to the in-document heading */
  }
  if (!title) {
    const typ = textOf([findById(predpis, "predpis.typ") ?? { tag: "x", attrs: {}, children: [] }]);
    const nadpis = textOf([findById(predpis, "predpis.nadpis") ?? { tag: "x", attrs: {}, children: [] }]);
    title = [typ.charAt(0) + typ.slice(1).toLowerCase(), nadpis].filter(Boolean).join(" ");
  }

  const root: Raw = { role: "section", kind: "predpis", key: "", children: [] };
  for (const c of predpis.children) {
    if (typeof c === "string") continue;
    const kind = skKind(c);
    if (kind) root.children.push(skRaw(c, kind));
    else if (c.attrs.id === "predpis.text") {
      const t = textOf([c]);
      if (t) root.children.push({ role: "text", kind: "text", key: "", text: t, children: [] });
    }
  }
  const prilohy = findById(doc, "prilohy");
  if (prilohy) {
    const annex: Raw = { role: "section", kind: "prilohy", key: "prilohy", label: "Prílohy", children: [] };
    for (const c of prilohy.children) {
      if (typeof c !== "string" && skKind(c)) annex.children.push(skRaw(c, skKind(c)!));
    }
    if (annex.children.length) root.children.push(annex);
  }

  const anchors = new AnchorAllocator();
  const parts = buildNodes(root.children, anchors, "");

  const footnotes: LawFootnote[] = [];
  const poznamky = findById(doc, "poznamky");
  if (poznamky) {
    for (const c of poznamky.children) {
      if (typeof c === "string" || skKind(c) !== "poznamka") continue;
      const raw = skRaw(c, "poznamka");
      const label = (raw.label ?? "").trim();
      const n = label.replace(/\)$/, "") || String(footnotes.length + 1);
      footnotes.push({
        anchor: anchors.take(`fn-${slug(n) || footnotes.length + 1}`),
        label,
        text: joinText([raw.text ?? "", ...raw.children.map((k) => k.text ?? "")]),
      });
    }
  }

  return {
    number,
    title,
    effectiveFrom: version.from,
    effectiveTo: version.to,
    sourceUrl: `https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/${entry.year}/${entry.number}/${version.date}`,
    parts,
    footnotes,
  };
}

// ---------------------------------------------------------------------------
// CZ — e-Sbírka
// ---------------------------------------------------------------------------

const ESB = "https://e-sbirka.gov.cz/sbr-cache/dokumenty-sbirky/";

interface EsbFragment {
  id: number;
  eli: string;
  kodTypuFragmentu: string;
  hloubka: number;
  xhtml?: string;
}

interface EsbMeta {
  staleUrl: string;
  typZneni: string;
  datumUcinnostiZneniOd: string;
  datumUcinnostiZneniDo?: string;
  kodDokumentuSbirky: string;
  uplnaCitace: string;
}

const CZ_TRANSPARENT = new Set([
  "Virtual_Document", "Virtual_Norma", "Virtual_Prilohy", "Virtual_Novela", "Block_Priloha",
]);
const CZ_SECTION = new Set(["Cast", "Hlava", "Dil", "Oddil", "Pododdil"]);
const CZ_PROVISION = new Set(["Paragraf", "Clanek", "Hlavicka_priloha"]);

interface CzNode {
  frag: EsbFragment;
  children: CzNode[];
}

function czLabelAndText(xhtml: string): { label: string; text: string } {
  const tree = parseHtml(xhtml);
  const first = tree.children.find((c) => typeof c !== "string" || c.trim());
  if (first && typeof first !== "string" && first.tag === "var") {
    const rest = tree.children.slice(tree.children.indexOf(first) + 1);
    return { label: textOf([first], { scripts: false }), text: textOf(rest) };
  }
  return { label: "", text: textOf(tree.children) };
}

function czKey(eli: string): string {
  return eli.split("/").pop() ?? "";
}

function czRaw(node: CzNode, out: Raw[]): void {
  const type = node.frag.kodTypuFragmentu;
  if (type.startsWith("Block_") || CZ_TRANSPARENT.has(type)) {
    for (const c of node.children) czRaw(c, out);
    return;
  }
  if (type === "Virtual_Prefix") {
    const prefix = node.children.find((c) => c.frag.kodTypuFragmentu === "Prefix");
    if (prefix?.frag.xhtml) {
      const t = czLabelAndText(prefix.frag.xhtml).text;
      if (t) out.push({ role: "text", kind: "text", key: "", text: t, children: [] });
    }
    return;
  }
  if (type === "Virtual_Postfix" || type === "Virtual_PPC" || type.startsWith("Prefix") || type === "Postfix") return;

  const { label, text } = node.frag.xhtml ? czLabelAndText(node.frag.xhtml) : { label: "", text: "" };
  const eliPath = node.frag.eli.split("/dokument/")[1] ?? czKey(node.frag.eli);

  if (type === "Nadpis_nad") {
    out.push({ role: "heading", kind: "heading", key: "", text: joinText([label, text]), children: [] });
    return;
  }
  if (type === "Pokracovani_Text") {
    out.push({ role: "text", kind: "text", key: "", text: joinText([label, text]), children: [] });
    return;
  }

  let role: Role;
  if (CZ_SECTION.has(type)) role = "section";
  else if (CZ_PROVISION.has(type)) role = "provision";
  else if (type === "Odstavec_Dc") role = "paragraph";
  else role = "item";

  const raw: Raw = {
    role,
    kind: type.toLowerCase(),
    key: czKey(node.frag.eli),
    label: label || undefined,
    children: [],
  };
  let ownText = text;
  if (type === "Hlavicka_priloha") {
    // "<var>Příloha č. 1</var> k vyhlášce č. 269/2015 Sb."
    raw.label = joinText([label, text]).replace(/\n/g, " ");
    raw.key = eliPath;
    ownText = "";
  }
  if (role === "section" && !label && text) raw.label = text;
  else if (ownText) raw.text = ownText;

  for (const c of node.children) {
    const ct = c.frag.kodTypuFragmentu;
    const isHeadingFrag = ct === "Nadpis_pod" || (ct === "Nadpis" && role === "provision");
    if (isHeadingFrag && !raw.heading && (role === "section" || role === "provision") && raw.children.length === 0) {
      raw.heading = c.frag.xhtml ? joinText(Object.values(czLabelAndText(c.frag.xhtml))) : undefined;
      continue;
    }
    if (ct === "Nadpis_pod") {
      raw.children.push({
        role: "heading",
        kind: "heading",
        key: "",
        text: c.frag.xhtml ? joinText(Object.values(czLabelAndText(c.frag.xhtml))) : "",
        children: [],
      });
      continue;
    }
    czRaw(c, raw.children);
  }
  out.push(raw);
}

async function syncCz(entry: CatalogEntry, today: string) {
  const stale = (s: string) => encodeURIComponent(s);
  const meta = JSON.parse(await httpGet(`${ESB}${stale(`/sb/${entry.year}/${entry.number}/${today}`)}`)) as EsbMeta;
  if (!meta.staleUrl) throw new Error("e-Sbírka: no version metadata");

  const fragments: EsbFragment[] = [];
  for (let page = 0, pages = 1; page < pages; page++) {
    const body = JSON.parse(
      await httpGet(`${ESB}${stale(meta.staleUrl)}/fragmenty?cisloStranky=${page}`),
    ) as { pocetStranek: number; seznam: EsbFragment[] };
    pages = body.pocetStranek;
    fragments.push(...body.seznam);
  }
  if (!fragments.length) throw new Error("e-Sbírka: no fragments");

  // Flat (depth-annotated) list → tree.
  const root: CzNode = {
    frag: { id: 0, eli: "", kodTypuFragmentu: "Virtual_Document", hloubka: -1 },
    children: [],
  };
  const stack: CzNode[] = [root];
  for (const f of fragments) {
    while (stack.length > 1 && stack[stack.length - 1].frag.hloubka >= f.hloubka) stack.pop();
    const node: CzNode = { frag: f, children: [] };
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  const raws: Raw[] = [];
  for (const c of root.children) czRaw(c, raws);
  const anchors = new AnchorAllocator();
  let parts = buildNodes(raws, anchors, "");
  if (entry.range) parts = restrictRange(parts, entry.range.from, entry.range.to);

  const footnotes: LawFootnote[] = [];
  for (const f of fragments) {
    if (f.kodTypuFragmentu !== "PPC" || !f.xhtml) continue;
    const { label, text } = czLabelAndText(f.xhtml);
    const n = label.replace(/\)$/, "").trim() || String(footnotes.length + 1);
    footnotes.push({ anchor: anchors.take(`fn-${slug(n) || footnotes.length + 1}`), label, text });
  }

  // "Zákon č. 89/2012 Sb., občanský zákoník" → "Občanský zákoník";
  // "Zákon č. 563/1991 Sb., o účetnictví"   → "Zákon o účetnictví".
  const citation = meta.uplnaCitace ?? "";
  const cm = citation.match(/^(.*?)\s+č\.\s*\S+\s+Sb\.,?\s*(.*)$/);
  let title = citation;
  if (cm) {
    const [, typeWord, rest] = cm;
    if (/^(o|ve|k)\s/.test(rest)) title = `${typeWord} ${rest}`;
    else if (/^(kterým|kterou|kterými)\s/.test(rest)) title = `${typeWord}, ${rest}`;
    else title = rest.charAt(0).toUpperCase() + rest.slice(1);
  }

  return {
    number: meta.kodDokumentuSbirky,
    title,
    effectiveFrom: meta.datumUcinnostiZneniOd,
    effectiveTo: meta.datumUcinnostiZneniDo ?? null,
    sourceUrl: `https://e-sbirka.gov.cz${meta.staleUrl}`,
    parts,
    footnotes,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function parseArgs(argv: string[]) {
  const args: { only: Set<string> | null; cache: string | null } = { only: null, cache: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--only") args.only = new Set(argv[++i].split(",").map((s) => s.trim()));
    else if (argv[i] === "--cache") args.cache = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.cache) {
    cacheDir = path.resolve(args.cache);
    await fs.mkdir(cacheDir, { recursive: true });
  }
  const today = todayIso();
  const indexFile = path.join(OUT_DIR, "index.json");
  const previous = await readJson<LawIndex>(indexFile);
  const metas = new Map<string, LawMeta>((previous?.laws ?? []).map((l) => [l.id, l]));
  const failures: string[] = [];

  for (const entry of CATALOG) {
    const id = lawId(entry);
    if (args.only && !args.only.has(id)) continue;
    process.stdout.write(`${id} … `);
    try {
      const result = entry.jurisdiction === "sk" ? await syncSk(entry, today) : await syncCz(entry, today);
      const provisionCount = countProvisions(result.parts);
      if (!provisionCount) throw new Error("parsed zero provisions");
      const contentHash = createHash("sha256")
        .update(JSON.stringify({ parts: result.parts, footnotes: result.footnotes }))
        .digest("hex");
      const file = path.join(OUT_DIR, entry.jurisdiction, `${id}.json`);
      const existing = await readJson<LawDocument>(file);
      const fetchedAt =
        existing && existing.contentHash === contentHash && existing.effectiveFrom === result.effectiveFrom
          ? existing.fetchedAt
          : new Date().toISOString();
      const meta: LawMeta = {
        id,
        jurisdiction: entry.jurisdiction,
        number: result.number,
        title: result.title,
        effectiveFrom: result.effectiveFrom,
        effectiveTo: result.effectiveTo,
        sourceUrl: result.sourceUrl,
        fetchedAt,
        contentHash,
        ...(entry.range ? { scope: entry.range.scope } : {}),
        provisionCount,
      };
      const document: LawDocument = { ...meta, parts: result.parts, footnotes: result.footnotes };
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `${JSON.stringify(document, null, 1)}\n`, "utf8");
      metas.set(id, meta);
      console.log(`ok — ${result.number}, effective ${result.effectiveFrom}, ${provisionCount} provisions`);
    } catch (err) {
      failures.push(id);
      console.log(`FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Index keeps catalog order; entries no longer in the catalog are dropped.
  const order = CATALOG.map(lawId);
  const laws = order.map((id) => metas.get(id)).filter((m): m is LawMeta => Boolean(m));
  const index: LawIndex = {
    generatedAt: laws.reduce((max, l) => (l.fetchedAt > max ? l.fetchedAt : max), ""),
    laws,
  };
  await fs.mkdir(OUT_DIR, { recursive: true });
  await fs.writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  if (failures.length) {
    console.error(`\n${failures.length} law(s) failed: ${failures.join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
