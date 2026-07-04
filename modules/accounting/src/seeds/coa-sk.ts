// SK chart of accounts — Phase 1 subset (BYT-20260512-002).
//
// Codes follow the spec's research against Opatrenie MF SR
// č. MF/24342/2007-74 (účtová osnova pre neziskové účtovné jednotky):
// analytics under 311 for pohľadávky voči vlastníkom, 472/478 for
// FPÚO/služby záväzky, 221/211 banka/pokladnica, 428 as the opening-balance
// korekcia target. Pending accountant review before the "Pohľad účtovníka"
// surface ships (spec Notes) — verify codes, do not rename silently: the
// posting engine references them via ACCOUNT_CODES.
//
// Seeded only what Phase 1 flows post to — full ~150-account chart is
// explicitly out (spec risk: chart-of-accounts scope creep). Expense (5xx)
// and revenue (6xx) accounts arrive with Phase 3.
//
// DB rows for this catalog are inserted by migration
// drizzle/0050_accounting_sk_catalog.sql — keep the two in sync: any change
// here requires a new migration.

export type AccountKind =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense";

export interface ChartAccountSeed {
  code: string;
  name: string;
  kind: AccountKind;
}

// Typed handles for the posting engine — never hardcode code strings.
export const ACCOUNT_CODES = {
  POKLADNICA: "211",
  BANKA: "221",
  POHLADAVKY_VLASTNICI_FPUO: "311.100",
  POHLADAVKY_VLASTNICI_SLUZBY: "311.200",
  DODAVATELIA: "321",
  INE_POHLADAVKY: "378",
  INE_ZAVAZKY: "379",
  ZAVAZKY_FPUO: "472",
  ZAVAZKY_SLUZBY: "478",
  VYSLEDOK_MINULYCH_ROKOV: "428",
  // Phase 3 expense accounts (5xx) — services okruh costs, settled with
  // the owners in the annual vyúčtovanie. FPÚO spending does NOT hit 5xx:
  // čerpanie fondu debits 472 directly (the fund shrinks).
  NAKLADY_ENERGIE: "502",
  NAKLADY_OPRAVY: "511",
  NAKLADY_SLUZBY: "518",
  NAKLADY_OSTATNE: "549",
} as const;

export const COA_SK: ChartAccountSeed[] = [
  { code: ACCOUNT_CODES.POKLADNICA, name: "Pokladnica", kind: "asset" },
  { code: ACCOUNT_CODES.BANKA, name: "Bankové účty", kind: "asset" },
  {
    code: ACCOUNT_CODES.POHLADAVKY_VLASTNICI_FPUO,
    name: "Pohľadávky voči vlastníkom — fond prevádzky, údržby a opráv",
    kind: "asset",
  },
  {
    code: ACCOUNT_CODES.POHLADAVKY_VLASTNICI_SLUZBY,
    name: "Pohľadávky voči vlastníkom — zálohy na služby",
    kind: "asset",
  },
  {
    code: ACCOUNT_CODES.INE_POHLADAVKY,
    name: "Iné pohľadávky",
    kind: "asset",
  },
  {
    code: ACCOUNT_CODES.INE_ZAVAZKY,
    name: "Iné záväzky",
    kind: "liability",
  },
  {
    code: ACCOUNT_CODES.ZAVAZKY_FPUO,
    name: "Záväzky z fondu prevádzky, údržby a opráv",
    kind: "liability",
  },
  {
    code: ACCOUNT_CODES.ZAVAZKY_SLUZBY,
    name: "Záväzky zo záloh na služby a plnenia",
    kind: "liability",
  },
  {
    code: ACCOUNT_CODES.VYSLEDOK_MINULYCH_ROKOV,
    name: "Nevysporiadaný výsledok hospodárenia minulých rokov",
    kind: "equity",
  },
  { code: ACCOUNT_CODES.DODAVATELIA, name: "Dodávatelia", kind: "liability" },
  {
    code: ACCOUNT_CODES.NAKLADY_ENERGIE,
    name: "Spotreba energie",
    kind: "expense",
  },
  {
    code: ACCOUNT_CODES.NAKLADY_OPRAVY,
    name: "Opravy a udržiavanie",
    kind: "expense",
  },
  {
    code: ACCOUNT_CODES.NAKLADY_SLUZBY,
    name: "Ostatné služby",
    kind: "expense",
  },
  {
    code: ACCOUNT_CODES.NAKLADY_OSTATNE,
    name: "Iné ostatné náklady",
    kind: "expense",
  },
];
