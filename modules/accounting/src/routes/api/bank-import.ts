import { NextRequest, NextResponse } from "next/server";

import { requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  confirmBankLineMatch,
  dismissBankLine,
  importCamt053Statement,
  listUnmatchedBankLines,
} from "@modules/accounting/src/lib/bank-import";
import { listPayableUnits } from "@modules/accounting/src/lib/payments";

// Bank import + reconciliation API — treasurer/admin only (whole-dom
// financial mutation surface).

const MAX_XML_BYTES = 10 * 1024 * 1024;

/** POST /api/accounting/bank-import — body { xml }. */
export async function handleImport(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: { xml?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.xml !== "string" || body.xml.trim() === "") {
    return NextResponse.json({ error: "missing xml" }, { status: 400 });
  }
  if (Buffer.byteLength(body.xml, "utf8") > MAX_XML_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  try {
    const summary = await importCamt053Statement({
      entityId: ctx.root.id,
      country: ctx.root.country,
      actorId: ctx.session.user.id,
      xml: body.xml,
    });
    return NextResponse.json(summary, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "import failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** GET /api/accounting/reconciliation — unmatched lines + suggestions. */
export async function handleListUnmatched(): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  const [lines, units] = await Promise.all([
    listUnmatchedBankLines(ctx.root.id),
    listPayableUnits(ctx.root.id),
  ]);
  return NextResponse.json({ lines, units });
}

/** POST /api/accounting/reconciliation/[paymentId] — { unitEntityId }. */
export async function handleConfirmMatch(
  req: NextRequest,
  paymentId: string
): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: { unitEntityId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.unitEntityId !== "string") {
    return NextResponse.json({ error: "invalid unit" }, { status: 400 });
  }

  try {
    await confirmBankLineMatch({
      entityId: ctx.root.id,
      country: ctx.root.country,
      paymentId,
      unitEntityId: body.unitEntityId,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "match failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

/**
 * DELETE /api/accounting/reconciliation/[paymentId] — dismiss an unmatched
 * bank line (not a member payment). Optional body { reason }.
 */
export async function handleDismissMatch(
  req: NextRequest,
  paymentId: string
): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let reason: string | null = null;
  try {
    const body = (await req.json()) as { reason?: string };
    if (typeof body.reason === "string") reason = body.reason;
  } catch {
    // Body is optional — a bare dismiss carries the default reason.
  }

  try {
    await dismissBankLine({
      entityId: ctx.root.id,
      paymentId,
      actorId: ctx.session.user.id,
      reason,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "dismiss failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
