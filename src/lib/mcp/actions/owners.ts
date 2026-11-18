import "server-only";

import { z } from "zod";

import { analyseImport, type ImportAnalysis } from "@/lib/import/analyse.server";
import { parseLvTextWithReport } from "@/lib/import/parsers/lv-paste";
import { findExistingOwnerEmails, importUnitKey, seedImport } from "@/lib/import/seed";
import type { ImportError, ImportPreview, ImportRow, StructureVariant } from "@/lib/import/types";
import { validateImport } from "@/lib/import/validate";
import { getDisplayTemplateSlug } from "@/lib/templates/display-slug";
import { getTemplate } from "@/lib/templates/loader";
import {
  addUnitOwner,
  createShellOwner,
  isUserInRoot,
  loadUnitOwnership,
} from "@/lib/owners-board.server";
import { hasPermission } from "@/lib/permissions";
import { add, gt, rational, ZERO, type Rational } from "@/lib/rational";
import { getUserAuthRow } from "@/lib/user-context";
import type { CommunityRootRow } from "@/lib/legacy-compat";
import { McpError, validationError } from "../errors";
import { uuidSchema } from "../tools/helpers";
import { hasMessage, translatorFor } from "./format";
import { defineAction, type ActionContext, type PreviewRow } from "./types";

// Owner / unit pending actions: bulk import of units + owners from a table
// the user handed to the model (same validator + seeder as the web import
// wizard, append mode) and assigning one person to one unit. Admin-only,
// like the web routes they mirror (manageSettings for the import,
// manageUsers for the owners screen).

const IMPORT_MAX_ROWS = 1000;
const PREVIEW_SAMPLE_ROWS = 10;
const MAX_ERROR_DETAILS = 20;

function assertPermission(ctx: ActionContext, permission: "manageSettings" | "manageUsers"): void {
  if (!hasPermission(ctx.principal.role, permission)) throw new McpError("forbidden");
}

function shareText(num: number | bigint, den: number | bigint): string {
  return `${num}/${den}`;
}

// ── import_owners ────────────────────────────────────────────────────────

const STRUCTURES = [
  "community_unit",
  "community_entrance_unit",
  "community_block_entrance_unit",
] as const satisfies readonly StructureVariant[];

/** A cell the model may send as text or number (Excel cells are either). */
const cell = (max: number) => z.union([z.string().max(max), z.number()]);
const optCell = (max: number) => cell(max).nullish();

// Every column the validator outputs must be listed here: at confirm the
// stored (normalised) rows are parsed with this schema again, and a column
// stripped here would change the re-validated rows → payload-hash conflict.
const importRowSchema = z.object({
  block_name: optCell(200),
  entrance_label: optCell(200),
  supisne_cislo: optCell(20).describe("Súpisné číslo of the building (from the LV), optional."),
  unit_number: cell(50),
  unit_floor: optCell(30).describe("Floor; '1. PP' / suterén = -1, prízemie = 0. Optional for garages / non-residential."),
  unit_area_m2: optCell(30),
  unit_type: optCell(40).describe("flat | non_residential | garage | other (or byt / nebytový priestor / garáž); empty = flat."),
  unit_share_numerator: cell(30),
  unit_share_denominator: cell(30),
  owner_name: z.string().max(255),
  owner_birth_name: z.string().max(255).nullish().describe("Rodné priezvisko from the LV ('r. Novák'), never part of owner_name."),
  owner_ico: optCell(20).describe("IČO of a legal-entity owner (družstvo, obec, s.r.o.)."),
  owner_address: z.string().max(500).nullish(),
  owner_email: z.string().max(254).nullish(),
  owner_phone: optCell(50),
  owner_unit_share_numerator: optCell(30),
  owner_unit_share_denominator: optCell(30),
  ownership_form: z.string().max(10).nullish().describe("'bsm' for bezpodielové spoluvlastníctvo manželov (spouses share one LV row)."),
  lv_ordinal: optCell(10).describe("Poradové číslo of the owner row on the LV (BSM spouses share one)."),
});

