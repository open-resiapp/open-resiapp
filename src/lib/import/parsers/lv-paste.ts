// Slovak LV (List vlastníctva) text parser.
// Verified against LV č. 3182, k.ú. Poprad, Dostojevského 2514 (96 bytov,
// 120 vlastníkov, 6 vchodov). See spec BYT-20260508-003 §"Approach §7".
//
// Contract:
//   parseLvText(text) → DraftRow[] (best-effort, never throws)
//
// What we DON'T extract:
//   - Date of birth, rodné číslo, IČO (PII, GDPR exclusion)
//   - Areas in m² (not present in LV)
//   - Emails, phones (not present in LV)
//   - Časť C (Ťarchy) — liens, separate concern

import type { ImportRow } from "../types";

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

const SK_LOCALE = "sk-SK";

export function parseLvText(text: string): DraftRow[] {
  const normalised = text.replace(/\r\n/g, "\n").replace(/ /g, " ");
  const header = parseLvHeader(normalised);
  const blocks = splitUnitBlocks(normalised);
  const rows: DraftRow[] = [];
  for (const block of blocks) {
    const parsed = parseUnitBlock(block, header);
    rows.push(...parsed);
  }
  return rows;
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
  return parts.filter((p) => /Vchod\s*\(číslo\)/.test(p));
}

// ── Single unit block ────────────────────────────────────

function parseUnitBlock(block: string, header: LvHeader): DraftRow[] {
  // Field extraction is done via free-form regex search on the whole block
  // rather than the previous line-anchored approach — pdf-extracted text
  // collapses each label and its value onto the same line ("Vchod (číslo) 1
  // Poschodie prízemie Číslo bytu 1 …"), defeating the `lineAfter` helper.
  // The regex `\s*\n?\s*` between label and value matches either layout
  // (paste-from-text with newlines or pdf-extract with spaces).
  const vchod = block.match(/Vchod\s*\(číslo\)\s*\n?\s*(\S+)/i)?.[1];
  const poschodieRaw = block.match(/Poschodie\s*\n?\s*(\S+)/i)?.[1];
  const cisloBytu = block.match(/Číslo bytu\s*\n?\s*(\d+\w?)/i)?.[1];

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

  const owners = ownersText ? parseOwnerLines(ownersText) : [];

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
      supisne_cislo: supisne ?? undefined,
      unit_share_numerator: unitShareNum,
      unit_share_denominator: unitShareDen,
      owner_name: o.name,
      owner_address: o.address,
      owner_unit_share_numerator: o.shareNum,
      owner_unit_share_denominator: o.shareDen,
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
  address?: string;
  shareNum: number;
  shareDen: number;
}

function parseOwnerLines(text: string): RawOwner[] {
  // Two-pass algorithm hardened against pdftotext's tendency to flatten
  // owner records and their contract metadata onto a single line.
  //
  //  PASS 1 — strip contract metadata. Inside every physical line, cut
  //  at the first occurrence of a boundary marker
  //  (Titul nadobudnutia | Iné údaje | Poznámky | Správca | Iná oprávnená).
  //  This removes contract references like "R 418/13" before share
  //  detection — the previous regex was lazy-anchored to end-of-line and
  //  happily grabbed those as the owner's share.
  //
  //  PASS 2 — split the cleaned text into BLOCKS separated by the same
  //  boundary markers (when those markers occupy whole lines). A block
  //  is an owner record IFF it contains a "Dátum narodenia:" marker.
  //  This rules out page footers, contract leftovers, and noise that
  //  happen to start with a digit.
  //
  //  Per block: the share is the LAST `\d+/\d+` token at end of block.
  //  The leading poradové č. is stripped from the name blob.
  // Boundary phrases with their known fixed-value form. We replace each
  // *whole phrase* (keyword + canonical value) with a sentinel, preserving
  // any text that follows on the same physical line — this is critical
  // because pdf-extracted text frequently glues a boundary like
  // "Poznámky: Bez zápisu" to the start of the NEXT owner record on the
  // same line (e.g. "Poznámky: Bez zápisu 107 Štolc Ondrej r. Štolc…").
  // For "Titul nadobudnutia:" we cannot enumerate the value (contract
  // identifiers vary), but everything from "Titul…" up to the next "Iné
  // údaje:" is contract metadata that we want to discard — the simplest
  // safe rule is: replace just the keyword, let the block-DOB filter drop
  // the chunk because it won't contain a DOB.
  const PHRASE_BOUNDARIES: Array<{ re: RegExp; replacement: string }> = [
    { re: /Iné údaje:\s*Bez zápisu/gi, replacement: "\n__BOUNDARY__\n" },
    { re: /Poznámky:\s*Bez zápisu/gi, replacement: "\n__BOUNDARY__\n" },
    {
      re: /Správca\s*-\s*Neevidovaní/gi,
      replacement: "\n__BOUNDARY__\n",
    },
    {
      re: /Iná oprávnená osoba\s*-\s*Neevidovaní/gi,
      replacement: "\n__BOUNDARY__\n",
    },
    { re: /Titul nadobudnutia:/gi, replacement: "\n__BOUNDARY__\nTitul:" },
  ];
  let pre = text;
  for (const { re, replacement } of PHRASE_BOUNDARIES) {
    pre = pre.replace(re, replacement);
  }
  // Also drop "X z N" page-footer fragments that occasionally leak in
  // between owner records — these are page numbers from the original PDF.
  pre = pre.replace(/\b\d{1,3}\s*z\s*\d{1,3}\b/g, " ");
  const lines = pre.split("\n").map((l) => l.trim());

  // Pass 2 — group lines into blocks split by boundary sentinels.
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line === "__BOUNDARY__") {
      if (current.length > 0) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    if (line === "") continue;
    current.push(line);
  }
  if (current.length > 0) blocks.push(current);

  // For each block, treat as an owner record iff it contains a DOB marker.
  const owners: RawOwner[] = [];
  for (const blockLines of blocks) {
    const blockText = blockLines.join(" ").trim();
    if (!/Dátum narodenia:/i.test(blockText)) continue;

    // Share = LAST `\d+/\d+` token, anchored to end. If the block doesn't
    // end with a share, skip — something unexpected.
    const shareMatch = blockText.match(/(\d+)\s*\/\s*(\d+)\s*$/);
    if (!shareMatch) continue;
    const shareNum = Number(shareMatch[1]);
    const shareDen = Number(shareMatch[2]);
    if (shareNum <= 0 || shareDen <= 0) continue;
    // Sanity guard: real owner shares have small denominators (≤ 1000).
    // Cadastre files we've seen use denominators up to ~192 (1/192 for
    // BSM-of-1/96). Reject anything huge that's almost certainly a
    // contract identifier leaked through.
    if (shareDen > 1000) continue;

    let nameBlob = blockText.slice(0, blockText.length - shareMatch[0].length).trim();
    // Strip leading poradové č. (with or without trailing dot).
    const m = nameBlob.match(/^\d{1,3}\s+(.+)$/);
    if (m) nameBlob = m[1];

    const owner = extractOwner(nameBlob, shareNum, shareDen);
    if (owner) owners.push(...owner);
  }

  return owners;
}

