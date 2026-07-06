import { NextRequest, NextResponse } from "next/server";

import { requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  createInboxItem,
  listInbox,
  dismissInboxItem,
  postInboxItemAsExpense,
} from "@modules/accounting/src/lib/expense-inbox";

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

  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "invalid amount" }, { status: 400 });
  }
  // Mirror the expense-create doklad requirements (AC 440) so posting from
  // the inbox can't bypass them.
  const reqStr = (v: unknown) => typeof v === "string" && v.trim() !== "";
  for (const [field, value] of [
    ["supplierName", body.supplierName],
    ["supplierIco", body.supplierIco],
    ["supplierDic", body.supplierDic],
    ["supplierIban", body.supplierIban],
    ["invoiceNo", body.invoiceNo],
  ] as Array<[string, unknown]>) {
    if (!reqStr(value)) {
      return NextResponse.json({ error: `${field} required` }, { status: 400 });
    }
  }
  const invoiceDate = new Date(String(body.invoiceDate ?? ""));
  if (Number.isNaN(invoiceDate.getTime())) {
    return NextResponse.json({ error: "invalid invoiceDate" }, { status: 400 });
  }
  const okruh = body.okruh === "fpuo" ? "fpuo" : body.okruh === "svc" ? "svc" : null;
  if (!okruh) {
    return NextResponse.json({ error: "invalid okruh" }, { status: 400 });
  }
  const optInt = (v: unknown) =>
    v === null || v === undefined || v === "" ? null : Number(v);
  const amountNettoCents = optInt(body.amountNettoCents);
  const dphCents = optInt(body.dphCents);
  const dphRateBp = optInt(body.dphRateBp);
  for (const n of [amountNettoCents, dphCents, dphRateBp]) {
    if (n !== null && !Number.isInteger(n)) {
      return NextResponse.json({ error: "invalid amounts" }, { status: 400 });
    }
  }
  if (amountNettoCents === null || dphCents === null) {
    return NextResponse.json({ error: "netto + DPH required" }, { status: 400 });
  }
  if (amountNettoCents + dphCents !== amountCents) {
    return NextResponse.json(
      { error: "netto + DPH must equal brutto" },
      { status: 400 }
    );
  }

  try {
    const result = await postInboxItemAsExpense({
      entityId: ctx.root.id,
      country: ctx.root.country,
      id,
      actorId: ctx.session.user.id,
      supplierName: String(body.supplierName).trim(),
      supplierIco: String(body.supplierIco).trim(),
      supplierDic: String(body.supplierDic).trim(),
      supplierIban: String(body.supplierIban).trim(),
      invoiceNo: String(body.invoiceNo).trim(),
      invoiceDate,
      dueDate:
        typeof body.dueDate === "string" && body.dueDate
          ? new Date(body.dueDate)
          : null,
      serviceCategoryId:
        typeof body.serviceCategoryId === "string" && body.serviceCategoryId
          ? body.serviceCategoryId
          : null,
      okruh,
      amountCents,
      amountNettoCents,
      dphCents,
      dphRateBp,
      nextInspectionDueAt:
        typeof body.nextInspectionDueAt === "string" && body.nextInspectionDueAt
          ? new Date(body.nextInspectionDueAt)
          : null,
      isRecurring: body.isRecurring === true,
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
