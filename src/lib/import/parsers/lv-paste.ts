// Slovak LV (List vlastníctva) text parser.
// Verified against LV č. 3182, k.ú. Poprad, Dostojevského 2514 (96 bytov,
// 120 vlastníkov, 6 vchodov). See spec BYT-20260508-003 §"Approach §7".
//
// Contract:
//   parseLvText(text) → DraftRow[] (best-effort, never throws)
//   parseLvTextWithReport(text) → { rows, report } — same rows plus what was
//     recognised and every owner-like LV row that was NOT turned into a row
//     (with a reason code), so nothing is dropped silently.
//
// Unit type: flat ("Číslo bytu") vs nebytový priestor / garáž — see
// detectUnit(). Voting weight does not depend on it (SK §14(3)).
//
// What we DON'T extract:
//   - Date of birth, rodné číslo (PII, GDPR exclusion). IČO of a legal-entity
//     owner IS extracted — it is public register data and identifies the
//     owner (družstvo, obec, s.r.o.).
//   - Areas in m² (not present in LV)
//   - Emails, phones (not present in LV)
//   - Časť C (Ťarchy) — liens, separate concern

import type { UnitType } from "../../unit-type";
import { normaliseFloor } from "../floor";
import type { ImportRow, LvParseReport, LvSkippedEntry } from "../types";

type DraftRow = Partial<ImportRow>;

interface LvHeader {
  communityAddress?: string;
  supisne?: string;
  parcela?: string;
  obec?: string;
  // Default unit-share when every flat on the LV has the same denominator.
  // Inferred from the recurring "Podiel priestoru ... k pozemku" value;
  // overridable per unit block.
}

export function parseLvText(text: string): DraftRow[] {
  return parseLvTextWithReport(text).rows;
}

export interface LvParseResult {
  rows: DraftRow[];
  report: LvParseReport;
}

export function parseLvTextWithReport(text: string): LvParseResult {
  const normalised = text.replace(/\r\n/g, "\n").replace(/ /g, " ");
  const header = parseLvHeader(normalised);
  const blocks = splitUnitBlocks(normalised);
  const skipped: LvSkippedEntry[] = [];
  const rows: DraftRow[] = [];

  if (blocks.length === 0) {
    // No "Vchod (číslo)" unit sections: the LV lists the building as a
    // whole (e.g. owned outright by a bytové družstvo or an obec). Its
    // owners cannot be attached to units — report them instead of
    // returning an empty result silently.
    skipped.push({ lvRow: null, text: "", reason: "no_unit_sections" });
    const partB = sliceBetween(normalised, /ČASŤ\s+B\b/i, /ČASŤ\s+C\b/i);
    const ownersText = partB
      ? (sliceBetween(partB, /Spoluvlastnícky\s+podiel\s+/, /(?!)/) ?? partB)
      : null;
    if (ownersText) {
      for (const o of parseOwnerLines(ownersText, skipped)) {
        skipped.push({
          lvRow: o.ordinal ?? null,
          text: shorten(
            [o.name, o.ico ? `IČO ${o.ico}` : null, `${o.shareNum}/${o.shareDen}`]
              .filter(Boolean)
              .join(", ")
          ),
          reason: "building_owner",
        });
      }
    }
    return { rows, report: { recognisedOwners: 0, recognisedUnits: 0, skipped } };
  }

  for (const block of blocks) {
    rows.push(...parseUnitBlock(block, header, skipped));
  }
  const units = new Set(rows.map((r) => `${r.entrance_label ?? ""}|${r.unit_number ?? ""}`));
  return {
    rows,
    report: { recognisedOwners: rows.length, recognisedUnits: units.size, skipped },
  };
}

// ── Header ───────────────────────────────────────────────

