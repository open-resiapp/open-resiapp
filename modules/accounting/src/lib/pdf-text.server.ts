import "server-only";

// Thin server-only wrapper around pdf-parse (pdfjs under the hood). This is
// the ONLY non-pure seam of the vyúčtovanie-PDF ingest (AC 508): turning
// uploaded PDF BYTES into text. The text parsing / unit matching / money
// math all live in the client-safe, golden-tested vyuctovanie-pdf-import.ts.
//
// Kept out of the client bundle (pdfjs is large + server-oriented). The
// golden suite verifies the whole chain end-to-end by pdf-parsing a real
// committed fixture PDF, so this wrapper needs no separate unit test.

import { PDFParse } from "pdf-parse";

/** Extract the plain-text layer of a PDF. Throws on an unreadable file. */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const parser = new PDFParse({ data: bytes });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy().catch(() => {});
  }
}
