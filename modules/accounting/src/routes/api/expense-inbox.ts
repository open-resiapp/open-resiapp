import { NextRequest, NextResponse } from "next/server";

import { requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  createInboxItem,
  listInbox,
  dismissInboxItem,
  postInboxItemAsExpense,
} from "@modules/accounting/src/lib/expense-inbox";
import { validateExpenseInput } from "@modules/accounting/src/lib/input-validators";
import { inputErrorResponse } from "@modules/accounting/src/lib/input-errors.server";

// Expense collector inbox API (AC 478/479) — write-privileged (treasurer /
// admin) only. Upload a PDF/image invoice → OCR-parked row → post as a real
// expense in ≤2 clicks. The email-inbound half of AC 478 stays BLOCKED.

const MAX_BYTES = 15 * 1024 * 1024;

export async function handleUpload(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file over 15 MB" }, { status: 413 });
  }
  let buffer: Buffer;
  try {
    buffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "file unreadable" }, { status: 400 });
  }

  try {
    const result = await createInboxItem({
      entityId: ctx.root.id,
      actorId: ctx.session.user.id,
      fileName: file.name || "invoice.pdf",
      contentType: file.type || "application/octet-stream",
      body: buffer,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function handleList(): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  const rows = await listInbox(ctx.root.id, "pending");
  return NextResponse.json({ items: rows });
}

export async function handleDismiss(
  _req: NextRequest,
  id: string
): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  try {
    await dismissInboxItem({
      entityId: ctx.root.id,
      id,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "dismiss failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function handlePost(
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

  // Same doklad requirements (AC 440) as expense create — shared validator.
  const parsed = validateExpenseInput(body);
  if (!parsed.ok) {
    return inputErrorResponse(req, parsed);
  }
  // Inbox posting never links an expense authorisation (historical shape).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { authorisationId: _ignored, ...input } = parsed.value;

  try {
    const result = await postInboxItemAsExpense({
      entityId: ctx.root.id,
      country: ctx.root.country,
      id,
      actorId: ctx.session.user.id,
      ...input,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "post failed";
    const status =
      message.includes("not found") || message.includes("already handled")
        ? 409
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
