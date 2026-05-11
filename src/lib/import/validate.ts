import { z } from "zod";

import {
  type ImportError,
  type ImportPreview,
  type ImportRow,
  type ImportSummary,
  type StructureVariant,
} from "./types";
import { ONE, ZERO, add, eq, mul, parseShare, rational, type Rational } from "../rational";

// ── Row schema ────────────────────────────────────────────

const CountrySchema = z.enum(["sk", "cz"]);
const VotingMethodSchema = z.enum(["per_share", "per_flat", "per_area"]);

const stripBlank = (v: unknown) => {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
};

const stringField = z.preprocess(stripBlank, z.string().optional());
const requiredString = z.preprocess(stripBlank, z.string().min(1));

const intField = z.preprocess((v) => {
  const s = typeof v === "string" ? v.trim() : v;
  if (s === "" || s === undefined || s === null) return undefined;
  if (typeof s === "number") return s;
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? Math.trunc(n) : v;
}, z.number().int().nonnegative());

const optionalIntField = intField.optional();

const floorField = z.preprocess((v) => {
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "prízemie" || t === "prizemie" || t === "p" || t === "0") return 0;
    if (/^\d+\.?p?$/.test(t)) return Number(t.replace(/\.?p?$/, ""));
    const n = Number(t.replace(",", "."));
    return Number.isFinite(n) ? Math.trunc(n) : v;
  }
  return v;
}, z.number().int().min(0).max(60));

// Share parsing: accept many formats, normalize to integer num/den.
const shareNumeratorSchema = z.preprocess((v) => {
  if (typeof v !== "string" && typeof v !== "number") return v;
  const r = parseShare(String(v));
  return r ? Number(r.num) : v;
}, z.number().int().positive());

const shareDenominatorSchema = z.preprocess((v) => {
  if (typeof v !== "string" && typeof v !== "number") return v;
  const r = parseShare(String(v));
  return r ? Number(r.den) : v;
}, z.number().int().positive());

const emailSchema = z.preprocess(stripBlank, z.string().email().optional());

const rowSchemaForStructure = (structure: StructureVariant) =>
  z.object({
    community_name: requiredString,
    community_address: requiredString,
    community_ico: stringField,
    country: CountrySchema,
    voting_method: VotingMethodSchema,
    supisne_cislo: stringField,
    block_name:
      structure === "community_block_entrance_unit"
        ? requiredString
        : stringField,
    entrance_label:
      structure === "community_entrance_unit" ||
      structure === "community_block_entrance_unit"
        ? requiredString
        : stringField,
    unit_number: requiredString,
    unit_floor: floorField,
    unit_area_m2: optionalIntField,
    unit_share_numerator: shareNumeratorSchema,
    unit_share_denominator: shareDenominatorSchema,
    owner_name: requiredString,
    owner_address: stringField,
    owner_email: emailSchema,
    owner_phone: stringField,
    owner_unit_share_numerator: shareNumeratorSchema,
    owner_unit_share_denominator: shareDenominatorSchema,
  });

// ── Cross-row validation ──────────────────────────────────

const unitKey = (r: ImportRow) =>
  `${r.block_name ?? ""}|${r.entrance_label ?? ""}|${r.unit_number}`;

function communityFieldsConsistent(rows: ImportRow[], errors: ImportError[]) {
  if (rows.length === 0) return;
  const first = rows[0];
  const keys = [
    "community_name",
    "community_address",
    "country",
    "voting_method",
  ] as const;
  for (let i = 1; i < rows.length; i++) {
    for (const k of keys) {
      if (rows[i][k] !== first[k]) {
        errors.push({
          row: i + 1,
          column: k,
          code: "community_field_mismatch",
          message: `Hodnota "${k}" sa musí zhodovať na všetkých riadkoch (očakávané: ${first[k]}, nájdené: ${rows[i][k]})`,
        });
      }
    }
  }
}

function unitFieldsConsistent(rows: ImportRow[], errors: ImportError[]) {
  const byUnit = new Map<string, { first: ImportRow; firstIdx: number }>();
  rows.forEach((r, idx) => {
    const key = unitKey(r);
    const seen = byUnit.get(key);
    if (!seen) {
      byUnit.set(key, { first: r, firstIdx: idx });
      return;
    }
    const keys: (keyof ImportRow)[] = [
      "unit_floor",
      "unit_area_m2",
      "unit_share_numerator",
      "unit_share_denominator",
    ];
    for (const k of keys) {
      if (r[k] !== seen.first[k]) {
        errors.push({
          row: idx + 1,
          column: k,
          code: "unit_field_mismatch",
          message: `Byt ${r.unit_number} má rôzne hodnoty "${k}" na riadkoch ${seen.firstIdx + 1} a ${idx + 1}`,
        });
      }
    }
  });
}

