import "server-only";

import { z } from "zod";

import {
  findExistingOwnerEmails,
  importUnitKey,
  matchExistingUnits,
  seedImport,
} from "@/lib/import/seed";
import type { ImportRow, StructureVariant } from "@/lib/import/types";
import { validateImport } from "@/lib/import/validate";
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
import { translatorFor } from "./format";
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

const importRowSchema = z.object({
  block_name: optCell(200),
  entrance_label: optCell(200),
  unit_number: cell(50),
  unit_floor: cell(30),
  unit_area_m2: optCell(30),
  unit_share_numerator: cell(30),
  unit_share_denominator: cell(30),
  owner_name: z.string().max(255),
  owner_address: z.string().max(500).nullish(),
  owner_email: z.string().max(254).nullish(),
  owner_phone: optCell(50),
  owner_unit_share_numerator: cell(30),
  owner_unit_share_denominator: cell(30),
});

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
    .describe("One row per (unit, owner) pair; co-owners repeat the unit columns on their own row."),
});

type ImportPayload = z.infer<typeof importOwnersSchema> & {
  /** Units that already exist WITH owners — skipped together with their rows. */
  skippedUnitKeys?: string[];
};

/** Columns validateImport treats as text: numbers from Excel become strings. */
const TEXT_COLUMNS = new Set([
  "block_name",
  "entrance_label",
  "unit_number",
  "owner_name",
  "owner_address",
  "owner_email",
  "owner_phone",
]);

/** Drops null / undefined cells, stringifies numeric text cells. */
function cleanRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) continue;
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
  return root.templateSlug ?? "hoa";
}

function unitLabel(r: Pick<ImportRow, "block_name" | "entrance_label" | "unit_number">): string {
  return [r.block_name, r.entrance_label, r.unit_number].filter(Boolean).join(" / ");
}

interface ImportAnalysis {
  rowsToSeed: ImportRow[];
  skippedUnitKeys: string[];
  skippedLabels: string[];
  unitsInFile: number;
  unitsToCreate: number;
  unitsToFill: number;
  ownerLinks: number;
  newAccounts: number;
  matchedAccounts: number;
}

/**
 * Read-only dry run against the current community. seedImport (append mode)
 * reuses an existing unit but still creates its owner rows — a row without
 * an e-mail always becomes a NEW owner record — so re-importing a unit that
 * already has owners would duplicate them. Such units are dropped here
 * together with all their rows; existing units WITHOUT an owner keep their
 * rows (owners are attached, the unit's own data stays as it is).
 */
async function analyseImport(ctx: ActionContext, rows: ImportRow[]): Promise<ImportAnalysis> {
  const matches = await matchExistingUnits({
    rows,
    communityId: ctx.root.id,
    templateSlug: templateSlugOf(ctx.root),
  });
  const skipped = new Set<string>();
  const fill = new Set<string>();
  for (const [k, m] of matches) (m.activeOwners > 0 ? skipped : fill).add(k);

  const rowsToSeed = rows.filter((r) => !skipped.has(importUnitKey(r)));
  const keptUnits = new Set(rowsToSeed.map(importUnitKey));
  const allUnits = new Set(rows.map(importUnitKey));

  // Mirror the seeder: an e-mail of an existing user reuses that account;
  // every other row creates an owner record (rows sharing a NEW e-mail → one).
  const matched = await findExistingOwnerEmails(
    rowsToSeed.map((r) => r.owner_email ?? "").filter(Boolean)
  );
  const matchedUsed = new Set<string>();
  const newEmails = new Set<string>();
  let newAccounts = 0;
  for (const r of rowsToSeed) {
    const e = r.owner_email?.trim().toLowerCase();
    if (e && matched.has(e)) {
      matchedUsed.add(e);
      continue;
    }
    if (e) {
      if (newEmails.has(e)) continue;
      newEmails.add(e);
    }
    newAccounts += 1;
  }

  const skippedLabels: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const k = importUnitKey(r);
    if (!skipped.has(k) || seen.has(k)) continue;
    seen.add(k);
    skippedLabels.push(unitLabel(r));
  }

  return {
    rowsToSeed,
    skippedUnitKeys: [...skipped].sort(),
    skippedLabels,
    unitsInFile: allUnits.size,
    unitsToCreate: [...keptUnits].filter((k) => !fill.has(k)).length,
    unitsToFill: [...keptUnits].filter((k) => fill.has(k)).length,
    ownerLinks: rowsToSeed.length,
    newAccounts,
    matchedAccounts: matchedUsed.size,
  };
}

