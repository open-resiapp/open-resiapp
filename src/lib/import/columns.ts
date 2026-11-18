import { UNIT_TYPES } from "@/lib/unit-type";
import type { StructureVariant } from "./types";

// Column ordering and labels live here so CSV + XLSX generators and the
// in-app grid all stay aligned with one source of truth.

// Human labels + help texts are i18n: `Import.columns.<key>` and
// `Import.columnHelp.<key>` (sk/en/cs). `label` is the FILE header (stable
// key, round-trip safe for export → re-import); never shown in the UI.
export interface ColumnDef {
  key: string;
  label: string; // header written to the XLSX / CSV template
  required: boolean;
  /**
   * Where this field is captured in the wizard:
   *   "community" → entered once in the Community panel; the seeder splats
   *                 the same value onto every row before persisting. Not
   *                 shown in the per-row grid.
   *   "row"       → per-row data, shown as a column in the grid.
   */
  scope: "community" | "row";
  // Excel cell format hint:
  //   "text"   → `@` (forces text, prevents Excel auto-converting 1/96 to a date)
  //   "int"    → general integer
  //   "enum"   → data-validation dropdown (values come from `enumOptions`)
  //   "string" → general text
  excelFormat: "text" | "int" | "enum" | "string";
  enumOptions?: string[];
}

const COMMON_HEAD: ColumnDef[] = [
  {
    key: "community_name",
    label: "community_name",
    required: true,
    scope: "community",
    excelFormat: "string",
  },
  {
    key: "community_address",
    label: "community_address",
    required: true,
    scope: "community",
    excelFormat: "string",
  },
  {
    key: "community_ico",
    label: "community_ico",
    required: false,
    scope: "community",
    excelFormat: "string",
  },
  {
    key: "community_dic",
    label: "community_dic",
    required: false,
    scope: "community",
    excelFormat: "string",
  },
  {
    key: "country",
    label: "country",
    required: true,
    scope: "community",
    excelFormat: "enum",
    enumOptions: ["sk", "cz"],
  },
  {
    key: "voting_method",
    label: "voting_method",
    required: true,
    scope: "community",
    excelFormat: "enum",
    enumOptions: ["per_share", "per_flat", "per_area", "one_per_member", "custom_weight"],
  },
  {
    key: "supisne_cislo",
    label: "supisne_cislo",
    required: false,
    scope: "community",
    excelFormat: "string",
  },
];

const BLOCK_COL: ColumnDef = {
  key: "block_name",
  label: "block_name",
  required: true,
  scope: "row",
  excelFormat: "string",
};

const ENTRANCE_COL: ColumnDef = {
  key: "entrance_label",
  label: "entrance_label",
  required: true,
  scope: "row",
  excelFormat: "string",
};

