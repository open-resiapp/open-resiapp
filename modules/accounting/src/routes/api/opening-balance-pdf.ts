import { NextRequest, NextResponse } from "next/server";

import { requireWriter } from "@modules/accounting/src/lib/api-guard";
import { listUnitVs } from "@modules/accounting/src/lib/fee-schedules";
import { extractPdfText } from "@modules/accounting/src/lib/pdf-text.server";
import {
  matchVyuctovaniePdfsToUnits,
  type VyuctovaniePdfUnit,
} from "@modules/accounting/src/lib/vyuctovanie-pdf-import";

// Vyúčtovanie-PDF opening-balance ingest API (AC 508). Write-privileged
// (treasurer / admin) only — same guard as the rest of the opening-balance
// tool. Accepts one or more of THIS app's own SK settlement PDFs, extracts
// each unit's closing služby balance and returns it keyed by unit for the
// wizard to drop into the zálohy column. Matching is by VS (server-side,
// authoritative). No DB writes here — the wizard still posts through the
// normal opening-balance path once the treasurer confirms.

const MAX_FILES = 400; // one per unit for a large dom, plus slack
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB per PDF

export async function handlePost(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const uploads = form.getAll("files").filter((f): f is File => f instanceof File);
  if (uploads.length === 0) {
    return NextResponse.json({ error: "no files" }, { status: 400 });
  }
  if (uploads.length > MAX_FILES) {
    return NextResponse.json({ error: "too many files" }, { status: 413 });
  }

  const files: { fileName: string; text: string }[] = [];
  for (const upload of uploads) {
    const fileName = upload.name || "vyuctovanie.pdf";
    if (upload.size > MAX_BYTES) {
      // Oversized → treat as unreadable rather than aborting the batch.
      files.push({ fileName, text: "" });
      continue;
    }
    try {
      const bytes = new Uint8Array(await upload.arrayBuffer());
      files.push({ fileName, text: await extractPdfText(bytes) });
    } catch (err) {
      // Corrupt / non-PDF → empty text → the parser reports it as
      // not_app_vyuctovanie, so the batch continues.
      console.error(`opening-balance PDF ingest: unreadable ${fileName}`, err);
      files.push({ fileName, text: "" });
    }
  }

  const units: VyuctovaniePdfUnit[] = (await listUnitVs(ctx.root.id)).map((u) => ({
    id: u.unitEntityId,
    label: u.flatNumber ?? u.name,
    vs: u.vs,
  }));

  const result = matchVyuctovaniePdfsToUnits(files, units);
  return NextResponse.json(result);
}
