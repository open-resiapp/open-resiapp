import { NextRequest, NextResponse } from "next/server";

import { sessionAccountingCtx } from "@modules/accounting/src/lib/accounting-ctx";
import {
  canWriteReadingForUnit,
  createReading,
  listReadingsForViewer,
  voidReading,
} from "@modules/accounting/src/lib/meters";
import {
  isReadingError,
  readingErrorStatus,
} from "@modules/accounting/src/lib/reading-rounds-format";
import { validateMeterReadingInput } from "@modules/accounting/src/lib/input-validators";
import { inputErrorResponse } from "@modules/accounting/src/lib/input-errors.server";
import { listAccessibleUnits } from "@modules/accounting/src/lib/karta-bytu";

// Meter readings API — owners for their own units, board roles for all
// (same scoping as karta bytu; unauthorized unit = 403). Writes need an
// owner membership or a board WRITER role. Errors are stable codes
// (`{ error: code }`), mapped to ReadingRounds.errors.<code> by the UI —
// never the raw lib message (BYT-20261118-006).

function libErrorResponse(err: unknown): NextResponse {
  if (isReadingError(err)) {
    return NextResponse.json(
      { error: err.code },
      { status: readingErrorStatus(err.code) }
    );
  }
  console.error("[accounting/meters] failed:", err);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}

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
  // Board readers: every reading; owners: only readings of their own
  // ownership period (BYT-20261118-012). null = no access to the unit.
  const readings = await listReadingsForViewer({
    userId: principal.userId,
    userRole: principal.role,
    entityId: root.id,
    unitEntityId: unitId,
  });
  if (!readings) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
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

  const allowed = await canWriteReadingForUnit(
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
    return libErrorResponse(err);
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
    return libErrorResponse(err);
  }
}