function parseLvHeader(text: string): LvHeader {
  const header: LvHeader = {};

  // Súpisné číslo near the top — look in the LV preamble only.
  const preamble = text.slice(0, 4000);
  const supisneMatch = preamble.match(/Súpisné[^\d]{0,40}(\d{2,6})/);
  if (supisneMatch) header.supisne = supisneMatch[1];

  // "Popis stavby" content. In the Stavby table, the row contains:
  //   <Súpisné> <Parcela> <Druh stavby code> <Popis stavby text>
  // After unpdf flattens, this looks like:
  //   "... Popis stavby Druh chránenej nehnuteľnosti Umiestnenie stavby 2514 2993/650 9 blok Báryum, Dostojevského 1,3,5,7,9,11 ..."
  // The Popis content is the substring matching "blok\s+<Name>,\s+<Street>"
  // followed by a comma-separated digit list.
  const blokMatch = preamble.match(
    /blok\s+(\p{Lu}\p{L}+(?:\s+\p{Lu}\p{L}+)?)\s*,\s*(\p{Lu}\p{L}+(?:\s+\p{L}+)*)/u
  );
  if (blokMatch) {
    const blockName = blokMatch[1];
    const street = blokMatch[2];
    header.communityAddress = `${street}, blok ${blockName}`;
  }

  const obecMatch = preamble.match(/Obec\s*:?\s*\d+\s+([^\n]+?)(?=\s+(?:Dátum|Katastrálne))/);
  if (obecMatch) header.obec = obecMatch[1].trim();

  if (header.communityAddress && header.obec) {
    header.communityAddress = `${header.communityAddress}, ${header.obec}`;
  }

  const parcelaMatch = preamble.match(/(\d+\/\d+)\s+\d+\s+Zastavaná/);
  if (parcelaMatch) header.parcela = parcelaMatch[1];

  return header;
}

// ── Unit-block splitting ─────────────────────────────────

function splitUnitBlocks(text: string): string[] {
  // Each unit section starts with the literal "Vchod (číslo)" header line.
  const parts = text.split(/(?=Vchod\s*\(číslo\))/g);
  // The first chunk is the LV preamble — drop it.
  return parts.filter((p) => /Vchod\s*\(číslo\)/.test(p)).flatMap(splitByUnitLabel);
}

// A unit label WITH its value: "Číslo bytu 12" / "Číslo nebytového priestoru 3".
const UNIT_LABEL_RE = /Číslo\s+(?:bytu|nebytového\s+priestoru)\s*:?\s*\n?\s*\d/g;

/**
 * A non-residential unit (nebytový priestor) may be listed without its own
 * "Vchod (číslo)" line (e.g. a garage outside the entrances) and would then
 * glue onto the previous flat — its owners counted as owners of that flat.
 * Cut a block again at every further unit label, but only when the tail
 * carries its own owner section ("Spoluvlastnícky podiel"), so a repeated
 * page-header label can never cut an owner list in two.
 *
 * TODO(decision): verified only against flat-only LVs (LV č. 3182); the
 * layout of nebytové priestory is best-effort until we get a real LV with NP.
 */
function splitByUnitLabel(block: string): string[] {
  const starts = [...block.matchAll(UNIT_LABEL_RE)].map((m) => m.index ?? 0);
  if (starts.length <= 1) return [block];
  const cuts = [0];
  for (const idx of starts.slice(1)) {
    const tail = block.slice(idx);
    if (/Spoluvlastnícky\s+podiel/i.test(tail)) cuts.push(idx);
  }
  return cuts.map((c, i) => block.slice(c, cuts[i + 1] ?? block.length));
}

/**
 * Typ priestoru from the unit labels (src/lib/unit-type.ts):
 *   "Číslo bytu" → flat; "Číslo nebytového priestoru" / "Druh nebytového
 *   priestoru" → non_residential, or garage when the druh text says garáž /
 *   garážové stojisko. Returns the unit number ("NP 3" for non-flat units so
 *   NP č. 3 does not merge with byt č. 3 in the same entrance).
 *
 * TODO(decision): the druh may also be a numeric KN code on some LVs; only
 * the text form is recognised. Unknown → non_residential (board can change).
 */
function detectUnit(block: string): { type?: UnitType; number?: string } {
  const flat = block.match(/Číslo bytu\s*:?\s*\n?\s*(\d+\w?)/i)?.[1];
  const np = block.match(/Číslo nebytového priestoru\s*:?\s*\n?\s*(\d+\w?)/i)?.[1];
  const druh = block.match(/Druh nebytového priestoru\s*:?\s*\n?\s*([^\n]*)/i)?.[1] ?? "";
  if (np || (!flat && /Druh nebytového priestoru/i.test(block))) {
    const type: UnitType = /gar[aá]ž/i.test(druh) ? "garage" : "non_residential";
    return { type, number: np ? `NP ${np}` : undefined };
  }
  if (flat) return { type: "flat", number: flat };
  return {};
}

