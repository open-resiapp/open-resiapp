import { NextRequest, NextResponse } from "next/server";

import { requireReader, requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  getAccountingSettings,
  updateAccountingSettings,
} from "@modules/accounting/src/lib/settings";

// Accounting settings API — allocation strategy + priority order + bank
// IBAN. Append-only server-side; every change is audited.

export async function handleGet(): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  const settings = await getAccountingSettings(ctx.root.id, ctx.root.country);
  return NextResponse.json(settings);
}

export async function handlePost(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: {
    allocationStrategy?: string;
    priorityOrder?: unknown;
    bankIban?: string | null;
    dueDay?: number | string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (
    body.allocationStrategy !== "proportional" &&
    body.allocationStrategy !== "priority_ordered"
  ) {
    return NextResponse.json({ error: "invalid strategy" }, { status: 400 });
  }
  const priorityOrder = Array.isArray(body.priorityOrder)
    ? body.priorityOrder.filter((s): s is string => typeof s === "string")
    : [];
  const bankIban =
    typeof body.bankIban === "string" && body.bankIban.trim() !== ""
      ? body.bankIban
      : null;
  const dueDay =
    body.dueDay === null || body.dueDay === undefined || body.dueDay === ""
      ? null
      : Number(body.dueDay);
  if (dueDay !== null && !Number.isInteger(dueDay)) {
    return NextResponse.json({ error: "invalid dueDay" }, { status: 400 });
  }

  try {
    await updateAccountingSettings({
      entityId: ctx.root.id,
      country: ctx.root.country,
      actorId: ctx.session.user.id,
      allocationStrategy: body.allocationStrategy,
      priorityOrder,
      bankIban,
      dueDay,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
