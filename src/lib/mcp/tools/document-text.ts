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
  /** One chunk: up to DOC_TEXT_CAP characters starting at `offset`. */
  text: string;
  hasTextLayer: boolean;
  /** More text follows (nextOffset !== null). */
  truncated: boolean;
  totalChars: number;
  offset: number;
  /** Offset of the next chunk, null at the end of the document. */
  nextOffset: number | null;
}

/**
 * Throws McpError validation.id {reason: not_pdf | too_large | unreadable_pdf} / not_found,
 * validation.offset {reason: beyond_end} when `offset` is past the end of a text layer.
 */
export async function readDocumentText(
  doc: Pick<DocumentRow, "mimeType" | "storageKey">,
  offset = 0
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
  const hasTextLayer = text.replace(/\s+/g, "").length > 0;
  if (!hasTextLayer) {
    return { text: "", hasTextLayer, truncated: false, totalChars: 0, offset: 0, nextOffset: null };
  }
  if (offset >= text.length) throw new McpError("validation.offset", { reason: "beyond_end" });
  const body = text.slice(offset, offset + DOC_TEXT_CAP);
  const end = offset + body.length;
  const nextOffset = end < text.length ? end : null;
  return {
    text: body,
    hasTextLayer,
    truncated: nextOffset !== null,
    totalChars: text.length,
    offset,
    nextOffset,
  };
}
