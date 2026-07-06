import { NextRequest, NextResponse } from "next/server";

import { requireReader, requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  createExpense,
  listExpenses,
  markExpensePaid,
  voidExpense,
} from "@modules/accounting/src/lib/expenses";
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
  if (typeof body.supplierName !== "string" || typeof body.invoiceNo !== "string") {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
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

  try {
    const result = await createExpense({
      entityId: ctx.root.id,
      country: ctx.root.country,
      createdById: ctx.session.user.id,
      supplierName: body.supplierName,
      supplierIco: typeof body.supplierIco === "string" ? body.supplierIco : null,
      supplierDic: typeof body.supplierDic === "string" ? body.supplierDic : null,
      supplierIban: typeof body.supplierIban === "string" ? body.supplierIban : null,
      invoiceNo: body.invoiceNo,
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
      authorisationId:
        typeof body.authorisationId === "string" && body.authorisationId
          ? body.authorisationId
          : null,
    });
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
