import { NextRequest, NextResponse } from "next/server";

import { requireReader, requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  assignUnitVs,
  listUnitVs,
} from "@modules/accounting/src/lib/fee-schedules";

// Unit VS assignment API — VS is the primary payment-matching key
// (docs/domain/accounting.md edge case 9), assigned per unit, unique
// within the dom.

export async function handleGet(): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  const units = await listUnitVs(ctx.root.id);
  return NextResponse.json({ units });
}

export async function handlePost(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: { assignments?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!Array.isArray(body.assignments)) {
    return NextResponse.json({ error: "invalid assignments" }, { status: 400 });
  }
  const assignments: { unitEntityId: string; vs: string }[] = [];
  for (const item of body.assignments) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).unitEntityId !== "string" ||
      typeof (item as Record<string, unknown>).vs !== "string"
    ) {
      return NextResponse.json(
        { error: "invalid assignments" },
        { status: 400 }
      );
    }
    assignments.push({
      unitEntityId: (item as { unitEntityId: string }).unitEntityId,
      vs: (item as { vs: string }).vs.trim(),
    });
  }

  try {
    await assignUnitVs({
      entityId: ctx.root.id,
      actorId: ctx.session.user.id,
      assignments,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "assign failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
