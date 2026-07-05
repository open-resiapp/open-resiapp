import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { getCommunityRoot } from "@/lib/legacy-compat";
import {
  canEnterReading,
  createReading,
  listReadingsForUnit,
  voidReading,
  METER_TYPES,
  type MeterType,
} from "@modules/accounting/src/lib/meters";
import { listAccessibleUnits } from "@modules/accounting/src/lib/karta-bytu";

// Meter readings API — owners for their own units, board roles for all
// (same scoping as karta bytu; unauthorized unit = 403).

async function baseCtx() {
  const session = await auth();
  if (!session) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    } as const;
  }
  const root = await getCommunityRoot();
  if (!root) {
    return {
      error: NextResponse.json({ error: "no community" }, { status: 404 }),
    } as const;
  }
  return { session, root, error: undefined } as const;
}

/** GET /api/accounting/meters — accessible units; ?unitId= adds readings. */
export async function handleGet(req: NextRequest): Promise<NextResponse> {
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  const { session, root } = ctx;

  const units = await listAccessibleUnits(
    session.user.id,
    session.user.role as string,
    root.id
  );

  const unitId = req.nextUrl.searchParams.get("unitId");
  if (!unitId) {
    return NextResponse.json({ units, readings: null });
  }
  const allowed = await canEnterReading(
    session.user.id,
    session.user.role as string,
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
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  const { session, root } = ctx;

  let body: {
    unitEntityId?: string;
    meterType?: string;
    readingDate?: string;
    valueMilli?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.unitEntityId !== "string") {
    return NextResponse.json({ error: "invalid unit" }, { status: 400 });
  }
  if (!METER_TYPES.includes(body.meterType as MeterType)) {
    return NextResponse.json({ error: "invalid meter type" }, { status: 400 });
  }
  const valueMilli = Number(body.valueMilli);
  if (!Number.isInteger(valueMilli) || valueMilli < 0) {
    return NextResponse.json({ error: "invalid value" }, { status: 400 });
  }
  const readingDate = new Date(String(body.readingDate ?? ""));
  if (Number.isNaN(readingDate.getTime())) {
    return NextResponse.json({ error: "invalid date" }, { status: 400 });
  }

  const allowed = await canEnterReading(
    session.user.id,
    session.user.role as string,
    root.id,
    body.unitEntityId
  );
  if (!allowed) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const result = await createReading({
      entityId: root.id,
      unitEntityId: body.unitEntityId,
      meterType: body.meterType as MeterType,
      readingDate,
      valueMilli,
      actorId: session.user.id,
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
  const ctx = await baseCtx();
  if (ctx.error) return ctx.error;
  const { session, root } = ctx;

  try {
    await voidReading({
      entityId: root.id,
      readingId,
      actorId: session.user.id,
      actorRole: session.user.role as string,
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