const LV_REPORT_MAX = 200;

/** What the LV parser recognised and every LV row it could NOT turn into a row. */
const lvReportSchema = z.object({
  recognisedOwners: z.number().int().min(0),
  recognisedUnits: z.number().int().min(0),
  skipped: z
    .array(
      z.object({
        lvRow: z.number().int().nullable(),
        text: z.string().max(300),
        reason: z.string().max(40),
      })
    )
    .max(LV_REPORT_MAX),
});
type LvReport = z.infer<typeof lvReportSchema>;

export const importOwnersSchema = z.object({
  structure: z
    .enum(STRUCTURES)
    .optional()
    .describe(
      "community_unit (default; entrance_label optional) | community_entrance_unit (entrance_label required) | community_block_entrance_unit (block_name + entrance_label required)."
    ),
  rows: z
    .array(importRowSchema)
    .min(1)
    .max(IMPORT_MAX_ROWS)
    .optional()
    .describe("One row per (unit, owner) pair; co-owners repeat the unit columns on their own row. Give rows OR lv_text."),
  lv_text: z
    .string()
    .min(50)
    .max(500_000)
    .optional()
    .describe(
      "Plain text of a Slovak list vlastníctva (LV) as copied from the cadastre PDF / katasterportal. The server parses it " +
        "(units, shares, owners, BSM, LV row numbers) and reports the LV rows it could not read. Give rows OR lv_text."
    ),
  // Internal: set by the server from lv_text, kept so the confirm-time
  // re-validation reproduces the preview. Not advertised to the model.
  lv_report: lvReportSchema.optional(),
});

type ImportPayload = z.infer<typeof importOwnersSchema> & {
  /** Units that already exist WITH owners — skipped together with their rows. */
  skippedUnitKeys?: string[];
};

/** Columns validateImport treats as text: numbers from Excel become strings. */
const TEXT_COLUMNS = new Set([
  "block_name",
  "entrance_label",
  "supisne_cislo",
  "unit_number",
  "unit_type",
  "owner_name",
  "owner_birth_name",
  "owner_ico",
  "owner_address",
  "owner_email",
  "owner_phone",
  "ownership_form",
]);

/** Community-level keys an LV row may carry; on append they come from the community. */
const COMMUNITY_KEYS = new Set([
  "community_name",
  "community_address",
  "community_ico",
  "community_dic",
  "country",
  "voting_method",
]);

/** Drops null / undefined cells and community keys, stringifies numeric text cells. */
function cleanRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined || COMMUNITY_KEYS.has(k)) continue;
    out[k] = TEXT_COLUMNS.has(k) && typeof v === "number" ? String(v) : v;
  }
  return out;
}

/**
 * Community-level columns come from the current community: on append the
 * seeder never reads them (it attaches under the existing root), they only
 * satisfy the validator. Same fallbacks as the web wizard's prefill.
 */
function communityColumns(root: CommunityRootRow): Record<string, unknown> {
  return {
    community_name: root.name,
    community_address: root.address || root.name,
    community_ico: root.ico ?? "",
    community_dic: root.dic ?? "",
    country: root.country ?? "sk",
    voting_method: root.votingMethod ?? "per_share",
  };
}

/** Template the web wizard passes for this community (/api/building → "hoa"). */
function templateSlugOf(root: CommunityRootRow): string {
  // Pre-Phase-5 installs carry legacy kind slugs ("housing_community", …);
  // map them to the catalog template so the share-sum rule + kind chain match
  // what the web wizard uses.
  return getDisplayTemplateSlug(root.templateSlug) ?? "hoa";
}

function unitLabel(r: Pick<ImportRow, "block_name" | "entrance_label" | "unit_number">): string {
  return [r.block_name, r.entrance_label, r.unit_number].filter(Boolean).join(" / ");
}

