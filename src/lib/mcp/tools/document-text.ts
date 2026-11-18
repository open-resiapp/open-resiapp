import "server-only";

import type { DocumentRow } from "@/lib/documents.server";
import { extractPdfText } from "@/lib/pdf-text.server";
import { getStorage } from "@/lib/storage";
import { McpError } from "../errors";

// Text layer of a library document for get_document_text and the governing
// document resources (BYT-20261117-001 #22, BYT-20261118-012 §5). The caller
// has already checked visibility (getViewableDocument) and logs the access.

export const DOC_TEXT_CAP = 40_000;
const PDF_MAX_BYTES = 25 * 1024 * 1024;

export interface DocumentText {
  /** Truncated to DOC_TEXT_CAP characters. */
  text: string;
  hasTextLayer: boolean;
  truncated: boolean;
  totalChars: number;
}

/** Throws McpError validation.id {reason: not_pdf | too_large | unreadable_pdf} / not_found. */
export async function readDocumentText(
  doc: Pick<DocumentRow, "mimeType" | "storageKey">
): Promise<DocumentText> {
  if (doc.mimeType !== "application/pdf") {
    throw new McpError("validation.id", { reason: "not_pdf" });
  }
  const obj = await getStorage().get(doc.storageKey);
  if (!obj) throw new McpError("not_found");
  if (obj.body.length > PDF_MAX_BYTES) {
    throw new McpError("validation.id", { reason: "too_large" });
  }
  let text: string;
  try {
    text = (await extractPdfText(new Uint8Array(obj.body))).trim();
  } catch {
    throw new McpError("validation.id", { reason: "unreadable_pdf" });
  }
  const truncated = text.length > DOC_TEXT_CAP;
  return {
    text: truncated ? text.slice(0, DOC_TEXT_CAP) : text,
    hasTextLayer: text.replace(/\s+/g, "").length > 0,
    truncated,
    totalChars: text.length,
  };
}