// ── Single unit block ────────────────────────────────────

function parseUnitBlock(
  block: string,
  header: LvHeader,
  skipped: LvSkippedEntry[]
): DraftRow[] {
  // Field extraction is done via free-form regex search on the whole block
  // rather than the previous line-anchored approach — pdf-extracted text
  // collapses each label and its value onto the same line ("Vchod (číslo) 1
  // Poschodie prízemie Číslo bytu 1 …"), defeating the `lineAfter` helper.
  // The regex `\s*\n?\s*` between label and value matches either layout
  // (paste-from-text with newlines or pdf-extract with spaces).
  const vchod = block.match(/Vchod\s*\(číslo\)\s*\n?\s*(\S+)/i)?.[1];
  // Whole value up to the next label / line end — "1. PP" is two tokens.
  const poschodieRaw = block
    .match(/Poschodie\s*:?\s*\n?\s*([^\n]*)/i)?.[1]
    ?.split(/\s+(?:Číslo|Druh|Podiel|Súpisné|Vchod)\b/i)[0]
    ?.trim()
    .slice(0, 20);
  // Flat ("Číslo bytu") or non-residential unit ("Číslo nebytového priestoru").
  const unit = detectUnit(block);
  const cisloBytu = unit.number;

  // Unit's share of community: the fraction after the "Podiel priestoru …
  // spoluvlastnícky podiel k pozemku" header.
  const unitShareMatch = block.match(
    /spoluvlastnícky podiel k pozemku\s*\n?\s*(\d+)\s*\/\s*(\d+)/i
  );
  const unitShareNum = unitShareMatch ? Number(unitShareMatch[1]) : undefined;
  const unitShareDen = unitShareMatch ? Number(unitShareMatch[2]) : undefined;

  // Súpisné číslo from the unit row; falls back to the LV header value.
  const supisneMatch = block.match(/Súpisné číslo\s*\n?\s*(\d{2,6})/i);
  const supisne = supisneMatch?.[1] ?? header.supisne;

  // Owner section: between the "Spoluvlastnícky podiel" header and the
  // closing "Správca - Neevidovaní" sentinel. The `\s+` tolerates either
  // newline-separated (text paste from a PDF viewer) or space-separated
  // (unpdf's mergePages output) layouts.
  const ownersText = sliceBetween(
    block,
    /Spoluvlastnícky\s+podiel\s+/,
    /Správca\s*-/
  );

  const owners = ownersText ? parseOwnerLines(ownersText, skipped) : [];

  const floor = normaliseFloor(poschodieRaw);

  // Derive unit address from header + súpisné + vchod when possible.
  // (Not stored in DraftRow yet — community_address comes from the wizard
  // form; this is only an aid for review.)

  const result: DraftRow[] = [];
  for (const o of owners) {
    const draft: DraftRow = {
      entrance_label: vchod ?? undefined,
      unit_number: cisloBytu ?? undefined,
      unit_floor: floor,
      unit_type: unit.type,
      supisne_cislo: supisne ?? undefined,
      unit_share_numerator: unitShareNum,
      unit_share_denominator: unitShareDen,
      owner_name: o.name,
      owner_birth_name: o.birthName,
      owner_ico: o.ico,
      owner_address: o.address,
      owner_unit_share_numerator: o.shareNum,
      owner_unit_share_denominator: o.shareDen,
      // BYT-20261118-003: keep the LV facts the ownership checks need.
      lv_ordinal: o.ordinal,
      ownership_form: o.bsm ? "bsm" : undefined,
      // Inherit community-level fields from the wizard if not set here.
      // The header hint is provided to the wizard via parseLv() result envelope.
      community_address: header.communityAddress,
    };
    result.push(draft);
  }
  return result;
}

// ── Owner row parsing ────────────────────────────────────