const UNIT_AND_OWNER: ColumnDef[] = [
  {
    key: "unit_number",
    label: "unit_number",
    required: true,
    scope: "row",
    excelFormat: "string",
  },
  {
    key: "unit_floor",
    label: "unit_floor",
    // Required for flats only; garages / nebytové priestory may leave it empty.
    required: false,
    scope: "row",
    excelFormat: "string",
  },
  {
    key: "unit_area_m2",
    label: "unit_area_m2",
    required: false,
    scope: "row",
    excelFormat: "int",
  },
  {
    key: "unit_share_numerator",
    label: "unit_share_numerator",
    required: true,
    scope: "row",
    excelFormat: "text",
  },
  {
    key: "unit_share_denominator",
    label: "unit_share_denominator",
    required: true,
    scope: "row",
    excelFormat: "text",
  },
  // Typ priestoru — src/lib/unit-type.ts. LV import fills it; empty = not
  // classified yet (read as byt). Voting weight is unaffected (SK §14(3)).
  {
    key: "unit_type",
    label: "unit_type",
    required: false,
    scope: "row",
    excelFormat: "enum",
    enumOptions: [...UNIT_TYPES],
  },
  {
    key: "owner_name",
    label: "owner_name",
    required: true,
    scope: "row",
    excelFormat: "string",
  },
  {
    key: "owner_birth_name",
    label: "owner_birth_name",
    required: false,
    scope: "row",
    excelFormat: "string",
  },
  {
    key: "owner_ico",
    label: "owner_ico",
    required: false,
    scope: "row",
    excelFormat: "string",
  },
  {
    key: "owner_address",
    label: "owner_address",
    required: false,
    scope: "row",
    excelFormat: "string",
  },
  {
    key: "owner_email",
    label: "owner_email",
    required: false,
    scope: "row",
    excelFormat: "string",
  },
  {
    key: "owner_phone",
    label: "owner_phone",
    required: false,
    scope: "row",
    excelFormat: "string",
  },
  {
    key: "owner_unit_share_numerator",
    label: "owner_unit_share_numerator",
    required: true,
    scope: "row",
    excelFormat: "text",
  },
  {
    key: "owner_unit_share_denominator",
    label: "owner_unit_share_denominator",
    required: true,
    scope: "row",
    excelFormat: "text",
  },
  // BYT-20261118-003: LV facts for the owner-registry checks. Filled by the
  // LV paste/PDF parser; optional for manual and CSV rows.
  {
    key: "lv_ordinal",
    label: "lv_ordinal",
    required: false,
    scope: "row",
    excelFormat: "int",
  },
  {
    key: "ownership_form",
    label: "ownership_form",
    required: false,
    scope: "row",
    excelFormat: "enum",
    enumOptions: ["bsm"],
  },
];

export function columnsForStructure(s: StructureVariant): ColumnDef[] {
  switch (s) {
    case "community_unit":
      return [...COMMON_HEAD, ...UNIT_AND_OWNER];
    case "community_entrance_unit":
      return [...COMMON_HEAD, ENTRANCE_COL, ...UNIT_AND_OWNER];
    case "community_block_entrance_unit":
      return [...COMMON_HEAD, BLOCK_COL, ENTRANCE_COL, ...UNIT_AND_OWNER];
  }
}

/** Columns shown in the per-row grid (community-level fields filtered out). */
export function rowColumns(s: StructureVariant): ColumnDef[] {
  return columnsForStructure(s).filter((c) => c.scope === "row");
}

/** Community-level columns shown in the Community form above the grid. */
export function communityColumns(s: StructureVariant): ColumnDef[] {
  return columnsForStructure(s).filter((c) => c.scope === "community");
}

export function sampleRow(s: StructureVariant): Record<string, string> {
  const row: Record<string, string> = {
    community_name: "Bytový dom Príklad",
    community_address: "Hlavná 1, 058 01 Poprad",
    community_ico: "",
    community_dic: "",
    country: "sk",
    voting_method: "per_share",
    supisne_cislo: "2514",
    unit_number: "1",
    unit_floor: "prízemie",
    unit_area_m2: "",
    unit_share_numerator: "1",
    unit_share_denominator: "96",
    unit_type: "flat",
    owner_name: "Vzor Vlastník",
    owner_address: "",
    owner_email: "",
    owner_phone: "",
    owner_unit_share_numerator: "1",
    owner_unit_share_denominator: "1",
  };
  if (s === "community_entrance_unit" || s === "community_block_entrance_unit") {
    row.entrance_label = "1";
  }
  if (s === "community_block_entrance_unit") {
    row.block_name = "Blok A";
  }
  return row;
}

// ── Header aliases ────────────────────────────────────────
//
// Spreadsheets from a správca rarely use our column keys. Headers are folded
// (lower case, no diacritics, no "*", single spaces) and mapped to a column
// key. A combined "a/b" value in a share column is split by the validator.

function foldHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[*:]/g, "")
    .replace(/[_\s]+/g, " ")
    .trim();
}