/** Validator share-sum warning codes (community 1/1 check, now non-blocking). */
const SHARE_SUM_CODES = new Set([
  "community_share_sum_not_one",
  "community_share_sum_with_existing_not_one",
]);

/** Error / warning details for the model: positions + codes + numbers, never cell values. */
function issueDetail(e: ImportError) {
  const params = e.params ? Object.fromEntries(Object.entries(e.params).filter(([k]) => k !== "value")) : undefined;
  return { row: e.row, column: e.column, code: e.code, ...(params ? { params } : {}) };
}

/**
 * Community 1/1 share check only when votes are weighted by share — same rule
 * as the web wizard (admin/import/actions.ts shareSumCheckFor): the
 * community's voting method decides, else the template default.
 */
async function shareSumCheckFor(root: CommunityRootRow): Promise<"warn" | "off"> {
  const raw = String(root.votingMethod ?? "");
  if (raw === "per_share" || raw === "weighted_by_share") return "warn";
  if (raw) return "off";
  const tpl = await getTemplate(templateSlugOf(root));
  return !tpl || tpl.default_voting_method === "weighted_by_share" ? "warn" : "off";
}

interface CheckedImport {
  preview: ImportPreview;
  analysis: ImportAnalysis;
  /** "off" = the community 1/1 sum was not checked (non-share voting). */
  shareSumCheck: "warn" | "off";
}

/** Validator + DB dry run: first pass for the rows, second with the existing share. */
async function checkImport(ctx: ActionContext, structure: StructureVariant, rows: Record<string, unknown>[]): Promise<CheckedImport> {
  const base = {
    rows: rows.map(cleanRow),
    structure,
    community: communityColumns(ctx.root),
    shareSumCheck: await shareSumCheckFor(ctx.root),
  };
  const first = validateImport(base);
  if (!first.ok) {
    // Codes + positions only — never the validator's prose, which quotes
    // cell values.
    throw validationError("rows", {
      errors: first.errors.slice(0, MAX_ERROR_DETAILS).map(issueDetail),
    });
  }
  const analysis = await analyseImport({
    rows: first.rows,
    communityId: ctx.root.id,
    templateSlug: templateSlugOf(ctx.root),
  });
  // Append mode: existing units' share + this import's share against 1/1,
  // so a building can be imported in batches (a partial sum is a warning).
  const preview = validateImport({ ...base, existingShareSum: analysis.existingShareSum });
  if (!preview.ok) {
    throw validationError("rows", {
      errors: preview.errors.slice(0, MAX_ERROR_DETAILS).map(issueDetail),
    });
  }
  return { preview, analysis, shareSumCheck: base.shareSumCheck };
}