/**
 * Convert one owner blob into one or two RawOwner records. BSM (spousal
 * co-ownership) is detected on the FULL pre-DOB string and split BEFORE
 * the name/address heuristic — otherwise the title token "Ing." followed
 * by " a Alena" would be absorbed into the address (real bug observed
 * on byt 76 of LV č. 3182).
 */
function extractOwner(
  blob: string,
  shareNum: number,
  shareDen: number
): RawOwner[] | null {
  // BSM detection must test the FULL blob — the marker (", BSM" or trailing
  // BSM) sits AFTER the DOB section in the LV format
  // ("…, SR, Dátum narodenia: 10.11.1949, Dátum narodenia: 24.02.1958, BSM").
  // The earlier version tested `cleaned` (DOB stripped) and missed every
  // BSM case.
  const hasBsmMarker =
    /(?:^|[,\s])BSM(?:$|[,\s])/.test(blob);

  // Strip the DOB tail. Everything before ", Dátum narodenia:" is name+address.
  const dobIdx = blob.indexOf(", Dátum narodenia:");
  let cleaned = (dobIdx >= 0 ? blob.slice(0, dobIdx) : blob).trim();

  // Country marker at the end ("…, SR") — never part of the address.
  cleaned = cleaned.replace(/,\s*SR\s*$/i, "").trim();

  // BSM split: detect " a " followed by an uppercase token. Use the LAST
  // such occurrence, since title commas can introduce false " a " matches
  // earlier (e.g. "Mgr. r. Truchanová" — no " a " there but be defensive).
  const bsmSplit = hasBsmMarker ? lastBsmSplit(cleaned) : null;
  if (bsmSplit) {
    const leftParts = splitNameAddress(bsmSplit.left);
    const rightParts = splitNameAddress(bsmSplit.right);
    // BSM = shared address. Prefer the right side (it usually carries the
    // address fragment after the joint name).
    const shared = rightParts.address ?? leftParts.address;
    return [
      { name: leftParts.name, address: shared, shareNum, shareDen: shareDen * 2 },
      { name: rightParts.name, address: shared, shareNum, shareDen: shareDen * 2 },
    ];
  }

  const parts = splitNameAddress(cleaned);
  return [{ name: parts.name, address: parts.address, shareNum, shareDen }];
}

function lastBsmSplit(
  s: string
): { left: string; right: string } | null {
  // Find the LAST " a <Uppercase>..." position so titles like ", Ing." that
  // precede the conjunction stay with the first spouse.
  const re = /\s+a\s+\p{Lu}/gu;
  let lastIdx = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    lastIdx = m.index;
  }
  if (lastIdx < 0) return null;
  const left = s.slice(0, lastIdx).trim().replace(/,\s*$/, "").trim();
  const right = s.slice(lastIdx + 3).trim(); // 3 = length of " a "
  if (!left || !right) return null;
  return { left, right };
}

function splitNameAddress(s: string): { name: string; address?: string } {
  // Address detection: the first comma whose suffix looks like a street.
  // A street suffix typically contains a digit (house number), a postal
  // code, or starts with "PSČ".
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== ",") continue;
    const after = s.slice(i + 1).trim();
    if (!after) continue;
    if (/\d/.test(after) || /^PSČ/i.test(after) || /^\d{3}\s\d{2}/.test(after)) {
      return {
        name: s.slice(0, i).trim(),
        address: after.replace(/,\s*SR\s*$/i, "").trim(),
      };
    }
  }
  return { name: s.trim() };
}

// ── Helpers ──────────────────────────────────────────────

function lineAfter(lines: string[], pattern: RegExp): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    if (pattern.test(lines[i])) {
      const next = lines[i + 1]?.trim();
      if (next && next !== "") return next;
    }
  }
  return undefined;
}

function sliceBetween(text: string, start: RegExp, end: RegExp): string | null {
  const s = text.match(start);
  if (!s) return null;
  const after = text.slice(s.index! + s[0].length);
  const e = after.match(end);
  if (!e) return after; // till end of block
  return after.slice(0, e.index!);
}

function normaliseFloor(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const t = raw.toLocaleLowerCase(SK_LOCALE).trim();
  if (t === "prízemie" || t === "p" || t === "0") return 0;
  const m = t.match(/^(\d+)\.?p?$/);
  if (m) return Number(m[1]);
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
