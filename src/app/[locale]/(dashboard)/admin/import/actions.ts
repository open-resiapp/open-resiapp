"use server";

import "server-only";

import { eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { auth } from "@/lib/auth";
import type { UserRole } from "@/types";
import { hasPermission } from "@/lib/permissions";
import { getCommunityRoot, type CommunityRootRow } from "@/lib/legacy-compat";
import { ShellMergeError, mergeShellIntoUser } from "@/lib/shell-merge";
import { getDisplayTemplateSlug } from "@/lib/templates/display-slug";
import { getTemplate } from "@/lib/templates/loader";
import { normalizeVotingMethod } from "@/lib/voting-method";

import { analyseImport } from "@/lib/import/analyse.server";
import { canonicaliseRows } from "@/lib/import/columns";
import {
  applyContactUpdates,
  planContactUpdates,
  type ContactPlan,
} from "@/lib/import/contacts.server";
import {
  exportCommunityAsImportRows,
  flattenForExport,
} from "@/lib/import/export";
import { generateCsvTemplate, parseCsv } from "@/lib/import/formats/csv";
import {
  generateXlsxTemplate,
  looksLikeXlsx,
  parseXlsx,
} from "@/lib/import/formats/xlsx";
import { normaliseOwnerName, ownerKeysForRows } from "@/lib/import/owner-groups";
import { parseLvTextWithReport } from "@/lib/import/parsers/lv-paste";
import {
  DuplicateCommunityError,
  findExistingCommunity,
  findExistingOwnerEmails,
  importUnitKey,
  seedImport,
  type SeededOwner,
} from "@/lib/import/seed";
import type {
  ImportError,
  ImportPreview,
  ImportRow,
  LvParseReport,
  StructureVariant,
} from "@/lib/import/types";
import { validateImport } from "@/lib/import/validate";

// Errors thrown from these actions carry a stable code as their message;
// the page maps it to `Import.errors.<code>`.
async function requireAdmin(): Promise<{ id: string; role: UserRole }> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("unauthorized");
  }
  const role = session.user.role as UserRole;
  if (!hasPermission(role, "manageSettings")) {
    throw new Error("forbidden");
  }
  return { id: session.user.id, role };
}

/** "re-import" modes when a community already exists. */
export type ImportMode = "append" | "update_contacts";

export interface ImportOptions {
  /** Owner-group keys the admin split into separate people. */
  splitOwnerGroups?: string[];
  /** Warning codes the admin acknowledged (community share sum …). */
  acknowledgedWarnings?: string[];
  /** Append mode only. Default "append". */
  mode?: ImportMode;
}

export interface WizardPreview extends ImportPreview {
  /** Server-resolved: true when a community exists (append mode). */
  appendMode: boolean;
  mode: ImportMode | "create";
  /** update_contacts mode: what would change. */
  contactPlan?: ContactPlan;
}

export interface ImportCommitSummary {
  mode: ImportMode | "create";
  unitsCreated: number;
  unitsReused: number;
  unitsSkipped: number;
  skippedUnits: string[];
  ownersCreated: number;
  ownersLinked: number;
  membershipsCreated: number;
  membershipsSkipped: number;
  contactsUpdated: number;
  contactIssues: ContactPlan["issues"];
  /** Created owners whose name matches the importing admin. */
  adminCandidates: SeededOwner[];
}

interface ServerContext {
  root: CommunityRootRow | null;
  community: Record<string, unknown> | undefined;
  existingCommunityId: string | undefined;
  templateSlug: string;
}

/** Import enum for a stored (legacy or canonical) voting method. */
function importVotingMethod(stored: string | null | undefined): string {
  switch (normalizeVotingMethod(stored)) {
    case "one_per_unit":
      return "per_flat";
    case "per_area":
      return "per_area";
    case "one_per_member":
      return "one_per_member";
    case "custom_weight":
      return "custom_weight";
    default:
      return "per_share";
  }
}

/**
 * Append mode is decided on the SERVER: when a community exists, its stored
 * values and template win over anything the client sent (the locked panel
 * is display only). A missing address falls back to the name — the page
 * links to Settings instead of blocking the import.
 */