const importOwners = defineAction<ImportPayload>({
  kind: "import_owners",
  scopes: ["read", "governance:write"],
  schema: importOwnersSchema as unknown as z.ZodType<ImportPayload>,
  authorize: (ctx) => assertPermission(ctx, "manageSettings"),
  async validate(ctx, p) {
    const structure = p.structure ?? "community_unit";
    if (!!p.rows === !!p.lv_text) {
      throw validationError("rows", { reason: "give_rows_or_lv_text" });
    }
    let rawRows: Record<string, unknown>[];
    let lvReport: LvReport | undefined = p.lv_report;
    if (p.lv_text) {
      const parsed = parseLvTextWithReport(p.lv_text);
      lvReport = {
        recognisedOwners: parsed.report.recognisedOwners,
        recognisedUnits: parsed.report.recognisedUnits,
        skipped: parsed.report.skipped.slice(0, LV_REPORT_MAX).map((x) => ({
          lvRow: x.lvRow,
          text: x.text.slice(0, 300),
          reason: x.reason,
        })),
      };
      rawRows = parsed.rows as Record<string, unknown>[];
      if (rawRows.length === 0) {
        throw validationError("lv_text", {
          reason: "nothing_recognised",
          errors: lvReport.skipped.slice(0, MAX_ERROR_DETAILS).map((x) => ({ lvRow: x.lvRow, code: x.reason })),
        });
      }
      if (rawRows.length > IMPORT_MAX_ROWS) throw validationError("lv_text", { reason: "too_many_rows" });
    } else {
      rawRows = (p.rows ?? []) as Record<string, unknown>[];
    }
    const { preview, analysis } = await checkImport(ctx, structure, rawRows);
    if (analysis.rowsToSeed.length === 0) {
      throw validationError("rows", { reason: "all_units_exist_with_owners" });
    }
    // Normalised rows are the validator's own output: validating them again
    // (at confirm) returns the identical rows, so the payload hash matches.
    return {
      structure,
      rows: preview.rows as unknown as ImportPayload["rows"],
      ...(lvReport ? { lv_report: lvReport } : {}),
      skippedUnitKeys: analysis.skippedUnitKeys,
    };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const { preview: v, analysis: a, shareSumCheck } = await checkImport(
      ctx,
      p.structure ?? "community_unit",
      (p.rows ?? []) as Record<string, unknown>[]
    );
    const sample: PreviewRow[] = a.rowsToSeed.slice(0, PREVIEW_SAMPLE_ROWS).map((r, i) => ({
      label: t("Mcp.preview.importRowN", { n: i + 1 }),
      value: [
        unitLabel(r),
        r.owner_name,
        shareText(r.owner_unit_share_numerator, r.owner_unit_share_denominator),
        r.ownership_form === "bsm" ? "BSM" : null,
      ]
        .filter(Boolean)
        .join(" · "),
      untrusted: true,
    }));
    const more = a.rowsToSeed.length - sample.length;

    const warnings: string[] = [];
    // "1/1 ✓" only when the sum was actually checked and no share-sum warning
    // came back; a non-share-voting community shows no sum row at all.
    let shareSumRow: PreviewRow | null =
      shareSumCheck === "warn"
        ? {
            label: t(a.existingShareSum.num !== "0" ? "Mcp.preview.unitShareSumWithExisting" : "Mcp.preview.unitShareSum"),
            value: t("Mcp.preview.unitShareSumOk"),
          }
        : null;
    for (const w of v.warnings ?? []) {
      const params = (w.params ?? {}) as Record<string, string | number>;
      if (SHARE_SUM_CODES.has(w.code)) {
        shareSumRow = {
          label: t(
            w.code === "community_share_sum_with_existing_not_one"
              ? "Mcp.preview.unitShareSumWithExisting"
              : "Mcp.preview.unitShareSum"
          ),
          value: t("Mcp.preview.unitShareSumGap", { sum: String(params.sum ?? ""), diff: String(params.diff ?? "") }),
        };
        warnings.push(
          t(
            w.code === "community_share_sum_with_existing_not_one"
              ? "Mcp.warnings.importShareSumWithExisting"
              : "Mcp.warnings.importShareSum",
            {
              sum: String(params.sum ?? ""),
              diff: String(params.diff ?? ""),
              existing: String(params.existing ?? ""),
              imported: String(params.imported ?? ""),
            }
          )
        );
        continue;
      }
      const key = `Import.errors.${w.code}`;
      warnings.push(
        (await hasMessage(locale, key))
          ? `${w.row > 0 ? t("Mcp.preview.importRowN", { n: w.row }) + ": " : ""}${t(key, params)}`
          : t("Mcp.warnings.importWarning", { code: w.code, row: w.row })
      );
    }

    const lvRows: PreviewRow[] = [];
    const lv = p.lv_report;
    if (lv) {
      lvRows.push({
        label: t("Mcp.preview.lvRecognised"),
        value: t("Mcp.preview.lvRecognisedValue", { owners: lv.recognisedOwners, units: lv.recognisedUnits }),
      });
      lvRows.push({ label: t("Mcp.preview.lvSkippedCount"), value: String(lv.skipped.length) });
      for (const x of lv.skipped.slice(0, PREVIEW_SAMPLE_ROWS)) {
        const reasonKey = `Mcp.preview.lvSkip_${x.reason}`;
        const reason = (await hasMessage(locale, reasonKey)) ? t(reasonKey) : x.reason;
        lvRows.push({
          label: x.lvRow !== null ? t("Mcp.preview.lvRowN", { n: x.lvRow }) : t("Mcp.preview.lvRow"),
          value: x.text ? `${reason}: ${x.text}` : reason,
          untrusted: true,
        });
      }
      if (lv.skipped.length > PREVIEW_SAMPLE_ROWS) {
        lvRows.push({ label: "…", value: t("Mcp.preview.moreRows", { count: lv.skipped.length - PREVIEW_SAMPLE_ROWS }) });
      }
      if (lv.skipped.length > 0) warnings.push(t("Mcp.warnings.lvRowsSkipped", { count: lv.skipped.length }));
    }

    const out: PreviewRow[] = [
      { label: t("Mcp.preview.community"), value: ctx.root.name },
      ...lvRows,
      { label: t("Mcp.preview.unitsInFile"), value: String(a.unitsInFile) },
      { label: t("Mcp.preview.unitsToCreate"), value: String(a.unitsToCreate) },
      { label: t("Mcp.preview.unitsToFill"), value: String(a.unitsToFill) },
      { label: t("Mcp.preview.unitsSkipped"), value: String(a.skippedLabels.length) },
      ...(a.skippedLabels.length
        ? [
            {
              label: t("Mcp.preview.skippedUnitList"),
              value:
                a.skippedLabels.slice(0, PREVIEW_SAMPLE_ROWS).join(", ") +
                (a.skippedLabels.length > PREVIEW_SAMPLE_ROWS ? ", …" : ""),
              untrusted: true,
            },
          ]
        : []),
      ...(a.existingUnits > 0
        ? [{ label: t("Mcp.preview.unitsExisting"), value: String(a.existingUnits) }]
        : []),
      { label: t("Mcp.preview.ownerLinks"), value: String(a.ownerLinks) },
      { label: t("Mcp.preview.newAccounts"), value: String(a.newAccounts) },
      { label: t("Mcp.preview.matchedAccounts"), value: String(a.matchedAccounts) },
      ...(shareSumRow ? [shareSumRow] : []),
      ...sample,
      ...(more > 0 ? [{ label: "…", value: t("Mcp.preview.moreRows", { count: more }) }] : []),
    ];
    const consequences = [
      t("Mcp.consequences.importCreates", { units: a.unitsToCreate, owners: a.newAccounts }),
    ];
    if (a.unitsToFill > 0) {
      consequences.push(t("Mcp.consequences.importFillsExisting", { count: a.unitsToFill }));
    }
    if (a.skippedLabels.length > 0) {
      consequences.push(t("Mcp.consequences.importSkipsExisting", { count: a.skippedLabels.length }));
    }
    if (a.matchedAccounts > 0) {
      consequences.push(t("Mcp.consequences.importMatchedByEmail", { count: a.matchedAccounts }));
    }
    const groups = (v.ownerGroups ?? []).length;
    if (groups > 0) consequences.push(t("Mcp.consequences.importOwnerGroups", { count: groups }));
    return {
      title: t("Mcp.actions.import_owners.title"),
      summary: t("Mcp.actions.import_owners.summary", {
        units: a.unitsToCreate + a.unitsToFill,
        rows: a.ownerLinks,
      }),
      rows: out,
      consequences,
      warnings,
    };
  },
  async commit(ctx, p, meta) {
    const skip = new Set(p.skippedUnitKeys ?? []);
    const rows = (p.rows as unknown as ImportRow[]).filter((r) => !skip.has(importUnitKey(r)));
    const result = await seedImport({
      rows,
      actorUserId: ctx.principal.userId,
      existingCommunityId: ctx.root.id,
      templateSlug: templateSlugOf(ctx.root),
      locale: meta.locale,
    });
    return {
      data: {
        unitsCreated: result.unitsCreated,
        unitsReused: result.unitsReused,
        ownersCreated: result.ownersCreated,
        ownersReused: result.ownersReused,
        membershipsCreated: result.membershipsCreated,
        membershipsSkipped: result.membershipsSkipped,
        unitsSkipped: skip.size,
      },
      path: "/owners",
    };
  },
});

