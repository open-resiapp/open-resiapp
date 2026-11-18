import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { getStorage } from "@/lib/storage";

import {
  FAULT_PRIORITIES,
  FAULT_STATUSES,
  FAULT_VISIBILITIES,
  type FaultErrorCode,
  type FaultPriority,
  type FaultStatus,
  type FaultVisibility,
} from "../../engine/transitions";
import { faultPhotos } from "../../db/schema";
import { getFaultActor, type FaultActor } from "../../lib/authz.server";
import {
  addContractor,
  addCustomCategory,
  listContractors,
  listLinkableExpenses,
} from "../../lib/catalogs.server";
import {
  addPhotos,
  boardUpdate,
  changeStatus,
  createFault,
  removePhoto,
  reporterEdit,
  withdrawFault,
  type BoardPatch,
  type MutationResult,
} from "../../lib/mutations.server";
import {
  getFaultForBoard,
  getFaultForResident,
  loadFaultRow,
  residentCanSeeFault,
} from "../../lib/queries.server";

// Faults API (BYT-20261118-004), mounted under /api/modules/faults/** by
// thin route files wrapped in withModuleEnabled("faults"). Errors are
// `{ error: <FAULT_* code> }`; the client maps codes to Faults.errors.*.

type IdParams = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(code: FaultErrorCode, status: number) {
  return NextResponse.json({ error: code }, { status });
}

function respond<T>(r: MutationResult<T>, okStatus = 200) {
  if (!r.ok) return fail(r.code, r.status);
  const { ok: _ok, ...rest } = r as { ok: true } & T;
  return NextResponse.json({ ok: true, ...rest }, { status: okStatus });
}

async function actorOr401(): Promise<FaultActor | NextResponse> {
  const actor = await getFaultActor();
  if (!actor) return fail("FAULT_FORBIDDEN", 401);
  return actor;
}

async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const b = (await req.json()) as unknown;
    return b && typeof b === "object" ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const optStr = (v: unknown): string | null | undefined =>
  v === undefined ? undefined : v === null ? null : typeof v === "string" ? v : undefined;
const optId = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  return typeof v === "string" && UUID_RE.test(v) ? v : undefined;
};

function filesFrom(form: FormData): File[] {
  return form.getAll("photos").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
}

// ── Create ─────────────────────────────────────────────

export async function handleCreate(req: NextRequest): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  if (!actor.canReport) return fail("FAULT_FORBIDDEN", 403);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("FAULT_INVALID_INPUT", 400);
  }
  const locationEntityId = str(form.get("locationEntityId")) ?? "";
  if (!UUID_RE.test(locationEntityId)) return fail("FAULT_LOCATION_NOT_ALLOWED", 400);
  const visRaw = str(form.get("visibility"));
  const visibility =
    visRaw && (FAULT_VISIBILITIES as readonly string[]).includes(visRaw)
      ? (visRaw as FaultVisibility)
      : visRaw
        ? undefined
        : null;
  if (visibility === undefined) return fail("FAULT_INVALID_INPUT", 400);
  const r = await createFault(
    actor,
    {
      title: str(form.get("title")) ?? "",
      description: str(form.get("description")),
      locationEntityId,
      locationNote: str(form.get("locationNote")),
      visibility,
    },
    filesFrom(form)
  );
  return respond(r, 201);
}

// ── Read one (role-aware view) ─────────────────────────

export async function handleGetOne(_req: NextRequest, { params }: IdParams): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail("FAULT_NOT_FOUND", 404);
  if (actor.board) {
    const view = await getFaultForBoard(actor.root.id, id, actor.board);
    return view ? NextResponse.json(view) : fail("FAULT_NOT_FOUND", 404);
  }
  const view = await getFaultForResident(actor.userId, actor.root.id, id);
  return view ? NextResponse.json(view) : fail("FAULT_NOT_FOUND", 404);
}

// ── Reporter ───────────────────────────────────────────

export async function handleReporterPatch(req: NextRequest, { params }: IdParams): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail("FAULT_NOT_FOUND", 404);
  const body = await readJson(req);
  if (!body) return fail("FAULT_INVALID_INPUT", 400);
  const vis = body.visibility;
  if (vis !== undefined && !(FAULT_VISIBILITIES as readonly unknown[]).includes(vis)) {
    return fail("FAULT_INVALID_INPUT", 400);
  }
  const r = await reporterEdit(actor, id, {
    title: optStr(body.title) ?? undefined,
    description: optStr(body.description),
    locationNote: optStr(body.locationNote),
    visibility: vis as FaultVisibility | undefined,
  });
  return respond(r);
}

export async function handleWithdraw(_req: NextRequest, { params }: IdParams): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail("FAULT_NOT_FOUND", 404);
  return respond(await withdrawFault(actor, id));
}

// ── Photos ─────────────────────────────────────────────

export async function handleAddPhotos(req: NextRequest, { params }: IdParams): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail("FAULT_NOT_FOUND", 404);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("FAULT_INVALID_INPUT", 400);
  }
  const files = filesFrom(form);
  if (files.length === 0) return fail("FAULT_PHOTO_INVALID", 400);
  return respond(await addPhotos(actor, id, files), 201);
}

export async function handleDeletePhoto(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; photoId: string }> }
): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  const { id, photoId } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(photoId)) return fail("FAULT_NOT_FOUND", 404);
  return respond(await removePhoto(actor, id, photoId));
}

