import { z } from "zod";

import {
  type ImportError,
  type ImportPreview,
  type ImportRow,
  type ImportSummary,
  type ImportWarning,
  type StructureVariant,
} from "./types";
import { FLOOR_MAX, FLOOR_MIN, normaliseFloor } from "./floor";
import { findOwnerGroups, ownerKeysForRows } from "./owner-groups";
import { ONE, ZERO, add, eq, mul, rational, sub, type Rational } from "../rational";
import { UNIT_TYPES, type UnitType } from "../unit-type";

// Every error / warning carries a stable `code` + `params`; the import page
// renders `Import.errors.<code>` (sk/en/cs). `message` is an English
// developer fallback only (MCP returns codes, never prose).

// ── Row schema ────────────────────────────────────────────

const SK_ALIASES = new Set([
  "sk",
  "svk",
  "slovakia",
  "slovensko",
  "slovak republic",
  "slovenská republika",
  "slovenska republika",
]);
const CZ_ALIASES = new Set([
  "cz",
  "cze",
  "czechia",
  "czech",
  "czech republic",
  "česko",
  "cesko",
  "česká republika",
  "ceska republika",
]);

const CountrySchema = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const t = v.trim().toLowerCase();
  if (SK_ALIASES.has(t)) return "sk";
  if (CZ_ALIASES.has(t)) return "cz";
  return v;
}, z.enum(["sk", "cz"]));

const VotingMethodSchema = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const t = v.trim().toLowerCase();
  if (
    [
      "per_share",
      "weighted_by_share",
      "podiel",
      "podla podielu",
      "podľa podielu",
      "by share",
      "share",
    ].includes(t)
  )
    return "per_share";
  if (
    [
      "per_flat",
      "one_per_unit",
      "podla bytu",
      "podľa bytu",
      "flat",
      "by flat",
      "unit",
    ].includes(t)
  )
    return "per_flat";
  if (
    [
      "per_area",
      "podla plochy",
      "podľa plochy",
      "area",
      "by area",
      "m2",
    ].includes(t)
  )
    return "per_area";
  return t;
}, z.enum(["per_share", "per_flat", "per_area", "one_per_member", "custom_weight"]));

const stripBlank = (v: unknown) => {
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  return trimmed === "" ? undefined : trimmed;
};

const stringField = z.preprocess(stripBlank, z.string().optional());
const requiredString = z.preprocess(stripBlank, z.string().min(1));

const coerceInt = (v: unknown): unknown => {
  const s = typeof v === "string" ? v.trim() : v;
  if (s === "" || s === undefined || s === null) return undefined;
  if (typeof s === "number") return s;
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? Math.trunc(n) : v;
};

const optionalIntField = z.preprocess(
  coerceInt,
  z.number().int().nonnegative().optional()
);

// Floor: -5..60, "suterén" / "1. PP" → -1, "n. PP" → -n (src/lib/import/floor.ts).
// Optional at field level — required for flats only (see the row refinement).
const floorField = z.preprocess(
  (v) => {
    if (v === undefined || v === null) return undefined;
    if (typeof v === "string" && v.trim() === "") return undefined;
    return normaliseFloor(v) ?? v;
  },
  z.number().int().min(FLOOR_MIN).max(FLOOR_MAX).optional()
);

// Share columns are plain positive integers. The previous version ran
// parseShare() on each cell which treated "96" as the fraction 96/1 and
// then returned its denominator (1) for unit_share_denominator — that
// silently turned every 1/96 into 1/1 and broke the community-sum check
// (76 × 1/1 = 76/1 instead of 76 × 1/96 = 19/24).
//
// A combined "1/96" typed into the NUMERATOR cell (denominator empty) is
// split before Zod runs — see splitCombinedShares().
const sharePartSchema = z.preprocess((v) => {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v !== "string") return v;
  const trimmed = v.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed.replace(",", "."));
  return Number.isFinite(n) ? Math.trunc(n) : v;
}, z.number().int().positive());

const shareNumeratorSchema = sharePartSchema;
const shareDenominatorSchema = sharePartSchema;

const emailSchema = z.preprocess(stripBlank, z.string().email().optional());

// Typ priestoru (src/lib/unit-type.ts). Accepts the canonical codes plus the
// Slovak / Czech words people type into a spreadsheet; empty = unclassified.
const UNIT_TYPE_ALIASES: Record<string, UnitType> = {
  byt: "flat",
  flat: "flat",
  "nebytový priestor": "non_residential",
  "nebytovy priestor": "non_residential",
  "nebytový prostor": "non_residential",
  "nebytovy prostor": "non_residential",
  np: "non_residential",
  non_residential: "non_residential",
  garáž: "garage",
  garaz: "garage",
  garage: "garage",
  iné: "other",
  ine: "other",
  jiné: "other",
  jine: "other",
  other: "other",
};
const unitTypeField = z.preprocess((v) => {
  const s = stripBlank(v);
  if (typeof s !== "string") return s;
  return UNIT_TYPE_ALIASES[s.toLowerCase()] ?? s;
}, z.enum(UNIT_TYPES).optional());

