import { NextRequest, NextResponse } from "next/server";

import { getStorage } from "@/lib/storage";
import { sessionAccountingCtx } from "@modules/accounting/src/lib/accounting-ctx";
import { canReadAccounting, canWriteAccounting } from "@modules/accounting/src/lib/authz";
import { isUnitOwner } from "@modules/accounting/src/lib/meters";
import { listOwnedUnits } from "@modules/accounting/src/lib/owner-payments";
import {
  PHOTO_MAX_BYTES,
  applyPersonsToUnitPersons,
  createBuildingReading,
  getBoardRoundData,
  resolveReadingPhoto,
  saveRound,
  setRoundClosedForOwners,
  setUnitsResolved,
  storeReadingPhoto,
  submitPersons,
  submitRoundReading,
  validateRoundInput,
  voidBuildingReading,
  voidPersonsSubmission,
  withdrawRoundReading,
} from "@modules/accounting/src/lib/reading-rounds";
import {
  buildRoundCsv,
  buildRoundXlsx,
  type ExportPart,
} from "@modules/accounting/src/lib/reading-rounds-export";
import {
  ROUND_METER_TYPES,
  ReadingError,
  isReadingError,
  parseMilli,
  readingErrorStatus,
  type MeterType,
  type PersonRange,
} from "@modules/accounting/src/lib/reading-rounds-format";

// Reading rounds API (BYT-20261118-006), dispatched from the catch-all
// src/app/api/accounting/readings/[[...path]]/route.ts.
//
// Access: board WRITERS (treasurer / admin) — rounds, resolve, building
// meters, apply-to-predpis, entry for any unit. Board READERS (+ chairman)
// — table + export only; every write is 403. Owners — their own units'
// persons / readings, through the owner-window rules in the lib. Errors are
// `{ error: <ReadingErrorCode> }`, mapped to ReadingRounds.errors.<code>.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code: ReadingError["code"]): NextResponse {
  return NextResponse.json({ error: code }, { status: readingErrorStatus(code) });
}

function errorResponse(err: unknown): NextResponse {
  if (isReadingError(err)) return fail(err.code);
  console.error("[accounting/readings] failed:", err);
  return NextResponse.json({ error: "internal" }, { status: 500 });
}

async function ctxWithRoles() {
  const ctx = await sessionAccountingCtx();
  if (ctx.error) return { error: ctx.error } as const;
  const { principal, root } = ctx;
  const [isWriter, isReader] = await Promise.all([
    canWriteAccounting(principal.userId, principal.role, root.id),
    canReadAccounting(principal.userId, principal.role, root.id),
  ]);
  return { principal, root, isWriter, isReader } as const;
}

type Ctx = Exclude<Awaited<ReturnType<typeof ctxWithRoles>>, { error: NextResponse }>;

/** Writer for any unit, else an active owner of THIS unit. */
async function canWriteUnit(ctx: Ctx, unitId: unknown): Promise<boolean> {
  if (typeof unitId !== "string" || !UUID_RE.test(unitId)) return false;
  if (ctx.isWriter) return true;
  return isUnitOwner(ctx.principal.userId, unitId);
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function dateOnly(v: unknown): Date {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(NaN);
  return new Date(`${s}T00:00:00Z`);
}

async function photoFromForm(
  form: FormData,
  entityId: string
): Promise<string | null> {
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > PHOTO_MAX_BYTES) throw new ReadingError("photo_too_large");
  return storeReadingPhoto(entityId, {
    body: Buffer.from(await file.arrayBuffer()),
    contentType: file.type,
  });
}

// ── GET ────────────────────────────────────────────────