// ── assign_unit_owner ────────────────────────────────────────────────────

export const assignUnitOwnerSchema = z.object({
  unitId: uuidSchema.describe("Unit id from list_units."),
  userId: uuidSchema
    .optional()
    .describe("Existing person of this community (from list_units). Give either userId or newOwner."),
  newOwner: z
    .object({
      name: z.string().trim().min(1).max(255).describe("Full name."),
      email: z.string().trim().max(254).optional().describe("Optional; must not belong to another account."),
      phone: z.string().trim().max(50).optional(),
    })
    .optional()
    .describe("A person not in the app yet: created as an owner without login (no invitation is sent)."),
  shareNumerator: z.number().int().min(1).max(1_000_000).optional().describe("Owner's share of the unit, numerator (default 1)."),
  shareDenominator: z.number().int().min(1).max(1_000_000).optional().describe("Owner's share of the unit, denominator (default 1)."),
});

type AssignPayload = z.infer<typeof assignUnitOwnerSchema>;

/** Unit-holder roles: owner (SVB / HOA) and member (bytové družstvo, template member_role). */
const isHolderRole = (role: string): boolean => role === "owner" || role === "member";

function activeOwnerSum(members: { role: string; status: string; shareNum: number; shareDen: number }[]): Rational {
  let sum: Rational = ZERO;
  for (const m of members) {
    if (isHolderRole(m.role) && m.status === "active") sum = add(sum, rational(m.shareNum, m.shareDen));
  }
  return sum;
}