interface RawOwner {
  name: string;
  /** Rodné priezvisko ("r. Štolc"), kept out of the name. */
  birthName?: string;
  /** IČO of a legal-entity owner. */
  ico?: string;
  address?: string;
  shareNum: number;
  shareDen: number;
  /** Poradové číslo of the part-B row (both BSM spouses share it). */
  ordinal?: number;
  /** True for both spouses split out of one BSM row. */
  bsm?: boolean;
}

const BOUNDARY = "\n__BOUNDARY__\n";
/** Prefix of a block that starts with LV metadata (title deed, note, …). */
const META = "__META__";

/** Marker of an identified person / legal entity inside an owner record. */
const IDENTITY_RE = /Dátum narodenia:|IČO\s*:?\s*\d/i;
/** "107 Štolc …" — poradové číslo followed by a capitalised name. */
const ORDINAL_START_RE = /^(\d{1,4})\.?\s+(?=\p{Lu})/u;

function parseOwnerLines(text: string, skipped: LvSkippedEntry[]): RawOwner[] {
  // Two-pass algorithm hardened against pdftotext's tendency to flatten
  // owner records and their contract metadata onto a single line.
  //
  //  PASS 1 — mark boundaries. Fixed phrases ("Poznámky: Bez zápisu",
  //  "Správca - Neevidovaní", …) become pure boundaries. Metadata whose
  //  value varies (Titul nadobudnutia, Iné údaje, Poznámky with a real
  //  entry such as an exekúcia) starts a META block: its text is dropped and
  //  never glued to the next owner, even when the PDF put both on one line.
  //
  //  PASS 2 — split into blocks at the boundaries. A block is an owner
  //  record when it starts with a poradové číslo or carries an identity
  //  marker (Dátum narodenia for a person, IČO for a legal entity). The
  //  share is the LAST `a/b` token at the end of the block. Owner-like
  //  blocks that cannot be read are reported in `skipped` — never dropped
  //  silently.
  const PHRASE_BOUNDARIES: Array<{ re: RegExp; replacement: string }> = [
    { re: /Iné údaje:\s*Bez zápisu/gi, replacement: BOUNDARY },
    { re: /Poznámky:\s*Bez zápisu/gi, replacement: BOUNDARY },
    { re: /Správca\s*-\s*Neevidovaní/gi, replacement: BOUNDARY },
    { re: /Iná oprávnená osoba\s*-\s*Neevidovaní/gi, replacement: BOUNDARY },
    { re: /Účastník právneho vzťahu:\s*\p{L}+/giu, replacement: BOUNDARY },
    { re: /Titul nadobudnutia:/gi, replacement: `${BOUNDARY}${META} ` },
    { re: /Iné údaje:/gi, replacement: `${BOUNDARY}${META} ` },
    { re: /Poznámky:/gi, replacement: `${BOUNDARY}${META} ` },
  ];
  let pre = text;
  for (const { re, replacement } of PHRASE_BOUNDARIES) {
    pre = pre.replace(re, replacement);
  }
  // Drop "X z N" page-footer fragments that leak in between owner records.
  pre = pre.replace(/\b\d{1,3}\s*z\s*\d{1,3}\b/g, " ");
  const lines = pre.split("\n").map((l) => l.trim());

  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line === "__BOUNDARY__") {
      if (current.length > 0) blocks.push(current);
      current = [];
      continue;
    }
    if (line === "") continue;
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);

  const owners: RawOwner[] = [];
  for (const blockLines of blocks) {
    let blockText = blockLines.join(" ").replace(/\s+/g, " ").trim();
    const isMeta = blockText.startsWith(META);
    if (isMeta) blockText = blockText.slice(META.length).trim();

    const hasIdentity = IDENTITY_RE.test(blockText);
    if (isMeta) {
      // Pure metadata (title deed, note, exekúcia …) — dropped.
      if (!hasIdentity) continue;
      // Metadata glued in front of the next owner: cut it off.
      const start = findOwnerStart(blockText);
      if (start < 0) {
        skipped.push({ lvRow: null, text: shorten(blockText), reason: "unreadable" });
        continue;
      }
      blockText = blockText.slice(start).trim();
    } else if (!ORDINAL_START_RE.test(blockText) && hasIdentity) {
      // Leading noise (page header remnant) before the poradové číslo.
      const start = findOwnerStart(blockText);
      if (start > 0) blockText = blockText.slice(start).trim();
    }
    const startsWithOrdinal = ORDINAL_START_RE.test(blockText);
    if (!startsWithOrdinal && !IDENTITY_RE.test(blockText)) continue; // noise

    const ordinal = Number(blockText.match(ORDINAL_START_RE)?.[1]) || undefined;
    const shareMatch = blockText.match(/(\d+)\s*\/\s*(\d+)\s*$/);
    if (!shareMatch) {
      skipped.push({ lvRow: ordinal ?? null, text: shorten(blockText), reason: "no_share" });
      continue;
    }
    const shareNum = Number(shareMatch[1]);
    const shareDen = Number(shareMatch[2]);
    // Large denominators are legitimate (e.g. 6543/123456 on older LVs);
    // only a share outside (0, 1] is rejected.
    if (shareNum <= 0 || shareDen <= 0 || shareNum > shareDen) {
      skipped.push({ lvRow: ordinal ?? null, text: shorten(blockText), reason: "share_invalid" });
      continue;
    }

    let nameBlob = blockText.slice(0, blockText.length - shareMatch[0].length).trim();
    if (ordinal !== undefined) nameBlob = nameBlob.replace(ORDINAL_START_RE, "");

    const owner = extractOwner(nameBlob, shareNum, shareDen);
    if (owner) owners.push(...owner.map((o) => ({ ...o, ordinal })));
  }

  return owners;
}

