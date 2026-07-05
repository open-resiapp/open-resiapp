// Supplier-lookup response mappers (BYT-20260512-002 Phase 3) — PURE
// module: no server imports, loadable by golden checks and clients.
// Providers: FinStat (SK, API key) and ARES (CZ, free). The connector
// (supplier-lookup.ts) wraps these with caching + the injectable HTTP
// layer; tests run against mocked payloads only.
//
// NOTE: the FinStat shape below follows their public docs
// (api.finstat.sk /api/detail JSON) — verify against a real API key
// before production (spec open question: FinStat pricing/tier).

export interface SupplierInfo {
  found: boolean;
  ico: string;
  name: string | null;
  address: string | null;
  dic: string | null;
  icDph: string | null;
  /** Registered VAT payer. */
  vatPayer: boolean | null;
  /**
   * On the tax-debtor / unreliable-payer list — red flag before saving
   * an expense (spec: ručenie za DPH protection).
   */
  debtFlag: boolean | null;
  source: "finstat" | "ares";
}

/** SK IČO: 8 digits (6 historic allowed); CZ IČO: 8 digits. */
export function normalizeIco(raw: string): string | null {
  const ico = raw.replace(/\s/g, "");
  if (!/^\d{6,8}$/.test(ico)) return null;
  return ico.padStart(8, "0");
}

// ── FinStat (SK) ───────────────────────────────────────

export interface FinstatDetailJson {
  Ico?: string;
  Name?: string;
  Street?: string;
  StreetNumber?: string;
  ZipCode?: string;
  City?: string;
  Dic?: string;
  IcDphAdditional?: string;
  PaymentOrderWarning?: boolean;
  DebtWarning?: boolean;
}

export function mapFinstatDetail(
  ico: string,
  json: FinstatDetailJson | null
): SupplierInfo {
  if (!json || !json.Name) {
    return {
      found: false,
      ico,
      name: null,
      address: null,
      dic: null,
      icDph: null,
      vatPayer: null,
      debtFlag: null,
      source: "finstat",
    };
  }
  const addressParts = [
    [json.Street, json.StreetNumber].filter(Boolean).join(" "),
    [json.ZipCode, json.City].filter(Boolean).join(" "),
  ].filter((p) => p !== "");
  return {
    found: true,
    ico: json.Ico ?? ico,
    name: json.Name,
    address: addressParts.length > 0 ? addressParts.join(", ") : null,
    dic: json.Dic ?? null,
    icDph: json.IcDphAdditional ?? null,
    vatPayer: json.IcDphAdditional ? true : null,
    debtFlag: Boolean(json.PaymentOrderWarning || json.DebtWarning),
    source: "finstat",
  };
}

// ── ARES (CZ) ──────────────────────────────────────────

export interface AresSubjectJson {
  ico?: string;
  obchodniJmeno?: string;
  dic?: string;
  sidlo?: { textovaAdresa?: string };
}

export function mapAresSubject(
  ico: string,
  json: AresSubjectJson | null
): SupplierInfo {
  if (!json || !json.obchodniJmeno) {
    return {
      found: false,
      ico,
      name: null,
      address: null,
      dic: null,
      icDph: null,
      vatPayer: null,
      debtFlag: null,
      source: "ares",
    };
  }
  return {
    found: true,
    ico: json.ico ?? ico,
    name: json.obchodniJmeno,
    address: json.sidlo?.textovaAdresa ?? null,
    dic: json.dic ?? null,
    icDph: json.dic ?? null,
    vatPayer: json.dic ? true : null,
    // Unreliable-VAT-payer registry is a separate MFCR service — Phase 6.
    debtFlag: null,
    source: "ares",
  };
}

export function finstatDetailUrl(ico: string, apiKey: string): string {
  return `https://www.finstat.sk/api/detail?ico=${encodeURIComponent(ico)}&apiKey=${encodeURIComponent(apiKey)}&format=json`;
}

export function aresSubjectUrl(ico: string): string {
  return `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${encodeURIComponent(ico)}`;
}