const optionalShare = z.preprocess(
  (v) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? undefined : v),
  sharePartSchema.optional()
);

/**
 * `contactsOnly`: the "update e-mails / phones only" import — a row needs
 * just the unit and the owner's name; shares and floor are not read.
 */
const rowSchemaForStructure = (structure: StructureVariant, opts: { contactsOnly?: boolean } = {}) =>
  z
  .object({
    community_name: requiredString,
    community_address: requiredString,
    community_ico: stringField,
    community_dic: stringField,
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
    unit_share_numerator: opts.contactsOnly ? optionalShare : shareNumeratorSchema,
    unit_share_denominator: opts.contactsOnly ? optionalShare : shareDenominatorSchema,
    unit_type: unitTypeField,
    owner_name: requiredString,
    owner_birth_name: stringField,
    owner_ico: stringField,
    owner_address: stringField,
    owner_email: emailSchema,
    owner_phone: stringField,
    owner_unit_share_numerator: opts.contactsOnly ? optionalShare : shareNumeratorSchema,
    owner_unit_share_denominator: opts.contactsOnly ? optionalShare : shareDenominatorSchema,
    // BYT-20261118-003: optional LV facts (kept, not validated as errors).
    lv_ordinal: optionalIntField,
    ownership_form: z.preprocess((v) => {
      const s = stripBlank(v);
      return typeof s === "string" ? s.toLowerCase() : s;
    }, z.enum(["bsm"]).optional()),
  })
  .superRefine((row, ctx) => {
    if (opts.contactsOnly) return;
    // Floor is optional for garages / nebytové priestory / other; a flat
    // (or an unclassified unit, read as flat) needs it.
    if (row.unit_floor === undefined && (!row.unit_type || row.unit_type === "flat")) {
      ctx.addIssue({ code: "custom", path: ["unit_floor"], message: "floor_required" });
    }
    if (
      row.owner_unit_share_numerator !== undefined &&
      row.owner_unit_share_denominator !== undefined &&
      row.owner_unit_share_numerator > row.owner_unit_share_denominator
    ) {
      ctx.addIssue({ code: "custom", path: ["owner_unit_share_numerator"], message: "share_above_one" });
    }
    if (
      row.unit_share_numerator !== undefined &&
      row.unit_share_denominator !== undefined &&
      row.unit_share_numerator > row.unit_share_denominator
    ) {
      ctx.addIssue({ code: "custom", path: ["unit_share_numerator"], message: "share_above_one" });
    }
  });

// ── Pre-Zod normalisation ─────────────────────────────────

const FRACTION_RE = /^\s*(\d+)\s*\/\s*(\d+)\s*$/;

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/**
 * "1/96" in one cell: accepted in the numerator column when the denominator
 * cell is empty (or holds the same denominator). Applies to both the unit's
 * share of the community and the owner's share of the unit.
 */
function splitCombinedShares(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw };
  const pairs = [
    ["unit_share_numerator", "unit_share_denominator"],
    ["owner_unit_share_numerator", "owner_unit_share_denominator"],
  ] as const;
  for (const [numKey, denKey] of pairs) {
    const v = out[numKey];
    if (typeof v !== "string") continue;
    const m = v.match(FRACTION_RE);
    if (!m) continue;
    const den = out[denKey];
    if (isBlank(den) || String(den).trim() === m[2]) {
      out[numKey] = m[1];
      out[denKey] = m[2];
    }
  }
  return out;
}

function zodIssueCode(column: string | null, issueMessage: string, rawValue: unknown): string {
  // Our own refinements carry the code as their message.
  if (
    issueMessage === "floor_required" ||
    issueMessage === "share_above_one"
  ) {
    return issueMessage;
  }
  if (isBlank(rawValue)) return "required";
  switch (column) {
    case "owner_email":
      return "invalid_email";
    case "unit_floor":
      return "floor_invalid";
    case "unit_share_numerator":
    case "unit_share_denominator":
    case "owner_unit_share_numerator":
    case "owner_unit_share_denominator":
      return "share_invalid";
    case "country":
      return "country_invalid";
    case "voting_method":
      return "voting_method_invalid";
    case "unit_type":
      return "unit_type_invalid";
    case "ownership_form":
      return "ownership_form_invalid";
    case "unit_area_m2":
    case "lv_ordinal":
      return "number_invalid";
    default:
      return "invalid_value";
  }
}