async function resolveContext(
  clientCommunity: Record<string, unknown> | undefined,
  clientTemplateSlug: string
): Promise<ServerContext> {
  const root = await getCommunityRoot();
  if (!root) {
    return {
      root: null,
      community: clientCommunity,
      existingCommunityId: undefined,
      templateSlug: clientTemplateSlug,
    };
  }
  return {
    root,
    community: {
      community_name: root.name,
      community_address: root.address || root.name,
      community_ico: root.ico ?? "",
      community_dic: root.dic ?? "",
      country: root.country === "cz" ? "cz" : "sk",
      voting_method: importVotingMethod(root.votingMethod),
    },
    existingCommunityId: root.id,
    templateSlug: getDisplayTemplateSlug(root.templateSlug) ?? root.templateSlug ?? "hoa",
  };
}

/**
 * The community 1/1 share check only makes sense when votes are weighted
 * by share; garage / garden templates (1/1 per unit) skip it.
 */
async function shareSumCheckFor(
  templateSlug: string,
  community: Record<string, unknown> | undefined
): Promise<"warn" | "off"> {
  const raw = String(community?.voting_method ?? "");
  if (raw === "per_share" || raw === "weighted_by_share") return "warn";
  if (raw) return "off";
  const tpl = await getTemplate(templateSlug);
  return !tpl || tpl.default_voting_method === "weighted_by_share" ? "warn" : "off";
}

/** UTF-8 when valid, else Windows-1250 (Slovak / Czech Excel CSV default). */
function decodeCsv(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1250").decode(buffer);
  }
}

export async function generateTemplateAction(
  structure: StructureVariant,
  format: "xlsx" | "csv"
): Promise<{ filename: string; mimeType: string; base64: string }> {
  await requireAdmin();
  if (format === "csv") {
    const csv = generateCsvTemplate(structure);
    return {
      filename: `import-${structure}.csv`,
      mimeType: "text/csv; charset=utf-8",
      base64: Buffer.from(csv, "utf8").toString("base64"),
    };
  }
  const xlsx = generateXlsxTemplate(structure);
  return {
    filename: `import-${structure}.xlsx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: Buffer.from(xlsx).toString("base64"),
  };
}

export async function parseUploadedFileAction(
  base64: string,
  structure: StructureVariant,
  community?: Record<string, unknown>
): Promise<ImportPreview> {
  await requireAdmin();
  const buffer = Buffer.from(base64, "base64");
  let raw: Record<string, string>[];
  if (looksLikeXlsx(new Uint8Array(buffer))) {
    raw = parseXlsx(buffer);
  } else {
    raw = parseCsv(decodeCsv(buffer));
  }
  // Slovak / Czech / English header aliases ("Byt", "Podiel", "Meno", …).
  const rows = canonicaliseRows(raw);
  return validateImport({ rows, structure, community });
}

export async function parsePasteAction(
  text: string
): Promise<{ rows: Partial<ImportRow>[]; recognised: number; report: LvParseReport }> {
  await requireAdmin();
  const { rows, report } = parseLvTextWithReport(text.slice(0, 2_000_000));
  return { rows, recognised: rows.length, report };
}

/**
 * Extract text from an uploaded LV PDF and run the Slovak LV parser on it.
 *
 * Only works for digital-text PDFs (ÚGKK exports them this way). Scanned
 * PDFs yield very little extractable text — we report `scanned: true` so the
 * wizard can surface a friendly "this looks like a scanned PDF, type rows
 * manually" message. No OCR (spec excludes it).
 */
export async function parsePdfAction(
  base64: string
): Promise<{
  rows: Partial<ImportRow>[];
  recognised: number;
  scanned: boolean;
  characters: number;
  report: LvParseReport | null;
}> {
  await requireAdmin();
  const buffer = Buffer.from(base64, "base64");
  // unpdf is dynamic-imported so it stays out of any client bundle.
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractText(pdf, { mergePages: true });
  // Heuristic: a real LV is ~50–200 KB of text; under 500 chars almost
  // certainly means a scanned PDF (or an empty/broken file).
  const characters = text.length;
  if (characters < 500) {
    return { rows: [], recognised: 0, scanned: true, characters, report: null };
  }
  const { rows, report } = parseLvTextWithReport(normaliseLvPdfText(text));
  return {
    rows,
    recognised: rows.length,
    scanned: false,
    characters,
    report,
  };
}

/**
 * unpdf's `extractText` joins items with single spaces rather than newlines.
 * Re-introduce structural breaks before every LV section keyword so the
 * downstream parser (which is line-oriented) can find them.
 *
 * Inserting \n before "Dátum narodenia:" is fine — the parser splits the
 * owner blob on ", Dátum narodenia:" not on newline.
 */
function normaliseLvPdfText(text: string): string {
  const markers = [
    "Vchod (číslo)",
    "Poschodie",
    "Číslo bytu",
    // Unit type (lv-paste.ts detectUnit): nebytový priestor / garáž.
    "Číslo nebytového priestoru",
    "Druh nebytového priestoru",
    "Podiel priestoru",
    "Súpisné číslo",
    "Miestna časť",
    "Iné údaje:",
    "Poradové",
    "Spoluvlastnícky",
    "Titul nadobudnutia:",
    "Poznámky:",
    "Správca",
    "Iná oprávnená",
    "Dátum narodenia:",
    "IČO:",
    "ČASŤ B",
    "ČASŤ C",
    "Účastník právneho vzťahu:",
  ];
  let out = text;
  for (const m of markers) {
    out = out.split(m).join("\n" + m);
  }
  // Collapse any tab / non-breaking space oddities to a regular space so the
  // parser's `\s+` patterns behave predictably.
  out = out.replace(/[\t ]+/g, " ");
  return out;
}

/**
 * Export the current grid state as an XLSX file the admin can edit in
 * Excel and re-upload. Used after paste-from-LV to give the admin a
 * spreadsheet-shaped view of the parsed data without leaving the import
 * wizard.
 */
export async function exportRowsAsXlsxAction(
  rows: Array<Record<string, string | number | undefined>>,
  structure: StructureVariant
): Promise<{ filename: string; mimeType: string; base64: string }> {
  await requireAdmin();
  const xlsx = generateXlsxTemplate(structure, rows);
  return {
    filename: `import-${structure}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: Buffer.from(xlsx).toString("base64"),
  };
}