const importOwners = defineAction<ImportPayload>({
  kind: "import_owners",
  scopes: ["read", "governance:write"],
  schema: importOwnersSchema as unknown as z.ZodType<ImportPayload>,
  authorize: (ctx) => assertPermission(ctx, "manageSettings"),
  async validate(ctx, p) {
    const structure = p.structure ?? "community_unit";
    const preview = validateImport({
      rows: p.rows.map((r) => cleanRow(r as Record<string, unknown>)),
      structure,
      community: communityColumns(ctx.root),
    });
    if (!preview.ok) {
      // Codes + positions only — never the validator's prose, which quotes
      // cell values.
      throw validationError("rows", {
        errors: preview.errors
          .slice(0, MAX_ERROR_DETAILS)
          .map((e) => ({ row: e.row, column: e.column, code: e.code })),
      });
    }
    const analysis = await analyseImport(ctx, preview.rows);
    if (analysis.rowsToSeed.length === 0) {
      throw validationError("rows", { reason: "all_units_exist_with_owners" });
    }
    // Normalised rows are the validator's own output: validating them again
    // (at confirm) returns the identical rows, so the payload hash matches.
    return { structure, rows: preview.rows, skippedUnitKeys: analysis.skippedUnitKeys };
  },
  async preview(ctx, p, locale) {
    const t = await translatorFor(locale);
    const rows = p.rows as unknown as ImportRow[];
    const a = await analyseImport(ctx, rows);
    const sample: PreviewRow[] = a.rowsToSeed.slice(0, PREVIEW_SAMPLE_ROWS).map((r, i) => ({
      label: t("Mcp.preview.importRowN", { n: i + 1 }),
      value: [
        unitLabel(r),
        r.owner_name,
        shareText(r.owner_unit_share_numerator, r.owner_unit_share_denominator),
      ].join(" · "),
      untrusted: true,
    }));
    const more = a.rowsToSeed.length - sample.length;
    const out: PreviewRow[] = [
      { label: t("Mcp.preview.community"), value: ctx.root.name },
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
      { label: t("Mcp.preview.ownerLinks"), value: String(a.ownerLinks) },
      { label: t("Mcp.preview.newAccounts"), value: String(a.newAccounts) },
      { label: t("Mcp.preview.matchedAccounts"), value: String(a.matchedAccounts) },
      { label: t("Mcp.preview.unitShareSum"), value: t("Mcp.preview.unitShareSumOk") },
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
    return {
      title: t("Mcp.actions.import_owners.title"),
      summary: t("Mcp.actions.import_owners.summary", {
        units: a.unitsToCreate + a.unitsToFill,
        rows: a.ownerLinks,
      }),
      rows: out,
      consequences,
      warnings: [],
    };
  },
  async commit(ctx, p) {
    const skip = new Set(p.skippedUnitKeys ?? []);
    const rows = (p.rows as unknown as ImportRow[]).filter((r) => !skip.has(importUnitKey(r)));
    const result = await seedImport({
      rows,
      actorUserId: ctx.principal.userId,
      existingCommunityId: ctx.root.id,
      templateSlug: templateSlugOf(ctx.root),
    });
    return {
      data: {
        unitsCreated: result.unitsCreated,
        ownersCreated: result.ownersCreated,
        ownersReused: result.ownersReused,
        membershipsCreated: result.membershipsCreated,
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

function activeOwnerSum(members: { role: string; status: string; shareNum: number; shareDen: number }[]): Rational {
  let sum: Rational = ZERO;
  for (const m of members) {
    if (m.role === "owner" && m.status === "active") sum = add(sum, rational(m.shareNum, m.shareDen));
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
          reason: member.role === "owner" && member.status === "active" ? "already_owner" : "already_member",
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
