import { NextRequest, NextResponse } from "next/server";

import { requireReader, requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  createExpense,
  listExpenses,
  markExpensePaid,
  voidExpense,
} from "@modules/accounting/src/lib/expenses";
import { uploadAttachment } from "@modules/accounting/src/lib/attachments";
import { listServiceCategories } from "@modules/accounting/src/lib/fee-schedules";

// Expense ledger API — list: treasurer/chairman/admin; mutations:
// treasurer/admin only.

export async function handleList(): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  const [rows, categories] = await Promise.all([
    listExpenses(ctx.root.id),
    listServiceCategories(ctx.root.country),
  ]);
  return NextResponse.json({ expenses: rows, categories });
}

export async function handleCreate(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  // A supplier invoice is an účtovný doklad — the scan is a required part of
  // it (AC 440), so create is multipart: `payload` (the JSON fields) + `file`
  // (the mandatory scan). The file is read + validated BEFORE the expense is
  // created; if the attachment write still fails after creation, the expense
  // is voided so no attachment-less doklad ever persists.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "attachment required" }, { status: 400 });
  }
  // Read the scan bytes BEFORE creating the expense — a corrupt/unreadable
  // stream must fail here, while nothing is posted, not after the ledger entry.
  let fileBuffer: Buffer;
  try {
    fileBuffer = Buffer.from(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "attachment unreadable" }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(String(form.get("payload") ?? ""));
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "invalid amount" }, { status: 400 });
  }
  // A supplier invoice (účtovný doklad) must carry the full identifying set
  // (AC 440): supplier name, IČO, DIČ/IČ DPH, IBAN and invoice number, all
  // non-empty. Enforced at the human-entry surface only — the lib stays
  // booking-integrity so internal/programmatic creates aren't blocked.
  // Mirrors the client `formValid` so a direct API POST can't bypass it.
  const reqStr = (v: unknown) => typeof v === "string" && v.trim() !== "";
  const requiredStrings: Array<[string, unknown]> = [
    ["supplierName", body.supplierName],
    ["supplierIco", body.supplierIco],
    ["supplierDic", body.supplierDic],
    ["supplierIban", body.supplierIban],
    ["invoiceNo", body.invoiceNo],
  ];
  for (const [field, value] of requiredStrings) {
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
  // netto + DPH are a required part of the doklad (AC 440) and must tie out to
  // the brutto — otherwise the tax breakdown is meaningless. Mirrors the
  // client's formValid check so a direct API POST can't bypass it.
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
    const result = await createExpense({
      entityId: ctx.root.id,
      country: ctx.root.country,
      createdById: ctx.session.user.id,
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
      dphRateBp,
      dphCents,
      nextInspectionDueAt:
        typeof body.nextInspectionDueAt === "string" && body.nextInspectionDueAt
          ? new Date(body.nextInspectionDueAt)
          : null,
      isRecurring: body.isRecurring === true,
      authorisationId:
        typeof body.authorisationId === "string" && body.authorisationId
          ? body.authorisationId
          : null,
    });

    // Attach the mandatory scan. If it fails, void the just-created (unpaid)
    // expense so we never leave an attachment-less doklad on the ledger.
    try {
      await uploadAttachment({
        entityId: ctx.root.id,
        expenseId: result.expenseId,
        role: "original",
        fileName: file.name || "invoice",
        contentType: file.type || "application/octet-stream",
        body: fileBuffer,
        actorId: ctx.session.user.id,
      });
    } catch (attachErr) {
      const message =
        attachErr instanceof Error ? attachErr.message : "attachment failed";
      try {
        await voidExpense({
          entityId: ctx.root.id,
          country: ctx.root.country,
          expenseId: result.expenseId,
          actorId: ctx.session.user.id,
          reason: "attachment upload failed at create",
        });
      } catch (voidErr) {
        // Compensation itself failed — an attachment-less doklad is now on the
        // ledger and needs manual void. Surface it loudly (500) with the
        // expense id rather than reporting a clean 400.
        console.error(
          `accounting: attachment failed AND compensating void failed for expense ${result.expenseId}`,
          attachErr,
          voidErr
        );
        return NextResponse.json(
          { error: "attachment failed; manual cleanup required", expenseId: result.expenseId },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function handlePay(
  req: NextRequest,
  expenseId: string
): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  let body: { method?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const method = body.method === "cash" ? "cash" : "bank";
  try {
    await markExpensePaid({
      entityId: ctx.root.id,
      country: ctx.root.country,
      expenseId,
      actorId: ctx.session.user.id,
      method,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "pay failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function handleVoid(
  req: NextRequest,
  expenseId: string
): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  let body: { reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json({ error: "reason required" }, { status: 400 });
  }
  try {
    await voidExpense({
      entityId: ctx.root.id,
      country: ctx.root.country,
      expenseId,
      actorId: ctx.session.user.id,
      reason,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "void failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
