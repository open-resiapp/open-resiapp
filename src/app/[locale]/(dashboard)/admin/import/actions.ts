"use server";

import "server-only";

import { auth } from "@/lib/auth";
import type { UserRole } from "@/types";
import { hasPermission } from "@/lib/permissions";

import { generateCsvTemplate, parseCsv } from "@/lib/import/formats/csv";
import {
  generateXlsxTemplate,
  looksLikeXlsx,
  parseXlsx,
} from "@/lib/import/formats/xlsx";
import { parseLvText } from "@/lib/import/parsers/lv-paste";
import {
  DuplicateCommunityError,
  findExistingCommunity,
  seedImport,
} from "@/lib/import/seed";
import type { ImportPreview, ImportRow, StructureVariant } from "@/lib/import/types";
import { validateImport } from "@/lib/import/validate";

async function requireAdmin(): Promise<{ id: string; role: UserRole }> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Neautorizovaný prístup");
  }
  const role = session.user.role as UserRole;
  if (!hasPermission(role, "manageSettings")) {
    throw new Error("Nemáte oprávnenie na import");
  }
  return { id: session.user.id, role };
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
    raw = parseCsv(buffer.toString("utf8"));
  }
  return validateImport({ rows: raw, structure, community });
}

export async function parsePasteAction(
  text: string
): Promise<{ rows: Partial<ImportRow>[]; recognised: number }> {
  await requireAdmin();
  const drafts = parseLvText(text);
  return { rows: drafts, recognised: drafts.length };
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
    return { rows: [], recognised: 0, scanned: true, characters };
  }
  const drafts = parseLvText(normaliseLvPdfText(text));
  return {
    rows: drafts,
    recognised: drafts.length,
    scanned: false,
    characters,
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

export async function previewImportAction(
  rows: unknown[],
  structure: StructureVariant,
  community?: Record<string, unknown>,
  existingCommunityId?: string
): Promise<ImportPreview> {
  await requireAdmin();
  const preview = validateImport({ rows, structure, community });
  if (preview.ok && preview.rows.length > 0 && !existingCommunityId) {
    // Duplicate guard only matters when bootstrapping a new community.
    // When appending to an existing one, name/address mismatch is fine.
    const first = preview.rows[0];
    const existing = await findExistingCommunity(
      first.community_name,
      first.community_address
    );
    if (existing) {
      preview.ok = false;
      preview.errors.push({
        row: 0,
        column: null,
        code: "duplicate_community",
        message: `Komunita "${existing.name}" na adrese "${existing.address}" už existuje. Najprv archivujte existujúcu komunitu, alebo zmeňte názov/adresu vo formulári.`,
      });
    }
  }
  return preview;
}

export async function commitImportAction(
  rows: ImportRow[],
  structure: StructureVariant,
  community?: Record<string, unknown>,
  existingCommunityId?: string
): Promise<{
  ok: boolean;
  errors?: ImportPreview["errors"];
  communityEntityId?: string;
}> {
  const actor = await requireAdmin();
  const preview = validateImport({ rows, structure, community });
  if (!preview.ok) {
    return { ok: false, errors: preview.errors };
  }
  try {
    const result = await seedImport({
      rows: preview.rows,
      actorUserId: actor.id,
      existingCommunityId,
    });
    return { ok: true, communityEntityId: result.communityEntityId };
  } catch (err) {
    if (err instanceof DuplicateCommunityError) {
      return {
        ok: false,
        errors: [
          {
            row: 0,
            column: null,
            code: "duplicate_community",
            message: `Komunita "${err.name}" na adrese "${err.address}" už existuje. Import zrušený.`,
          },
        ],
      };
    }
    throw err;
  }
}