export async function handleGet(req: NextRequest, path: string[]): Promise<NextResponse> {
  const ctx = await ctxWithRoles();
  if ("error" in ctx) return ctx.error!;
  const [head, a, b] = path;

  try {
    if (head === "photo" && (a === "unit" || a === "building") && isUuid(b)) {
      const resolved = await resolveReadingPhoto({
        entityId: ctx.root.id,
        kind: a,
        id: b,
        userId: ctx.principal.userId,
        userRole: ctx.principal.role,
      });
      if (!resolved) return fail("forbidden");
      const obj = await getStorage().get(resolved.storageKey);
      if (!obj) return fail("not_found");
      return new NextResponse(new Uint8Array(obj.body), {
        status: 200,
        headers: {
          "Content-Type": obj.contentType || "application/octet-stream",
          "Content-Disposition": "inline",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (!ctx.isReader) return fail("forbidden");
    const year = Number(req.nextUrl.searchParams.get("year") ?? new Date().getUTCFullYear());
    if (!Number.isInteger(year) || year < 2000 || year > 2100) return fail("round_invalid");

    if (head === "board") {
      const data = await getBoardRoundData(ctx.root.id, year);
      return NextResponse.json({ ...data, canWrite: ctx.isWriter });
    }

    if (head === "export") {
      const format = req.nextUrl.searchParams.get("format");
      if (format === "xlsx") {
        const buf = await buildRoundXlsx(ctx.root.id, year);
        return new NextResponse(new Uint8Array(buf), {
          status: 200,
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="odpocty-${year}.xlsx"`,
            "Cache-Control": "private, no-store",
          },
        });
      }
      const partRaw = req.nextUrl.searchParams.get("part");
      const part: ExportPart =
        partRaw === "meters" || partRaw === "building" ? partRaw : "persons";
      const csv = await buildRoundCsv(ctx.root.id, year, part);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="odpocty-${year}-${part}.csv"`,
          "Cache-Control": "private, no-store",
        },
      });
    }
  } catch (err) {
    return errorResponse(err);
  }
  return fail("not_found");
}

// ── POST ───────────────────────────────────────────────

export async function handlePost(req: NextRequest, path: string[]): Promise<NextResponse> {
  const ctx = await ctxWithRoles();
  if ("error" in ctx) return ctx.error!;
  const { principal, root } = ctx;
  const [head, id, action] = path;
  const actor = { entityId: root.id, actorId: principal.userId, isWriter: ctx.isWriter };

  try {
    // ── Owner + board: persons ──
    if (head === "persons" && !id) {
      const body = await readJson(req);
      if (!body) return fail("round_invalid");
      if (!(await canWriteUnit(ctx, body.unitEntityId))) return fail("forbidden");
      if (!isUuid(body.roundId)) return fail("not_found");
      const ranges = Array.isArray(body.ranges)
        ? (body.ranges as Record<string, unknown>[]).map((r) => ({
            from: Number(r?.from),
            to: Number(r?.to),
            persons: Number(r?.persons),
          }))
        : [];
      const result = await submitPersons({
        ...actor,
        roundId: body.roundId,
        unitEntityId: body.unitEntityId as string,
        ranges: ranges as PersonRange[],
        replaceSubmissionId: isUuid(body.replaceSubmissionId) ? body.replaceSubmissionId : null,
      });
      return NextResponse.json(result, { status: 201 });
    }
    if (head === "persons" && isUuid(id) && action === "void") {
      if (!ctx.isWriter && !(await hasAnyOwnership(ctx))) return fail("forbidden");
      await voidPersonsSubmission({ ...actor, submissionId: id });
      return NextResponse.json({ ok: true });
    }

    // ── Owner + board: unit meter reading (multipart, optional photo) ──
    if (head === "meter" && !id) {
      const form = await req.formData().catch(() => null);
      if (!form) return fail("value_invalid");
      const unitEntityId = form.get("unitEntityId");
      if (!(await canWriteUnit(ctx, unitEntityId))) return fail("forbidden");
      const roundId = form.get("roundId");
      if (!isUuid(roundId)) return fail("not_found");
      const meterType = String(form.get("meterType") ?? "") as MeterType;
      if (!ROUND_METER_TYPES.includes(meterType)) return fail("meter_type_not_collected");
      const rawValue = String(form.get("value") ?? "").trim();
      if (rawValue.startsWith("-")) return fail("value_negative");
      const valueMilli = parseMilli(rawValue);
      if (valueMilli === null) return fail("value_invalid");
      const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
      const replace = form.get("replaceReadingId");
      const photoStorageKey = await photoFromForm(form, root.id);
      const result = await submitRoundReading({
        ...actor,
        roundId,
        unitEntityId: unitEntityId as string,
        meterType,
        readingDate: dateOnly(form.get("readingDate")),
        valueMilli,
        note,
        photoStorageKey,
        replaceReadingId: isUuid(replace) ? replace : null,
      });
      return NextResponse.json(result, { status: 201 });
    }
    if (head === "meter" && isUuid(id) && action === "void") {
      if (!ctx.isWriter && !(await hasAnyOwnership(ctx))) return fail("forbidden");
      await withdrawRoundReading({ ...actor, readingId: id });
      return NextResponse.json({ ok: true });
    }

    // ── Board writers only below ──
    if (!ctx.isWriter) return fail("forbidden");

    if (head === "round" && !id) {
      const body = await readJson(req);
      if (!body) return fail("round_invalid");
      const data = validateRoundInput(body);
      const result = await saveRound({
        entityId: root.id,
        actorId: principal.userId,
        roundId: isUuid(body.roundId) ? body.roundId : null,
        data,
      });
      return NextResponse.json(result, { status: 201 });
    }
    if (head === "round" && isUuid(id) && action === "close") {
      const body = await readJson(req);
      await setRoundClosedForOwners({
        entityId: root.id,
        roundId: id,
        closed: body?.closed !== false,
        actorId: principal.userId,
      });
      return NextResponse.json({ ok: true });
    }
    if (head === "resolve") {
      const body = await readJson(req);
      if (!body || !isUuid(body.roundId) || !Array.isArray(body.unitIds)) {
        return fail("round_invalid");
      }
      const unitIds = (body.unitIds as unknown[]).filter(isUuid);
      const result = await setUnitsResolved({
        entityId: root.id,
        roundId: body.roundId,
        unitIds,
        resolved: body.resolved !== false,
        actorId: principal.userId,
      });
      return NextResponse.json(result);
    }
    if (head === "building" && !id) {
      const form = await req.formData().catch(() => null);
      if (!form) return fail("value_invalid");
      const roundId = form.get("roundId");
      if (!isUuid(roundId)) return fail("not_found");
      const meterType = String(form.get("meterType") ?? "") as MeterType;
      if (!ROUND_METER_TYPES.includes(meterType)) return fail("round_invalid");
      const rawValue = String(form.get("value") ?? "").trim();
      if (rawValue.startsWith("-")) return fail("value_negative");
      const valueMilli = parseMilli(rawValue);
      if (valueMilli === null) return fail("value_invalid");
      const photoStorageKey = await photoFromForm(form, root.id);
      const result = await createBuildingReading({
        entityId: root.id,
        actorId: principal.userId,
        roundId,
        meterType,
        label: String(form.get("label") ?? ""),
        readingDate: dateOnly(form.get("readingDate")),
        valueMilli,
        note: String(form.get("note") ?? ""),
        photoStorageKey,
      });
      return NextResponse.json(result, { status: 201 });
    }
    if (head === "building" && isUuid(id) && action === "void") {
      await voidBuildingReading({ entityId: root.id, actorId: principal.userId, id });
      return NextResponse.json({ ok: true });
    }
    if (head === "apply-persons") {
      const body = await readJson(req);
      if (!body || !isUuid(body.roundId)) return fail("round_invalid");
      const result = await applyPersonsToUnitPersons({
        entityId: root.id,
        roundId: body.roundId,
        actorId: principal.userId,
      });
      return NextResponse.json(result);
    }
  } catch (err) {
    return errorResponse(err);
  }
  return fail("not_found");
}

/**
 * Non-writer voids: the lib only lets the row's CREATOR void it while it is
 * owner-editable; this is a cheap pre-filter so board readers without an
 * own unit get a clean 403.
 */
async function hasAnyOwnership(ctx: Ctx): Promise<boolean> {
  const owned = await listOwnedUnits(ctx.principal.userId, ctx.root.id);
  return owned.length > 0;
}