const HEADER_ALIASES: Record<string, string> = {
  // unit
  byt: "unit_number",
  "cislo bytu": "unit_number",
  "c bytu": "unit_number",
  "c. bytu": "unit_number",
  jednotka: "unit_number",
  "cislo jednotky": "unit_number",
  priestor: "unit_number",
  "unit number": "unit_number",
  unit: "unit_number",
  flat: "unit_number",
  poschodie: "unit_floor",
  podlazie: "unit_floor",
  patro: "unit_floor",
  floor: "unit_floor",
  vchod: "entrance_label",
  "cislo vchodu": "entrance_label",
  entrance: "entrance_label",
  blok: "block_name",
  block: "block_name",
  vymera: "unit_area_m2",
  plocha: "unit_area_m2",
  "vymera m2": "unit_area_m2",
  "plocha m2": "unit_area_m2",
  "podlahova plocha": "unit_area_m2",
  area: "unit_area_m2",
  podiel: "unit_share_numerator",
  "podiel bytu": "unit_share_numerator",
  "podiel na spolocnych castiach": "unit_share_numerator",
  "podiel k pozemku": "unit_share_numerator",
  podil: "unit_share_numerator",
  share: "unit_share_numerator",
  "typ priestoru": "unit_type",
  "typ prostoru": "unit_type",
  typ: "unit_type",
  type: "unit_type",
  // owner
  meno: "owner_name",
  "meno a priezvisko": "owner_name",
  "priezvisko a meno": "owner_name",
  "priezvisko meno": "owner_name",
  vlastnik: "owner_name",
  jmeno: "owner_name",
  "jmeno a prijmeni": "owner_name",
  "prijmeni a jmeno": "owner_name",
  name: "owner_name",
  owner: "owner_name",
  "rodne priezvisko": "owner_birth_name",
  ico: "owner_ico",
  adresa: "owner_address",
  "trvaly pobyt": "owner_address",
  bydlisko: "owner_address",
  address: "owner_address",
  email: "owner_email",
  "e mail": "owner_email",
  "e-mail": "owner_email",
  mail: "owner_email",
  telefon: "owner_phone",
  "tel c": "owner_phone",
  mobil: "owner_phone",
  phone: "owner_phone",
  "spoluvlastnicky podiel": "owner_unit_share_numerator",
  "podiel vlastnika": "owner_unit_share_numerator",
  "spoluvlastnicky podil": "owner_unit_share_numerator",
  "owner share": "owner_unit_share_numerator",
  "poradove cislo": "lv_ordinal",
  bsm: "ownership_form",
};

const KNOWN_KEYS = new Set(
  [...COMMON_HEAD, BLOCK_COL, ENTRANCE_COL, ...UNIT_AND_OWNER].map((c) => c.key)
);

/** Column key for a file header, or null when unknown. */
export function columnKeyForHeader(header: string): string | null {
  const trimmed = header.trim().replace(/\s*\*$/, "");
  if (KNOWN_KEYS.has(trimmed)) return trimmed;
  const folded = foldHeader(header);
  if (KNOWN_KEYS.has(folded.replace(/ /g, "_"))) return folded.replace(/ /g, "_");
  return HEADER_ALIASES[folded] ?? HEADER_ALIASES[folded.replace(/-/g, " ")] ?? null;
}

/**
 * Re-key raw spreadsheet rows by column key. Unknown headers are dropped;
 * when two headers map to the same key the first non-empty value wins.
 */
export function canonicaliseRows(raw: Record<string, unknown>[]): Record<string, unknown>[] {
  if (raw.length === 0) return raw;
  const headers = Object.keys(raw[0]);
  const map = new Map<string, string>();
  for (const h of headers) {
    const k = columnKeyForHeader(h);
    if (k) map.set(h, k);
  }
  return raw.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [h, v] of Object.entries(r)) {
      const k = map.get(h) ?? columnKeyForHeader(h);
      if (!k) continue;
      const empty = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
      if (out[k] === undefined || (!empty && (out[k] === "" || out[k] === undefined))) {
        out[k] = v;
      }
    }
    return out;
  });
}
