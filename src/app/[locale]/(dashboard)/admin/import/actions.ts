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
import { seedImport } from "@/lib/import/seed";
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
  structure: StructureVariant
): Promise<ImportPreview> {
  await requireAdmin();
  const buffer = Buffer.from(base64, "base64");
  let raw: Record<string, string>[];
  if (looksLikeXlsx(new Uint8Array(buffer))) {
    raw = parseXlsx(buffer);
  } else {
    raw = parseCsv(buffer.toString("utf8"));
  }
  return validateImport({ rows: raw, structure });
}

export async function parsePasteAction(
  text: string
): Promise<{ rows: Partial<ImportRow>[]; recognised: number }> {
  await requireAdmin();
  const drafts = parseLvText(text);
  return { rows: drafts, recognised: drafts.length };
}

export async function previewImportAction(
  rows: unknown[],
  structure: StructureVariant
): Promise<ImportPreview> {
  await requireAdmin();
  return validateImport({ rows, structure });
}

export async function commitImportAction(
  rows: ImportRow[],
  structure: StructureVariant
): Promise<{
  ok: boolean;
  errors?: ImportPreview["errors"];
  communityEntityId?: string;
}> {
  const actor = await requireAdmin();
  const preview = validateImport({ rows, structure });
  if (!preview.ok) {
    return { ok: false, errors: preview.errors };
  }
  const result = await seedImport({ rows: preview.rows, actorUserId: actor.id });
  return { ok: true, communityEntityId: result.communityEntityId };
}
