import { NextRequest, NextResponse } from "next/server";

import { requireReader, requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  createManualPayment,
  listPayments,
  listPayableUnits,
  voidManualPayment,
} from "@modules/accounting/src/lib/payments";
import { validateManualPaymentInput } from "@modules/accounting/src/lib/input-validators";

// Manual payment API — list (treasurer/chairman/admin), create + void
// (treasurer/admin). Void requires a reason (audit-logged reversal).

export async function handleList(): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  const [rows, units] = await Promise.all([
    listPayments(ctx.root.id),
    listPayableUnits(ctx.root.id),
  ]);
  return NextResponse.json({ payments: rows, units });
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
  const parsed = validateManualPaymentInput(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: 400 });
  }
  const input = parsed.value;

  try {
    const result = await createManualPayment({
      entityId: ctx.root.id,
      country: ctx.root.country,
      createdById: ctx.session.user.id,
      unitEntityId: input.unitEntityId,
      amountCents: input.amountCents,
      receivedAt: input.receivedAt,
      method: input.method,
      note: input.note,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function handleVoid(
  req: NextRequest,
  paymentId: string
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
    await voidManualPayment({
      entityId: ctx.root.id,
      country: ctx.root.country,
      paymentId,
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
