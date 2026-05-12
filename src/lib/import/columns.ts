import type { StructureVariant } from "./types";

// Column ordering and labels live here so CSV + XLSX generators and the
// in-app grid all stay aligned with one source of truth.

export interface ColumnDef {
  key: string;
  label: string; // header shown in template + grid
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
  comment?: string;
}

const COMMON_HEAD: ColumnDef[] = [
  {
    key: "community_name",
    label: "community_name",
    required: true,
    scope: "community",
    excelFormat: "string",
    comment: "Názov bytového domu (rovnaký na každom riadku).",
  },
  {
    key: "community_address",
    label: "community_address",
    required: true,
    scope: "community",
    excelFormat: "string",
    comment: "Ulica + mesto. Z LV: 'Popis stavby' bez čísla vchodu.",
  },
  {
    key: "community_ico",
    label: "community_ico",
    required: false,
    scope: "community",
    excelFormat: "string",
    comment: "IČO SVB, ak je pridelené (voliteľné).",
  },
  {
    key: "country",
    label: "country",
    required: true,
    scope: "community",
    excelFormat: "enum",
    enumOptions: ["sk", "cz"],
    comment: "Krajina — sk alebo cz.",
  },
  {
    key: "voting_method",
    label: "voting_method",
    required: true,
    scope: "community",
    excelFormat: "enum",
    enumOptions: ["per_share", "per_flat", "per_area"],
    comment: "Spôsob hlasovania.",
  },
  {
    key: "supisne_cislo",
    label: "supisne_cislo",
    required: false,
    scope: "community",
    excelFormat: "string",
    comment: "Súpisné číslo stavby (z LV).",
  },
];

const BLOCK_COL: ColumnDef = {
  key: "block_name",
  label: "block_name",
  required: true,
  scope: "row",
  excelFormat: "string",
  comment: "Názov bloku, napr. 'Blok A'.",
};

const ENTRANCE_COL: ColumnDef = {
  key: "entrance_label",
  label: "entrance_label",
  required: true,
  scope: "row",
  excelFormat: "string",
  comment: "Označenie vchodu, napr. '1' alebo 'Štúrova 12'.",
};

const UNIT_AND_OWNER: ColumnDef[] = [
  {
    key: "unit_number",
    label: "unit_number",
    required: true,
    scope: "row",
    excelFormat: "string",
    comment: "Číslo bytu z LV.",
  },
  {
    key: "unit_floor",
    label: "unit_floor",
    required: true,
    scope: "row",
    excelFormat: "string",
    comment: "Poschodie. 'prízemie' alebo '0', '1', '2', …",
  },
  {
    key: "unit_area_m2",
    label: "unit_area_m2",
    required: false,
    scope: "row",
    excelFormat: "int",
    comment: "Výmera bytu v m². V LV nie je — voliteľné, doplníte neskôr.",
  },
  {
    key: "unit_share_numerator",
    label: "unit_share_numerator",
    required: true,
    scope: "row",
    excelFormat: "text",
    comment: "Čitateľ podielu BYTU na komunite. Z LV: 'Podiel priestoru ... k pozemku' (napr. 1 z '1/96').",
  },
  {
    key: "unit_share_denominator",
    label: "unit_share_denominator",
    required: true,
    scope: "row",
    excelFormat: "text",
    comment: "Menovateľ podielu BYTU na komunite (napr. 96 z '1/96').",
  },
  {
    key: "owner_name",
    label: "owner_name",
    required: true,
    scope: "row",
    excelFormat: "string",
    comment: "Meno a priezvisko vlastníka (z LV).",
  },
  {
    key: "owner_address",
    label: "owner_address",
    required: false,
    scope: "row",
    excelFormat: "string",
    comment: "Trvalý pobyt vlastníka (z LV). Voliteľné.",
  },
  {
    key: "owner_email",
    label: "owner_email",
    required: false,
    scope: "row",
    excelFormat: "string",
    comment: "Email vlastníka. Ak chýba, vytvorí sa pending účet bez prihlásenia.",
  },
  {
    key: "owner_phone",
    label: "owner_phone",
    required: false,
    scope: "row",
    excelFormat: "string",
    comment: "Telefón vlastníka. Voliteľné.",
  },
  {
    key: "owner_unit_share_numerator",
    label: "owner_unit_share_numerator",
    required: true,
    scope: "row",
    excelFormat: "text",
    comment: "Čitateľ podielu vlastníka na BYTE. Z LV 'Spoluvlastnícky podiel' (napr. 1 z '1/2'). Sole owner = 1.",
  },
  {
    key: "owner_unit_share_denominator",
    label: "owner_unit_share_denominator",
    required: true,
    scope: "row",
    excelFormat: "text",
    comment: "Menovateľ podielu vlastníka na BYTE. Sole owner = 1.",
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
    country: "sk",
    voting_method: "per_share",
    supisne_cislo: "2514",
    unit_number: "1",
    unit_floor: "prízemie",
    unit_area_m2: "",
    unit_share_numerator: "1",
    unit_share_denominator: "96",
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