/**
 * Index where the owner record starts inside a block that begins with
 * metadata ("Pozn: Vedie sa exekučné konanie EX 12/2020 108 Kováč Peter, …").
 * The owner is the LAST "<poradové č.> <Name>" before the first identity
 * marker whose name part (up to the next comma) has no digits. -1 = none.
 */
function findOwnerStart(s: string): number {
  const idMatch = s.match(IDENTITY_RE);
  const prefix = idMatch ? s.slice(0, idMatch.index) : s;
  const re = /(?:^|\s)(\d{1,4})\.?\s+(?=\p{Lu})/gu;
  let best = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prefix)) !== null) {
    const start = m.index + (m[0].length - m[0].trimStart().length);
    const namePart = prefix.slice(m.index + m[0].length).split(",")[0];
    if (!/\d/.test(namePart)) best = start;
  }
  return best;
}

/**
 * Convert one owner blob into one or two RawOwner records. BSM (spousal
 * co-ownership) is detected on the FULL blob and split BEFORE the
 * name/address heuristic — otherwise the title token "Ing." followed by
 * " a Alena" would be absorbed into the address (real bug observed on byt 76
 * of LV č. 3182).
 */
function extractOwner(
  blob: string,
  shareNum: number,
  shareDen: number
): RawOwner[] | null {
  // The BSM marker sits AFTER the DOB section in the LV format
  // ("…, SR, Dátum narodenia: 10.11.1949, Dátum narodenia: 24.02.1958, BSM").
  const hasBsmMarker = /(?:^|[,\s])BSM(?:$|[,\s])/.test(blob);

  // IČO of a legal-entity owner (public register data, kept).
  const ico = blob.match(/IČO\s*:?\s*(\d[\d ]{5,10}\d)/i)?.[1]?.replace(/\s+/g, "");

  // Everything before the identity tail is name + address.
  const idIdx = blob.search(/,?\s*(?:Dátum narodenia:|IČO\s*:?\s*\d)/i);
  let cleaned = (idIdx >= 0 ? blob.slice(0, idIdx) : blob).trim();

  // Country marker at the end ("…, SR") — never part of the address.
  cleaned = cleaned.replace(/,\s*SR\s*$/i, "").trim();

  const bsmSplit = hasBsmMarker ? lastBsmSplit(cleaned) : null;
  if (bsmSplit) {
    const left = splitNameAddress(bsmSplit.left);
    const right = splitNameAddress(bsmSplit.right);
    // BSM = shared address. Prefer the right side (it usually carries the
    // address fragment after the joint name).
    const shared = right.address ?? left.address;
    return [
      { name: left.name, birthName: left.birthName, address: shared, shareNum, shareDen: shareDen * 2, bsm: true },
      { name: right.name, birthName: right.birthName, address: shared, shareNum, shareDen: shareDen * 2, bsm: true },
    ];
  }

  const parts = splitNameAddress(cleaned);
  return [{ name: parts.name, birthName: parts.birthName, ico, address: parts.address, shareNum, shareDen }];
}