function perUnitOwnerShareSumIsOne(
  rows: ImportRow[],
  errors: ImportError[]
): boolean {
  const byUnit = new Map<string, { rows: ImportRow[]; rowIndices: number[] }>();
  rows.forEach((r, idx) => {
    const key = unitKey(r);
    const slot = byUnit.get(key) ?? { rows: [], rowIndices: [] };
    slot.rows.push(r);
    slot.rowIndices.push(idx);
    byUnit.set(key, slot);
  });

  let allOk = true;
  for (const [key, slot] of byUnit) {
    let total: Rational = ZERO;
    for (const r of slot.rows) {
      total = add(
        total,
        rational(r.owner_unit_share_numerator, r.owner_unit_share_denominator)
      );
    }
    if (!eq(total, ONE)) {
      allOk = false;
      const example = slot.rows[0];
      errors.push({
        row: slot.rowIndices[0] + 1,
        column: "owner_unit_share_numerator",
        code: "owner_share_sum_not_one",
        message: `Byt "${example.unit_number}" (${key}) — súčet podielov vlastníkov v byte = ${total.num}/${total.den}, očakáva sa 1/1`,
      });
    }
  }
  return allOk;
}

function totalUnitShare(rows: ImportRow[]): Rational {
  // Sum unit_share once per unique unit (rows for the same unit repeat it).
  const seen = new Set<string>();
  let total: Rational = ZERO;
  for (const r of rows) {
    const key = unitKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    total = add(
      total,
      rational(r.unit_share_numerator, r.unit_share_denominator)
    );
  }
  return total;
}

// ── Public entry point ────────────────────────────────────

export interface ValidateInput {
  rows: unknown[]; // raw rows from CSV/XLSX/grid
  structure: StructureVariant;
}

export function validateImport(input: ValidateInput): ImportPreview {
  const errors: ImportError[] = [];
  const schema = rowSchemaForStructure(input.structure);

  const parsed: ImportRow[] = [];
  input.rows.forEach((raw, idx) => {
    const result = schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          row: idx + 1,
          column: (issue.path[0] as keyof ImportRow) ?? null,
          code: issue.code,
          message: issue.message,
        });
      }
      return;
    }
    parsed.push(result.data as ImportRow);
  });

  if (parsed.length === 0) {
    return { ok: errors.length === 0, summary: null, errors, rows: [] };
  }

  communityFieldsConsistent(parsed, errors);
  unitFieldsConsistent(parsed, errors);
  const ownerSumOk = perUnitOwnerShareSumIsOne(parsed, errors);

  // Community share sum should equal 1/1 — one LV per community.
  const totalShare = totalUnitShare(parsed);
  if (!eq(totalShare, ONE)) {
    errors.push({
      row: 0,
      column: null,
      code: "community_share_sum_not_one",
      message: `Súčet podielov bytov v komunite = ${totalShare.num}/${totalShare.den}, očakáva sa 1/1`,
    });
  }

  // Count unique units, blocks, entrances.
  const unitKeys = new Set(parsed.map(unitKey));
  const blockKeys = new Set(
    parsed.map((r) => r.block_name ?? "").filter((s) => s !== "")
  );
  const entranceKeys = new Set(
    parsed.map((r) => `${r.block_name ?? ""}|${r.entrance_label ?? ""}`)
      .filter((s) => s !== "|")
  );
  const ownerKeys = new Set(
    parsed.map((r) => (r.owner_email ?? r.owner_name).toLowerCase())
  );

  const summary: ImportSummary = {
    totalRows: parsed.length,
    communityName: parsed[0].community_name,
    blocks: blockKeys.size,
    entrances: entranceKeys.size,
    units: unitKeys.size,
    ownersNew: ownerKeys.size,
    ownersMatched: 0, // populated by seeder once DB lookups happen
    totalUnitShare: { num: totalShare.num.toString(), den: totalShare.den.toString() },
    perUnitOwnerShareOK: ownerSumOk,
  };

  return {
    ok: errors.length === 0,
    summary,
    errors,
    rows: parsed,
  };
}

// Re-export the row schema factory for adapters that want to dry-validate.
export { rowSchemaForStructure };

// Helper for the seeder to compute owner-of-community share without
// recomputing parse logic.
export function ownerCommunityShare(row: ImportRow): Rational {
  const unitShare = rational(row.unit_share_numerator, row.unit_share_denominator);
  const ownerUnitShare = rational(
    row.owner_unit_share_numerator,
    row.owner_unit_share_denominator
  );
  return mul(unitShare, ownerUnitShare);
}