/**
 * Export the current state of this instance's community as a downloadable
 * xlsx/csv file in the Easy Import column schema. Importing it on a freshly-
 * wiped instance reproduces the same state — round-trip safe.
 *
 * Returns `{ empty: true }` when there is no community yet (operator clicked
 * Export on a fresh instance). The UI shows a hint instead of an empty file.
 */
export async function exportCurrentDataAction(
  format: "xlsx" | "csv"
): Promise<
  | { empty: true }
  | { empty: false; filename: string; mimeType: string; base64: string }
> {
  await requireAdmin();
  const result = await exportCommunityAsImportRows();
  if (!result) return { empty: true };
  const dataRows = flattenForExport(result);
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "csv") {
    const csv = generateCsvTemplate(result.structure, dataRows);
    return {
      empty: false,
      filename: `export-${result.structure}-${stamp}.csv`,
      mimeType: "text/csv; charset=utf-8",
      base64: Buffer.from(csv, "utf8").toString("base64"),
    };
  }
  const xlsx = generateXlsxTemplate(result.structure, dataRows);
  return {
    empty: false,
    filename: `export-${result.structure}-${stamp}.xlsx`,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: Buffer.from(xlsx).toString("base64"),
  };
}

export async function previewImportAction(
  rows: unknown[],
  structure: StructureVariant,
  community?: Record<string, unknown>,
  existingCommunityId?: string,
  // Template the wizard is operating under; ignored in append mode (the
  // community's own template wins).
  templateSlug: string = "hoa",
  options: ImportOptions = {}
): Promise<WizardPreview> {
  void existingCommunityId;
  await requireAdmin();
  const ctx = await resolveContext(community, templateSlug);
  const mode: WizardPreview["mode"] = ctx.existingCommunityId ? (options.mode ?? "append") : "create";
  const shareSumCheck =
    mode === "update_contacts" ? "off" : await shareSumCheckFor(ctx.templateSlug, ctx.community);
  let preview = validateImport({
    rows,
    structure,
    community: ctx.community,
    shareSumCheck,
    splitOwnerGroups: options.splitOwnerGroups,
    contactsOnly: mode === "update_contacts",
  });
  const out: WizardPreview = { ...preview, appendMode: !!ctx.existingCommunityId, mode };

  if (!ctx.existingCommunityId) {
    if (preview.ok && preview.rows.length > 0) {
      // Duplicate guard only matters when bootstrapping a new community.
      const first = preview.rows[0];
      const existing = await findExistingCommunity(
        first.community_name,
        first.community_address
      );
      if (existing) {
        out.ok = false;
        out.errors.push({
          row: 0,
          column: null,
          code: "duplicate_community",
          message: "Community already exists",
          params: { name: existing.name, address: existing.address ?? "" },
        });
      }
    }
    if (out.summary) {
      // Owner groups whose e-mail already has an account are linked, not
      // created — same as the seeder.
      const keys = new Set(ownerKeysForRows(preview.rows, options.splitOwnerGroups));
      const matched = await findExistingOwnerEmails(
        [...keys].filter((k) => k.startsWith("e:")).map((k) => k.slice(2).split("#")[0])
      );
      const matchedGroups = [...keys].filter(
        (k) => k.startsWith("e:") && matched.has(k.slice(2).split("#")[0])
      ).length;
      out.summary = {
        ...out.summary,
        ownersNew: out.summary.ownersNew - matchedGroups,
        ownersMatched: matchedGroups,
      };
    }
    return out;
  }

  if (!preview.summary || preview.rows.length === 0) return out;

  if (mode === "update_contacts") {
    out.contactPlan = await planContactUpdates({
      rows: preview.rows,
      communityId: ctx.existingCommunityId,
      templateSlug: ctx.templateSlug,
    });
    return out;
  }

  // Append: skip units that already have owners; count exactly what the
  // seeder will create; check the share sum WITH the existing units.
  const analysis = await analyseImport({
    rows: preview.rows,
    communityId: ctx.existingCommunityId,
    templateSlug: ctx.templateSlug,
    splitOwnerGroups: options.splitOwnerGroups,
  });
  preview = validateImport({
    rows,
    structure,
    community: ctx.community,
    shareSumCheck,
    splitOwnerGroups: options.splitOwnerGroups,
    existingShareSum: analysis.existingShareSum,
  });
  return {
    ...preview,
    appendMode: true,
    mode,
    summary: preview.summary
      ? {
          ...preview.summary,
          units: analysis.unitsToCreate + analysis.unitsToFill,
          ownersNew: analysis.newAccounts,
          ownersMatched: analysis.matchedAccounts,
          unitsExisting: analysis.existingUnits,
          unitsSkipped: analysis.skippedLabels.length,
        }
      : null,
    skippedUnits: analysis.skippedLabels,
  };
}

