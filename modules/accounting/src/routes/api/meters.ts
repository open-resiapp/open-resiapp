import { NextRequest, NextResponse } from "next/server";

import { sessionAccountingCtx } from "@modules/accounting/src/lib/accounting-ctx";
import {
  canEnterReading,
  createReading,
  listReadingsForUnit,
  voidReading,
} from "@modules/accounting/src/lib/meters";
import { validateMeterReadingInput } from "@modules/accounting/src/lib/input-validators";
import { inputErrorResponse } from "@modules/accounting/src/lib/input-errors.server";
import { listAccessibleUnits } from "@modules/accounting/src/lib/karta-bytu";

// Meter readings API — owners for their own units, board roles for all
// (same scoping as karta bytu; unauthorized unit = 403).

/** GET /api/accounting/meters — accessible units; ?unitId= adds readings. */
export async function handleGet(req: NextRequest): Promise<NextResponse> {
  const ctx = await sessionAccountingCtx();
  if (ctx.error) return ctx.error;
  const { principal, root } = ctx;

  const units = await listAccessibleUnits(
    principal.userId,
    principal.role,
    root.id
  );

  const unitId = req.nextUrl.searchParams.get("unitId");
  if (!unitId) {
    return NextResponse.json({ units, readings: null });
  }
  const allowed = await canEnterReading(
    principal.userId,
    principal.role,
    root.id,
    unitId
  );
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const readings = await listReadingsForUnit(root.id, unitId);
  return NextResponse.json({ units, readings });
}

/** POST /api/accounting/meters — create a reading. */
export async function handlePost(req: NextRequest): Promise<NextResponse> {
  const ctx = await sessionAccountingCtx();
  if (ctx.error) return ctx.error;
  const { principal, root } = ctx;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const parsed = validateMeterReadingInput(body);
  if (!parsed.ok) {
    return inputErrorResponse(req, parsed);
  }
  const input = parsed.value;

  const allowed = await canEnterReading(
    principal.userId,
    principal.role,
    root.id,
    input.unitEntityId
  );
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const result = await createReading({
      entityId: root.id,
      unitEntityId: input.unitEntityId,
      meterType: input.meterType,
      readingDate: input.readingDate,
      valueMilli: input.valueMilli,
      actorId: principal.userId,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** POST /api/accounting/meters/[id]/void */
export async function handleVoid(
  _req: NextRequest,
  readingId: string
): Promise<NextResponse> {
  const ctx = await sessionAccountingCtx();
  if (ctx.error) return ctx.error;
  const { principal, root } = ctx;

  try {
    await voidReading({
      entityId: root.id,
      readingId,
      actorId: principal.userId,
      actorRole: principal.role,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "void failed";
    const status = message.includes("not found")
      ? 404
      : message.includes("forbidden")
        ? 403
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
