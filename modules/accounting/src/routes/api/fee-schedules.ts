import { NextRequest, NextResponse } from "next/server";

import { requireReader, requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  createFeeSchedule,
  discardFeeScheduleDraft,
  getFeeSchedule,
  listFeeSchedules,
  listServiceCategories,
  updateFeeScheduleDraft,
  type ServiceRowInput,
} from "@modules/accounting/src/lib/fee-schedules";

import { ALLOCATION_KEYS } from "@modules/accounting/src/lib/constants";

// Predpis (fee schedule) API — draft CRUD. Reads are treasurer/chairman/
// admin; writes treasurer/admin only.

function parseServiceRows(raw: unknown): ServiceRowInput[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: ServiceRowInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const r = item as Record<string, unknown>;
    const allocationKey = r.allocationKey as ServiceRowInput["allocationKey"];
    if (!ALLOCATION_KEYS.includes(allocationKey)) return null;
    if (typeof r.serviceCategoryId !== "string") return null;
    const rateCents = r.rateCents === null || r.rateCents === undefined ? null : Number(r.rateCents);
    const fixedAmountCents =
      r.fixedAmountCents === null || r.fixedAmountCents === undefined
        ? null
        : Number(r.fixedAmountCents);
    if (rateCents !== null && !Number.isInteger(rateCents)) return null;
    if (fixedAmountCents !== null && !Number.isInteger(fixedAmountCents)) return null;
    rows.push({
      serviceCategoryId: r.serviceCategoryId,
      allocationKey,
      rateCents,
      fixedAmountCents,
    });
  }
  return rows;
}

/** GET /api/accounting/fee-schedules — list. */
export async function handleList(): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  const schedules = await listFeeSchedules(ctx.root.id);
  return NextResponse.json({ schedules });
}

/** POST /api/accounting/fee-schedules — create a draft for a year. */
export async function handleCreate(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: { year?: number; effectiveFrom?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }
  const effectiveFrom = body.effectiveFrom
    ? new Date(body.effectiveFrom)
    : new Date(Date.UTC(year, 0, 1));
  if (Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "invalid effectiveFrom" }, { status: 400 });
  }

  try {
    const result = await createFeeSchedule({
      entityId: ctx.root.id,
      year,
      effectiveFrom,
      createdById: ctx.session.user.id,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "create failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

/** GET /api/accounting/fee-schedules/[id] */
export async function handleGetOne(
  _req: NextRequest,
  scheduleId: string
): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  const [schedule, categories] = await Promise.all([
    getFeeSchedule(ctx.root.id, scheduleId),
    listServiceCategories(ctx.root.country),
  ]);
  if (!schedule) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ schedule, categories });
}

/** PATCH /api/accounting/fee-schedules/[id] — update draft rows. */
export async function handleUpdate(
  req: NextRequest,
  scheduleId: string
): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: { effectiveFrom?: string; services?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const services = parseServiceRows(body.services);
  if (services === null) {
    return NextResponse.json({ error: "invalid services" }, { status: 400 });
  }
  let effectiveFrom: Date | undefined;
  if (body.effectiveFrom !== undefined && body.effectiveFrom !== null) {
    if (typeof body.effectiveFrom !== "string") {
      return NextResponse.json(
        { error: "invalid effectiveFrom" },
        { status: 400 }
      );
    }
    effectiveFrom = new Date(body.effectiveFrom);
    if (Number.isNaN(effectiveFrom.getTime())) {
      return NextResponse.json(
        { error: "invalid effectiveFrom" },
        { status: 400 }
      );
    }
  }

  try {
    await updateFeeScheduleDraft({
      entityId: ctx.root.id,
      country: ctx.root.country,
      scheduleId,
      actorId: ctx.session.user.id,
      effectiveFrom,
      services,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "update failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

/** DELETE /api/accounting/fee-schedules/[id] — discard a draft. */
export async function handleDiscard(
  _req: NextRequest,
  scheduleId: string
): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  try {
    await discardFeeScheduleDraft({
      entityId: ctx.root.id,
      scheduleId,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "discard failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
