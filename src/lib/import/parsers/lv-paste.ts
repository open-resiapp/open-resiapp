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

  // "Súpisné číslo" inside a "Stavby" table — first occurrence of a 4-digit
  // value labelled "Súpisné číslo" near the top.
  const supisneMatch = text.match(/Súpisné[^\d]{0,40}(\d{2,6})/);
  if (supisneMatch) header.supisne = supisneMatch[1];

  // "Popis stavby" line gives the street + entrance numbers, e.g.:
  //   "blok Báryum, Dostojevského 1,3,5,7,9,11"
  const popisMatch = text.match(/Popis stavby[\s\S]{0,200}?\n([^\n]+)\n/);
  if (popisMatch) {
    // Trim trailing entrance enumeration to keep only "<descriptor> <street>".
    let line = popisMatch[1].trim();
    // Strip a trailing comma-separated list of digits at the end.
    line = line.replace(/\s*[\d,\s]+$/, "");
    header.communityAddress = line || undefined;
  }

  const obecMatch = text.match(/Obec\s*:\s*\d+\s+([^\n]+?)\s*Dátum/);
  if (obecMatch) header.obec = obecMatch[1].trim();

  if (header.communityAddress && header.obec) {
    header.communityAddress = `${header.communityAddress}, ${header.obec}`;
  }

  const parcelaMatch = text.match(/(\d+\/\d+)\s+\d+\s+Zastavaná/);
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
  const lines = block.split("\n").map((l) => l.trim());

  const vchod = lineAfter(lines, /^Vchod\s*\(číslo\)$/);
  const poschodieRaw = lineAfter(lines, /^Poschodie$/);
  const cisloBytu = lineAfter(lines, /^Číslo bytu$/);
  const supisne = lineAfter(lines, /^Súpisné číslo$/) ?? header.supisne;

  // Unit's share of community appears as the first standalone fraction after
  // the multi-line "Podiel priestoru ... spoluvlastnícky podiel k pozemku".
  let unitShareNum: number | undefined;
  let unitShareDen: number | undefined;
  const podielIdx = lines.findIndex((l) => /^Podiel priestoru/.test(l));
  if (podielIdx >= 0) {
    for (let i = podielIdx + 1; i < Math.min(lines.length, podielIdx + 10); i++) {
      const m = lines[i].match(/^(\d+)\s*\/\s*(\d+)$/);
      if (m) {
        unitShareNum = Number(m[1]);
        unitShareDen = Number(m[2]);
        break;
      }
    }
  }

  // Owner section: between the "Spoluvlastnícky\npodiel" header and the
  // closing "Správca - Neevidovaní" sentinel.
  const ownersText = sliceBetween(
    block,
    /Spoluvlastnícky\s*\n\s*podiel\s*\n/,
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
  // Coalesce wrapped owner blocks: a logical owner record starts with
  //   `<poradove>\s+<name+address+dob+share>` possibly spread across many
  //   physical lines, until a share `\d+/\d+` is seen at the END of a line.
  const physicalLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const owners: RawOwner[] = [];
  let buf: string[] = [];
  for (const line of physicalLines) {
    // Stop accumulating into the current owner when we hit a non-owner section.
    if (
      /^Titul nadobudnutia/i.test(line) ||
      /^Iné údaje/i.test(line) ||
      /^Poznámky/i.test(line)
    ) {
      // Reset — anything after "Titul nadobudnutia" until the next owner
      // start (a fresh `^\d+\s+\D` line) is contract metadata.
      buf = [];
      continue;
    }
    buf.push(line);
    const joined = buf.join(" ");
    const match = joined.match(
      /^(\d{1,3})\s+(.+?)\s+(\d+)\s*\/\s*(\d+)\s*$/
    );
    if (match) {
      const owner = extractOwner(match[2], Number(match[3]), Number(match[4]));
      if (owner) owners.push(...owner);
      buf = [];
    }
  }
  return owners;
}

/**
 * Convert one matched owner blob into one or two RawOwner records.
 * BSM rows (containing "BSM" and two capitalised tokens joined by " a ")
 * yield two owners each at half the listed share.
 */
function extractOwner(
  blob: string,
  shareNum: number,
  shareDen: number
): RawOwner[] | null {
  // Split name+address from DOB / other delimiters.
  // The reliable delimiter is ", Dátum narodenia:" — content before is
  // name + address; content after is DOB(s) + miscellaneous.
  const splitIdx = blob.indexOf(", Dátum narodenia:");
  const before = (splitIdx >= 0 ? blob.slice(0, splitIdx) : blob).trim();
  // Heuristic: name + first-address are separated by the FIRST comma that
  // precedes a number (street number, PSČ, etc.). Names with titles and
  // maiden names contain commas, e.g. "Mgr. r. Truchanová, Popradská 6".
  // Safer: address = everything from the first ", " followed by a token
  // that looks like a street (Capitalised word + number, or just digits).
  const nameAddressSplit = before.match(
    /^(.+?),\s+([A-ZČĎŠŽÁÄÍÉÚÝÔŇŠŤŠ][^,]*?(?:\s+\d|\s+č\.|\s+PSČ).*|.+?\d.*)$/u
  );
  let name = before;
  let address: string | undefined;
  if (nameAddressSplit) {
    name = nameAddressSplit[1].trim();
    address = nameAddressSplit[2].trim();
    // Strip a trailing ", SR" if address ends with it.
    address = address.replace(/,\s*SR$/i, "").trim();
  }

  // BSM detection: blob contains ", BSM" AND name has " a " between two
  // capitalised tokens.
  const isBsm = /(?:^|[,\s])BSM(?:\s|$|,)/.test(blob);
  const hasTwoNames = /\b[A-ZČĎŠŽÁÄÍÉÚÝÔŇŠŤŠ][\p{L}\-]+\s+[a-záäčďéíĺľňóôŕšťúýž]+\s+[A-ZČĎŠŽÁÄÍÉÚÝÔŇŠŤŠ][\p{L}\-]+/u.test(name);
  if (isBsm && hasTwoNames) {
    const split = splitBsmName(name);
    if (split) {
      // Halve the share for BSM split.
      return [
        { name: split[0], address, shareNum, shareDen: shareDen * 2 },
        { name: split[1], address, shareNum, shareDen: shareDen * 2 },
      ];
    }
  }

  return [{ name, address, shareNum, shareDen }];
}

function splitBsmName(name: string): [string, string] | null {
  // Format: "<Last1 First1 [r. Maiden1] [Titles]> a <Last2 First2 [r. Maiden2] [Titles]>"
  // Try splitting on " a " preceded by a token that ends a name; reject splits
  // that fall inside "r. Maiden, … a …" (rare).
  const idx = name.search(/\s+a\s+[A-ZČĎŠŽÁÄÍÉÚÝÔŇŠŤŠ]/u);
  if (idx < 0) return null;
  const left = name.slice(0, idx).trim();
  const right = name.slice(idx + 3).trim();
  if (!left || !right) return null;
  return [left, right];
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