function shareText(r: Rational): string {
  return `${r.num}/${r.den}`;
}

// ── Cross-row validation ──────────────────────────────────

const unitKey = (r: ImportRow) =>
  `${r.block_name ?? ""}|${r.entrance_label ?? ""}|${r.unit_number}`;

function communityFieldsConsistent(rows: ImportRow[], errors: ImportError[]) {
  if (rows.length === 0) return;
  const keys = [
    "community_name",
    "community_address",
    "country",
    "voting_method",
  ] as const;
  for (const k of keys) {
    // Find the most common value across all rows (mode). Every row that
    // disagrees with the mode is flagged — including row 1 if it's the
    // odd one out, so the highlight points at the actual typo rather
    // than always at rows 2+.
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = String(r[k] ?? "");
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    if (counts.size <= 1) continue; // everyone agrees
    let modeValue = "";
    let modeCount = -1;
    for (const [v, c] of counts) {
      if (c > modeCount) {
        modeCount = c;
        modeValue = v;
      }
    }
    rows.forEach((r, idx) => {
      const v = String(r[k] ?? "");
      if (v !== modeValue) {
        errors.push({
          row: idx + 1,
          column: k,
          code: "community_field_mismatch",
          message: `"${k}" must be identical on every row`,
          params: { column: k, expected: modeValue, actual: v },
        });
      }
    });
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
      "unit_type",
    ];
    for (const k of keys) {
      if (r[k] !== seen.first[k]) {
        errors.push({
          row: idx + 1,
          column: k,
          code: "unit_field_mismatch",
          message: `Unit ${r.unit_number}: "${k}" differs between rows`,
          params: { unit: r.unit_number, column: k, firstRow: seen.firstIdx + 1, row: idx + 1 },
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
  for (const [, slot] of byUnit) {
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
        message: `Unit ${example.unit_number}: owners' shares sum to ${shareText(total)}, expected 1/1`,
        params: {
          unit: [example.block_name, example.entrance_label, example.unit_number]
            .filter(Boolean)
            .join(" / "),
          sum: shareText(total),
        },
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
  rows: unknown[]; // raw per-row data (no community fields)
  structure: StructureVariant;
  /**
   * Community-level fields entered once in the wizard's Community panel.
   * The validator splats these onto every row internally before per-row
   * Zod parsing. Keeps the wire payload small and makes "missing community
   * field" surface as ONE error, not N copies.
   *
   * Optional for backwards-compat with callers that still ship community
   * fields inside each row.
   */
  community?: Record<string, unknown>;
  /**
   * Append mode: the summed share of the units ALREADY in the community that
   * this import does not touch. The community-share check then compares
   * existing + imported against 1/1.
   */
  existingShareSum?: { num: bigint | number | string; den: bigint | number | string };
  /**
   * "warn" (default): a community share sum other than 1/1 is a WARNING the
   * admin acknowledges (actual sum + difference shown). "off": templates
   * that do not vote by share (garage, garden … with 1/1 per unit).
   */
  shareSumCheck?: "warn" | "off";
  /** Owner-group keys the admin split into separate people (preview UI). */
  splitOwnerGroups?: string[];
  /** "Update e-mails / phones only" import: unit + owner name suffice. */
  contactsOnly?: boolean;
}

export function validateImport(input: ValidateInput): ImportPreview {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];

  // Community pre-check (independent of rows array length).
  const COMMUNITY_REQUIRED: (keyof ImportRow)[] = [
    "community_name",
    "community_address",
    "country",
    "voting_method",
  ];
  const communityFromInput =
    input.community ?? ((input.rows[0] ?? {}) as Record<string, unknown>);
  let communityIncomplete = false;
  for (const k of COMMUNITY_REQUIRED) {
    if (isBlank(communityFromInput[k])) {
      communityIncomplete = true;
      errors.push({
        row: 0,
        column: k,
        code: "community_field_missing",
        message: `Community field "${k}" is required`,
        params: { column: k },
      });
    }
  }
  if (communityIncomplete) {
    return { ok: false, summary: null, errors, rows: [], warnings };
  }

  if (input.rows.length === 0) {
    return {
      ok: false,
      summary: null,
      errors: [{ row: 0, column: null, code: "no_rows", message: "No rows" }],
      rows: [],
      warnings,
    };
  }

  const schema = rowSchemaForStructure(input.structure, { contactsOnly: input.contactsOnly });

  // Splat community onto every raw row so per-row Zod schema sees all
  // required fields; split "a/b" cells.
  const mergedRaw = input.rows.map((r) =>
    splitCombinedShares({
      ...communityFromInput,
      ...(r as Record<string, unknown>),
    })
  );

  // A unit listed on ONE row with no owner share at all = sole owner (1/1).
  const rowsPerUnit = new Map<string, number>();
  const rawUnitKey = (r: Record<string, unknown>) =>
    `${String(r.block_name ?? "").trim()}|${String(r.entrance_label ?? "").trim()}|${String(r.unit_number ?? "").trim()}`;
  for (const r of mergedRaw) rowsPerUnit.set(rawUnitKey(r), (rowsPerUnit.get(rawUnitKey(r)) ?? 0) + 1);
  for (const r of mergedRaw) {
    if (
      isBlank(r.owner_unit_share_numerator) &&
      isBlank(r.owner_unit_share_denominator) &&
      rowsPerUnit.get(rawUnitKey(r)) === 1
    ) {
      r.owner_unit_share_numerator = "1";
      r.owner_unit_share_denominator = "1";
    }
  }

  const parsed: ImportRow[] = [];
  mergedRaw.forEach((raw, idx) => {
    const result = schema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const column = (issue.path[0] as keyof ImportRow | undefined) ?? null;
        const code = zodIssueCode(column, issue.message, column ? raw[column] : undefined);
        errors.push({
          row: idx + 1,
          column,
          code,
          message: issue.message,
          params: {
            row: idx + 1,
            column: column ?? "",
            value: column ? String(raw[column] ?? "").slice(0, 60) : "",
            min: FLOOR_MIN,
            max: FLOOR_MAX,
          },
        });
      }
      return;
    }
    parsed.push(result.data as ImportRow);
  });

  if (parsed.length === 0) {
    return { ok: errors.length === 0, summary: null, errors, rows: [], warnings };
  }

  communityFieldsConsistent(parsed, errors);
  if (input.contactsOnly) {
    return {
      ok: errors.length === 0,
      summary: {
        totalRows: parsed.length,
        communityName: parsed[0].community_name,
        blocks: 0,
        entrances: 0,
        units: new Set(parsed.map(unitKey)).size,
        ownersNew: 0,
        ownersMatched: 0,
        totalUnitShare: { num: "0", den: "1" },
        perUnitOwnerShareOK: true,
      },
      errors,
      rows: parsed,
      warnings,
    };
  }
  unitFieldsConsistent(parsed, errors);
  const ownerSumOk = perUnitOwnerShareSumIsOne(parsed, errors);

  // Community share sum. One LV = one community, so a complete import sums
  // to 1/1 — but a partial import, a non-HOA template or an LV whose
  // podiely do not reconcile exactly is legitimate: WARNING with the actual
  // sum and the difference, acknowledged by the admin before the commit.
  const importedShare = totalUnitShare(parsed);
  const existing = input.existingShareSum
    ? rational(BigInt(input.existingShareSum.num), BigInt(input.existingShareSum.den))
    : null;
  const totalShare = existing ? add(existing, importedShare) : importedShare;
  if ((input.shareSumCheck ?? "warn") === "warn" && !eq(totalShare, ONE)) {
    const diff = sub(ONE, totalShare);
    warnings.push({
      row: 0,
      column: null,
      code: existing ? "community_share_sum_with_existing_not_one" : "community_share_sum_not_one",
      message: `Unit shares sum to ${shareText(totalShare)}, expected 1/1`,
      params: {
        sum: shareText(totalShare),
        imported: shareText(importedShare),
        existing: existing ? shareText(existing) : "0",
        diff: diff.num < 0n ? `−${shareText({ num: -diff.num, den: diff.den })}` : shareText(diff),
      },
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
  // Same grouping the seeder uses → the preview count equals what is created
  // (before DB matching by e-mail, which the server action applies).
  const ownerKeys = new Set(ownerKeysForRows(parsed, input.splitOwnerGroups));

  const summary: ImportSummary = {
    totalRows: parsed.length,
    communityName: parsed[0].community_name,
    blocks: blockKeys.size,
    entrances: entranceKeys.size,
    units: unitKeys.size,
    ownersNew: ownerKeys.size,
    ownersMatched: 0, // populated by the server action once DB lookups happen
    totalUnitShare: { num: importedShare.num.toString(), den: importedShare.den.toString() },
    perUnitOwnerShareOK: ownerSumOk,
    ...(existing
      ? { communityShareWithExisting: { num: totalShare.num.toString(), den: totalShare.den.toString() } }
      : {}),
  };

  return {
    ok: errors.length === 0,
    summary,
    errors,
    rows: parsed,
    warnings,
    ownerGroups: parsed.length === input.rows.length ? findOwnerGroups(parsed) : [],
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
