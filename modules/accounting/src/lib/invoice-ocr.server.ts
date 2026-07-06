import "server-only";

// Invoice OCR (BYT-20260512-002 AC 478) — turn an uploaded invoice's BYTES
// into text for the pure field extractor. Server-only (pdf-parse / child
// process). Two engines, tried in order:
//
//   1. pdf_text — the PDF's own text layer (pdf-parse). Digital / e-invoices
//      carry real text: deterministic, no external binary. This is the
//      common, reliable path and the one the golden suite pins.
//   2. tesseract — for scanned images (JPEG/PNG/WebP), shell out to a local
//      `tesseract` binary IF it is installed. This is BEST-EFFORT: if the
//      binary is missing we log and degrade to engine `none` rather than
//      hard-failing — the treasurer still gets a parked row to fill by hand.
//
// A scanned image-only PDF would need rasterization (poppler `pdftoppm`)
// before tesseract; that infra isn't wired here, so such a PDF returns
// engine `none` with a log. The email-inbound half of AC 478 (SES/Postmark
// + AV + allowlist, AC 480) stays BLOCKED.

import { spawn } from "child_process";
import { extractPdfText } from "./pdf-text.server";

export type OcrEngine = "pdf_text" | "tesseract" | "none";

export interface OcrResult {
  text: string;
  engine: OcrEngine;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Below this many word-ish characters we treat a PDF as having no usable
// text layer (a scanned image wrapped in a PDF).
const MIN_TEXT_CHARS = 24;

/** Run the local tesseract binary over image bytes; null if unavailable. */
function runTesseract(bytes: Uint8Array): Promise<string | null> {
  return new Promise((resolve) => {
    let proc;
    try {
      // stdin → stdout, SK + CZ + EN language data when present.
      proc = spawn("tesseract", ["stdin", "stdout", "-l", "slk+ces+eng"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (err) {
      console.warn("accounting: tesseract spawn failed — OCR skipped", err);
      return resolve(null);
    }
    let out = "";
    let done = false;
    const finish = (val: string | null) => {
      if (!done) {
        done = true;
        resolve(val);
      }
    };
    proc.on("error", (err: NodeJS.ErrnoException) => {
      // ENOENT = binary not installed. Degrade gracefully.
      console.warn(
        `accounting: tesseract unavailable (${err.code ?? err.message}) — OCR skipped`
      );
      finish(null);
    });
    proc.stdout?.on("data", (d) => (out += d.toString()));
    proc.on("close", (code) => finish(code === 0 && out.trim() ? out : null));
    try {
      proc.stdin?.end(Buffer.from(bytes));
    } catch {
      finish(null);
    }
  });
}

/**
 * Extract text from an uploaded invoice. Never throws for a scan we simply
 * can't read — returns engine `none` with empty text so the caller parks a
 * pending row the treasurer completes manually.
 */
export async function ocrInvoice(
  bytes: Uint8Array,
  contentType: string
): Promise<OcrResult> {
  if (contentType === "application/pdf") {
    try {
      const text = await extractPdfText(bytes);
      const wordChars = text.replace(/[^\p{L}\p{N}]/gu, "").length;
      if (wordChars >= MIN_TEXT_CHARS) return { text, engine: "pdf_text" };
      // No usable text layer → scanned PDF; rasterize+OCR isn't wired.
      console.warn(
        "accounting: PDF has no text layer (scanned?) — OCR of image-PDFs not wired"
      );
      return { text: "", engine: "none" };
    } catch (err) {
      console.error("accounting: PDF text extraction failed", err);
      return { text: "", engine: "none" };
    }
  }

  if (IMAGE_TYPES.has(contentType)) {
    const text = await runTesseract(bytes);
    if (text) return { text, engine: "tesseract" };
    return { text: "", engine: "none" };
  }

  console.warn(`accounting: unsupported invoice type ${contentType}`);
  return { text: "", engine: "none" };
}