/**
 * GET /api/modules/faults/photos/[photoId] — the ONLY way to read a fault
 * photo. Board: any photo of the community. Resident: only when the fault
 * passes the resident visibility predicate; otherwise 404 (no existence leak).
 */
export async function handlePhoto(
  _req: NextRequest,
  { params }: { params: Promise<{ photoId: string }> }
): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  const { photoId } = await params;
  if (!UUID_RE.test(photoId)) return fail("FAULT_NOT_FOUND", 404);
  const [photo] = await db
    .select({ faultId: faultPhotos.faultId, key: faultPhotos.storageKey, type: faultPhotos.contentType })
    .from(faultPhotos)
    .where(eq(faultPhotos.id, photoId))
    .limit(1);
  if (!photo) return fail("FAULT_NOT_FOUND", 404);
  const fault = await loadFaultRow(actor.root.id, photo.faultId);
  if (!fault) return fail("FAULT_NOT_FOUND", 404);
  const visible = actor.board
    ? true
    : await residentCanSeeFault(actor.userId, actor.root.id, photo.faultId);
  if (!visible) return fail("FAULT_NOT_FOUND", 404);
  const obj = await getStorage().get(photo.key);
  if (!obj) return fail("FAULT_NOT_FOUND", 404);
  return new NextResponse(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": photo.type,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

// ── Board ──────────────────────────────────────────────

export async function handleBoardPatch(req: NextRequest, { params }: IdParams): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  if (!actor.board) return fail("FAULT_FORBIDDEN", 403);
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail("FAULT_NOT_FOUND", 404);
  const body = await readJson(req);
  if (!body) return fail("FAULT_INVALID_INPUT", 400);

  const patch: BoardPatch = {};
  if (body.priority !== undefined) {
    if (!(FAULT_PRIORITIES as readonly unknown[]).includes(body.priority)) return fail("FAULT_INVALID_INPUT", 400);
    patch.priority = body.priority as FaultPriority;
  }
  if (body.visibility !== undefined) {
    if (!(FAULT_VISIBILITIES as readonly unknown[]).includes(body.visibility)) return fail("FAULT_INVALID_INPUT", 400);
    patch.visibility = body.visibility as FaultVisibility;
  }
  for (const k of ["categoryId", "assigneeUserId", "contractorId", "expenseId"] as const) {
    if (body[k] === undefined) continue;
    const v = optId(body[k]);
    if (v === undefined) return fail("FAULT_INVALID_INPUT", 400);
    patch[k] = v;
  }
  if (body.locationEntityId !== undefined) {
    const v = optId(body.locationEntityId);
    if (!v) return fail("FAULT_INVALID_INPUT", 400);
    patch.locationEntityId = v;
  }
  if (body.invoiced !== undefined) {
    if (typeof body.invoiced !== "boolean") return fail("FAULT_INVALID_INPUT", 400);
    patch.invoiced = body.invoiced;
  }
  if (body.internalNote !== undefined) patch.internalNote = optStr(body.internalNote) ?? null;
  if (body.locationNote !== undefined) patch.locationNote = optStr(body.locationNote) ?? null;
  return respond(await boardUpdate(actor, id, patch));
}

export async function handleStatus(req: NextRequest, { params }: IdParams): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  if (!actor.board) return fail("FAULT_FORBIDDEN", 403);
  const { id } = await params;
  if (!UUID_RE.test(id)) return fail("FAULT_NOT_FOUND", 404);
  const body = await readJson(req);
  if (!body || !(FAULT_STATUSES as readonly unknown[]).includes(body.to)) {
    return fail("FAULT_INVALID_INPUT", 400);
  }
  const r = await changeStatus(
    actor,
    id,
    body.to as FaultStatus,
    str(body.message),
    str(body.locale) ?? undefined
  );
  return respond(r);
}

export async function handleListContractors(): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  if (!actor.board) return fail("FAULT_FORBIDDEN", 403);
  return NextResponse.json(await listContractors(actor.root.id));
}

export async function handleCreateContractor(req: NextRequest): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  if (!actor.board) return fail("FAULT_FORBIDDEN", 403);
  const body = await readJson(req);
  const name = str(body?.name)?.trim();
  if (!body || !name || name.length > 255) return fail("FAULT_INVALID_INPUT", 400);
  const row = await addContractor(actor.root.id, {
    name,
    phone: str(body.phone)?.trim().slice(0, 40) || null,
    email: str(body.email)?.trim().slice(0, 255) || null,
    ico: str(body.ico)?.trim().slice(0, 20) || null,
    note: str(body.note)?.trim() || null,
  });
  return NextResponse.json(row, { status: 201 });
}

export async function handleCreateCategory(req: NextRequest): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  if (!actor.board) return fail("FAULT_FORBIDDEN", 403);
  const body = await readJson(req);
  const name = str(body?.name)?.trim();
  if (!name || name.length > 120) return fail("FAULT_INVALID_INPUT", 400);
  return NextResponse.json(await addCustomCategory(actor.root.id, name), { status: 201 });
}

/** Expense picker: non-voided expenses of this community (accounting on, full board only). */
export async function handleListExpenses(): Promise<NextResponse> {
  const actor = await actorOr401();
  if (actor instanceof NextResponse) return actor;
  if (actor.board !== "full") return fail("FAULT_FORBIDDEN", 403);
  return NextResponse.json(await listLinkableExpenses(actor.root.id));
}