export async function commitImportAction(
  rows: ImportRow[],
  structure: StructureVariant,
  community?: Record<string, unknown>,
  existingCommunityId?: string,
  templateSlug: string = "hoa",
  options: ImportOptions = {}
): Promise<{
  ok: boolean;
  errors?: ImportError[];
  communityEntityId?: string;
  summary?: ImportCommitSummary;
}> {
  void existingCommunityId;
  const actor = await requireAdmin();
  const ctx = await resolveContext(community, templateSlug);
  const mode: ImportCommitSummary["mode"] = ctx.existingCommunityId
    ? (options.mode ?? "append")
    : "create";
  const shareSumCheck =
    mode === "update_contacts" ? "off" : await shareSumCheckFor(ctx.templateSlug, ctx.community);
  const preview = validateImport({
    rows,
    structure,
    community: ctx.community,
    shareSumCheck,
    splitOwnerGroups: options.splitOwnerGroups,
    contactsOnly: mode === "update_contacts",
  });
  if (!preview.ok) {
    return { ok: false, errors: preview.errors };
  }

  const empty: ImportCommitSummary = {
    mode,
    unitsCreated: 0,
    unitsReused: 0,
    unitsSkipped: 0,
    skippedUnits: [],
    ownersCreated: 0,
    ownersLinked: 0,
    membershipsCreated: 0,
    membershipsSkipped: 0,
    contactsUpdated: 0,
    contactIssues: [],
    adminCandidates: [],
  };

  if (mode === "update_contacts" && ctx.existingCommunityId) {
    const plan = await applyContactUpdates({
      rows: preview.rows,
      communityId: ctx.existingCommunityId,
      templateSlug: ctx.templateSlug,
      actorUserId: actor.id,
    });
    return {
      ok: true,
      communityEntityId: ctx.existingCommunityId,
      summary: { ...empty, contactsUpdated: plan.changes.length, contactIssues: plan.issues },
    };
  }

  let rowsToSeed = preview.rows;
  let skippedUnits: string[] = [];
  let existingShareSum: { num: string; den: string } | undefined;
  if (ctx.existingCommunityId) {
    const analysis = await analyseImport({
      rows: preview.rows,
      communityId: ctx.existingCommunityId,
      templateSlug: ctx.templateSlug,
      splitOwnerGroups: options.splitOwnerGroups,
    });
    const skip = new Set(analysis.skippedUnitKeys);
    rowsToSeed = preview.rows.filter((r) => !skip.has(importUnitKey(r)));
    skippedUnits = analysis.skippedLabels;
    existingShareSum = analysis.existingShareSum;
  }

  // Warnings must be acknowledged (same check as the preview showed).
  const warnings =
    validateImport({
      rows,
      structure,
      community: ctx.community,
      shareSumCheck,
      existingShareSum,
    }).warnings ?? [];
  const acknowledged = new Set(options.acknowledgedWarnings ?? []);
  const open = warnings.filter((w) => !acknowledged.has(w.code));
  if (open.length > 0) {
    return {
      ok: false,
      errors: [
        {
          row: 0,
          column: null,
          code: "warnings_not_acknowledged",
          message: "Acknowledge the warnings first",
        },
      ],
    };
  }

  if (rowsToSeed.length === 0) {
    return {
      ok: true,
      communityEntityId: ctx.existingCommunityId,
      summary: { ...empty, unitsSkipped: skippedUnits.length, skippedUnits },
    };
  }

  try {
    const result = await seedImport({
      rows: rowsToSeed,
      actorUserId: actor.id,
      existingCommunityId: ctx.existingCommunityId,
      templateSlug: ctx.templateSlug,
      splitOwnerGroups: options.splitOwnerGroups,
      locale: await getLocale(),
    });

    // "Is this you?" — created owners whose name matches the admin.
    const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.id)).limit(1);
    const myName = me ? normaliseOwnerName(me.name) : "";
    const adminCandidates = myName
      ? result.createdOwners.filter((o) => normaliseOwnerName(o.name) === myName)
      : [];

    return {
      ok: true,
      communityEntityId: result.communityEntityId,
      summary: {
        ...empty,
        unitsCreated: result.unitsCreated,
        unitsReused: result.unitsReused,
        unitsSkipped: skippedUnits.length,
        skippedUnits,
        ownersCreated: result.ownersCreated,
        ownersLinked: result.ownersReused,
        membershipsCreated: result.membershipsCreated,
        membershipsSkipped: result.membershipsSkipped,
        adminCandidates,
      },
    };
  } catch (err) {
    if (err instanceof DuplicateCommunityError) {
      return {
        ok: false,
        errors: [
          {
            row: 0,
            column: null,
            code: "duplicate_community",
            message: "Community already exists",
            params: { name: err.name, address: err.address ?? "" },
          },
        ],
      };
    }
    throw err;
  }
}

/**
 * "Toto ste vy?" — the admin confirms that an owner the import just created
 * (a shell account without login) is himself. The shell is merged into the
 * admin's account through the existing shell-merge flow (memberships move,
 * shell deleted / tombstoned, audited as user.merge_shell).
 */
export async function claimImportedOwnerAction(
  shellUserId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await requireAdmin();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, shellUserId))
    .limit(1);
  const [me] = await db.select({ name: users.name }).from(users).where(eq(users.id, actor.id)).limit(1);
  const shell = rows[0];
  if (!shell || !me) return { ok: false, error: "shell_missing" };
  // Only the owner the import offered (same normalised name) can be claimed.
  if (normaliseOwnerName(shell.name) !== normaliseOwnerName(me.name)) {
    return { ok: false, error: "name_mismatch" };
  }
  try {
    await mergeShellIntoUser(shellUserId, actor.id, actor.id);
    return { ok: true };
  } catch (err) {
    if (err instanceof ShellMergeError) return { ok: false, error: err.code };
    console.error("[import] claim imported owner failed", err);
    return { ok: false, error: "failed" };
  }
}
