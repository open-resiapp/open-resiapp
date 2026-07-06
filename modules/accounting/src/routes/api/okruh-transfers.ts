import { NextRequest, NextResponse } from "next/server";

import { requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  createOkruhTransfer,
  listOkruhTransfers,
  setTransferReturnDue,
  markTransferReturned,
} from "@modules/accounting/src/lib/okruh-transfers";

// Inter-okruh transfer log API (AC 417, metadata only) — write-privileged
// (treasurer / admin). No journal posting: see the lib + spec Notes; the
// ledger side stays BLOCKED under AC 416/417.

const OKRUHY = new Set(["fpuo", "svc", "mgmt"]);

export async function handleList(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  const openOnly = new URL(req.url).searchParams.get("open") === "1";
  const items = await listOkruhTransfers(ctx.root.id, openOnly);
  return NextResponse.json({ items });
}

export async function handleCreate(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const fromOkruh = String(body.fromOkruh);
  const toOkruh = String(body.toOkruh);
  if (!OKRUHY.has(fromOkruh) || !OKRUHY.has(toOkruh)) {
    return NextResponse.json({ error: "invalid okruh" }, { status: 400 });
  }
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "invalid amount" }, { status: 400 });
  }
  const transferDate = new Date(String(body.transferDate ?? ""));
  if (Number.isNaN(transferDate.getTime())) {
    return NextResponse.json({ error: "invalid transferDate" }, { status: 400 });
  }
  const returnDueFlag = body.returnDueFlag === true;

  try {
    const result = await createOkruhTransfer({
      entityId: ctx.root.id,
      actorId: ctx.session.user.id,
      fromOkruh: fromOkruh as "fpuo" | "svc" | "mgmt",
      toOkruh: toOkruh as "fpuo" | "svc" | "mgmt",
      amountCents,
      transferDate,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
      returnDueFlag,
      returnDueNote:
        typeof body.returnDueNote === "string" && body.returnDueNote.trim()
          ? body.returnDueNote.trim()
          : null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function handleSetReturnDue(
  req: NextRequest,
  id: string
): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    await setTransferReturnDue({
      entityId: ctx.root.id,
      id,
      actorId: ctx.session.user.id,
      returnDueFlag: body.returnDueFlag === true,
      returnDueNote:
        typeof body.returnDueNote === "string" && body.returnDueNote.trim()
          ? body.returnDueNote.trim()
          : null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function handleMarkReturned(
  _req: NextRequest,
  id: string
): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  try {
    await markTransferReturned({
      entityId: ctx.root.id,
      id,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
