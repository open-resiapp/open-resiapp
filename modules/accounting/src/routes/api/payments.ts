import { NextRequest, NextResponse } from "next/server";

import { requireReader, requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  createManualPayment,
  listPayments,
  listPayableUnits,
  voidManualPayment,
} from "@modules/accounting/src/lib/payments";

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

  let body: {
    unitEntityId?: string;
    amountCents?: number;
    receivedAt?: string;
    note?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.unitEntityId !== "string") {
    return NextResponse.json({ error: "invalid unit" }, { status: 400 });
  }
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return NextResponse.json({ error: "invalid amount" }, { status: 400 });
  }
  const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
  if (Number.isNaN(receivedAt.getTime())) {
    return NextResponse.json({ error: "invalid receivedAt" }, { status: 400 });
  }
  if (receivedAt.getTime() > Date.now() + 24 * 3600 * 1000) {
    return NextResponse.json(
      { error: "receivedAt cannot be in the future" },
      { status: 400 }
    );
  }

  try {
    const result = await createManualPayment({
      entityId: ctx.root.id,
      country: ctx.root.country,
      createdById: ctx.session.user.id,
      unitEntityId: body.unitEntityId,
      amountCents,
      receivedAt,
      note: typeof body.note === "string" ? body.note : undefined,
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