const assignUnitOwner = defineAction<AssignPayload>({
  kind: "assign_unit_owner",
  scopes: ["read", "governance:write"],
  schema: assignUnitOwnerSchema,
  authorize: (ctx) => assertPermission(ctx, "manageUsers"),
  async validate(ctx, p) {
    if (!!p.userId === !!p.newOwner) {
      throw validationError("userId", { reason: "give_user_id_or_new_owner" });
    }
    const shareNumerator = p.shareNumerator ?? 1;
    const shareDenominator = p.shareDenominator ?? 1;
    if (shareNumerator > shareDenominator) {
      throw validationError("shareNumerator", { reason: "share_above_one" });
    }
    const own = await loadUnitOwnership(ctx.root.id, p.unitId);
    if (!own) throw validationError("unitId", { reason: "unit_not_found" });

    let newOwner: AssignPayload["newOwner"];
    if (p.userId) {
      if (!(await isUserInRoot(p.userId, ctx.root.id))) {
        throw validationError("userId", { reason: "not_in_community" });
      }
      const member = own.members.find((m) => m.userId === p.userId);
      if (member) {
        throw validationError("userId", {
          reason: isHolderRole(member.role) && member.status === "active" ? "already_owner" : "already_member",
        });
      }
    } else if (p.newOwner) {
      const email = p.newOwner.email?.trim().toLowerCase() || undefined;
      if (email && (!email.includes("@") || email.length > 254)) {
        throw validationError("newOwner", { reason: "invalid_email" });
      }
      if (email && (await findExistingOwnerEmails([email])).size > 0) {
        throw validationError("newOwner", { reason: "email_taken" });
      }
      const phone = p.newOwner.phone?.trim() || undefined;
      newOwner = {
        name: p.newOwner.name.trim(),
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
      };
    }

    const after = add(activeOwnerSum(own.members), rational(shareNumerator, shareDenominator));
    if (gt(after, rational(1, 1))) {
      throw validationError("shareNumerator", { reason: "unit_share_sum_exceeds_one" });
    }
    return {
      unitId: p.unitId,
      ...(p.userId ? { userId: p.userId } : {}),
      ...(newOwner ? { newOwner } : {}),
      shareNumerator,
      shareDenominator,
    };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const own = await loadUnitOwnership(ctx.root.id, p.unitId);
    if (!own) throw validationError("unitId", { reason: "unit_not_found" });
    const num = p.shareNumerator ?? 1;
    const den = p.shareDenominator ?? 1;
    const before = activeOwnerSum(own.members);
    const after = add(before, rational(num, den));
    const unit = [own.unit.entranceName, own.unit.flatNumber].filter(Boolean).join(" / ");

    const existing = p.userId ? await getUserAuthRow(p.userId) : null;
    const personName = existing?.name ?? p.newOwner?.name ?? "—";
    const rows: PreviewRow[] = [
      { label: t("Mcp.preview.unit"), value: unit, untrusted: true },
      { label: t("Mcp.preview.person"), value: personName, untrusted: true },
      {
        label: t("Mcp.preview.personKind"),
        value: p.userId ? t("Mcp.preview.personExisting") : t("Mcp.preview.personNew"),
      },
      ...(p.newOwner?.email ? [{ label: t("Mcp.preview.email"), value: p.newOwner.email, untrusted: true }] : []),
      ...(p.newOwner?.phone ? [{ label: t("Mcp.preview.phone"), value: p.newOwner.phone, untrusted: true }] : []),
      { label: t("Mcp.preview.ownerShare"), value: shareText(num, den) },
      {
        label: t("Mcp.preview.unitOwnerShareSum"),
        before: shareText(before.num, before.den),
        after: shareText(after.num, after.den),
      },
    ];
    const warnings: string[] = [];
    if (gt(rational(1, 1), after)) {
      warnings.push(t("Mcp.warnings.unitShareSumIncomplete", { sum: shareText(after.num, after.den) }));
    }
    if (existing && !hasPermission(existing.role, "vote")) {
      warnings.push(t("Mcp.warnings.ownerCannotVote"));
    }
    return {
      title: t("Mcp.actions.assign_unit_owner.title"),
      summary: t("Mcp.actions.assign_unit_owner.summary", { name: personName, unit }),
      rows,
      consequences: [
        p.userId ? t("Mcp.consequences.ownerAssigned") : t("Mcp.consequences.ownerCreatedNoInvite"),
      ],
      warnings,
    };
  },
  async commit(ctx, p) {
    const shareNum = p.shareNumerator ?? 1;
    const shareDen = p.shareDenominator ?? 1;
    if (p.userId) {
      const res = await addUnitOwner({
        userId: p.userId,
        unitId: p.unitId,
        rootId: ctx.root.id,
        shareNum,
        shareDen,
        actorUserId: ctx.principal.userId,
        source: "mcp",
      });
      if (!res.ok) {
        if (res.error === "invalid_share") throw validationError("shareNumerator");
        if (res.error === "failed") throw new McpError("internal");
        throw new McpError("conflict.state_changed");
      }
      return { data: { userId: p.userId, unitId: p.unitId }, path: `/owners/${p.userId}` };
    }
    const owner = p.newOwner!;
    const res = await createShellOwner({
      name: owner.name,
      email: owner.email ?? null,
      phone: owner.phone ?? null,
      unitId: p.unitId,
      shareNum,
      shareDen,
      role: "owner",
      actorUserId: ctx.principal.userId,
      rootId: ctx.root.id,
      source: "mcp",
    });
    if (!res.ok) {
      if (res.error === "email_taken" || res.error === "invalid_email" || res.error === "name_required") {
        throw validationError("newOwner", { reason: res.error });
      }
      if (res.error === "invalid_share") throw validationError("shareNumerator");
      if (res.error === "unit_not_found") throw new McpError("conflict.state_changed");
      throw new McpError("internal");
    }
    return { data: { userId: res.id, unitId: p.unitId }, path: `/owners/${res.id}` };
  },
});

export const OWNER_ACTIONS = [importOwners, assignUnitOwner];