function lastBsmSplit(s: string): { left: string; right: string } | null {
  // The LAST " a <Uppercase>" so titles like ", Ing." that precede the
  // conjunction stay with the first spouse.
  const re = /\s+a\s+\p{Lu}/gu;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    lastIdx = m.index;
  }
  if (lastIdx < 0) return null;
  const left = s.slice(0, lastIdx).trim().replace(/,\s*$/, "").trim();
  const right = s.slice(lastIdx).replace(/^\s+a\s+/, "").trim();
  if (!left || !right) return null;
  return { left, right };
}

const TITLE_TOKEN_RE =
  /^(?:Ing|Mgr|Bc|MUDr|JUDr|RNDr|PhDr|PaedDr|MVDr|MDDr|PharmDr|ThDr|ThLic|doc|prof|PhD|CSc|DrSc|ArtD|MBA|MPA|MSc|BSc|Dr|Dipl|akad|arch|LL\.?M)\.?$/i;
const LEGAL_FORM_RE =
  /^(?:s\.\s*r\.\s*o\.?|spol\.\s*s\s*r\.\s*o\.?|a\.\s*s\.?|v\.\s*o\.\s*s\.?|k\.\s*s\.?|n\.\s*o\.?|o\.\s*z\.?|š\.\s*p\.?|družstvo)$/i;
const BIRTH_NAME_RE = /(?:^|\s)r\.\s*(\p{Lu}[\p{L}'’-]*(?:\s*-\s*\p{Lu}[\p{L}'’-]*)?)/u;

function isTitleSegment(seg: string): boolean {
  const tokens = seg.split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((t) => TITLE_TOKEN_RE.test(t));
}

/**
 * "Štolc Ondrej r. Štolc, Ing., PhD., Dostojevského 2514/1, Poprad" →
 *   name "Štolc Ondrej, Ing., PhD.", birthName "Štolc",
 *   address "Dostojevského 2514/1, Poprad".
 * Comma segments after the name are consumed while they are titles, a
 * rodné priezvisko ("r. X") or a legal form (s.r.o.); the rest is address.
 */
function splitNameAddress(s: string): { name: string; birthName?: string; address?: string } {
  const segs = s.split(",").map((t) => t.trim()).filter(Boolean);
  if (segs.length === 0) return { name: s.trim() };
  let birthName: string | undefined;
  let name = segs[0];
  const bm = name.match(BIRTH_NAME_RE);
  if (bm) {
    birthName = bm[1];
    name = name.replace(bm[0], " ").replace(/\s+/g, " ").trim();
  }
  const suffixes: string[] = [];
  let i = 1;
  for (; i < segs.length; i++) {
    const seg = segs[i];
    if (isTitleSegment(seg) || LEGAL_FORM_RE.test(seg)) {
      suffixes.push(seg);
      continue;
    }
    const sm = seg.match(/^r\.\s*(\p{Lu}[\p{L}'’ -]*)$/u);
    if (sm) {
      birthName = sm[1].trim();
      continue;
    }
    break;
  }
  const address = segs.slice(i).join(", ").replace(/,?\s*SR\s*$/i, "").trim();
  return {
    name: suffixes.length ? `${name}, ${suffixes.join(", ")}` : name,
    birthName,
    address: address || undefined,
  };
}

function shorten(s: string, max = 160): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ── Helpers ──────────────────────────────────────────────

function sliceBetween(text: string, start: RegExp, end: RegExp): string | null {
  const s = text.match(start);
  if (!s) return null;
  const after = text.slice(s.index! + s[0].length);
  const e = after.match(end);
  if (!e) return after; // till end of block
  return after.slice(0, e.index!);
}
