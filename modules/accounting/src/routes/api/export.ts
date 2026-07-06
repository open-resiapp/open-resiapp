import { NextRequest, NextResponse } from "next/server";

import { requireReader } from "@modules/accounting/src/lib/api-guard";
import {
  buildExportBundle,
  verifyExportBundle,
} from "@modules/accounting/src/lib/export";

// Signed export API — board roles (the kontrolná komisia works through
// the chairman; a dedicated komisia role can widen this later).

export async function handleExport(): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  try {
    const bundle = await buildExportBundle({
      entityId: ctx.root.id,
      country: ctx.root.country,
      entityName: ctx.root.name,
      generatedById: ctx.session.user.id,
    });
    return new NextResponse(bundle, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="accounting-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "export failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

const MAX_BUNDLE_BYTES = 50 * 1024 * 1024;

export async function handleVerify(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;

  const body = await req.text();
  if (!body || Buffer.byteLength(body, "utf8") > MAX_BUNDLE_BYTES) {
    return NextResponse.json({ error: "invalid bundle" }, { status: 400 });
  }
  try {
    const result = verifyExportBundle(body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "verify failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
