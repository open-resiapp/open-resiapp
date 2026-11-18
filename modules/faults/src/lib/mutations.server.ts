import "server-only";

import { randomUUID } from "crypto";
import { and, count, eq, isNull, sql } from "drizzle-orm";

import { getTranslations } from "next-intl/server";

import { db } from "@/db";
import { entities, users } from "@/db/schema";
import { routing } from "@/i18n/routing";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { sendPushNotification } from "@/lib/push";
import { getStorage } from "@/lib/storage";
import { expenses } from "@modules/accounting/src/db/schema";

import {
  checkAssignee,
  checkBoardTransition,
  checkLocationAllowed,
  checkPhoto,
  checkPhotoCount,
  checkReporterEdit,
  checkReporterVisibility,
  checkTitle,
  checkWithdraw,
  FAULT_PRIORITIES,
  FAULT_VISIBILITIES,
  type FaultErrorCode,
  type FaultPriority,
  type FaultStatus,
  type FaultVisibility,
} from "../engine/transitions";
import {
  faultCategories,
  faultContractors,
  faultEvents,
  faultNotificationsSent,
  faultPhotos,
  faults,
} from "../db/schema";
import type { FaultActor } from "./authz.server";
import { sendFaultStatusChanged } from "./email.server";
import { listReporterLocations, resolveBoardLocation } from "./locations.server";
import { loadFaultRow } from "./queries.server";
import { isFaultManager } from "./catalogs.server";

// Fault writes (BYT-20261118-004). Every rule check is the pure engine;
// every change writes one mod_faults_events row (append-only history).
// Short transactions, no DDL, no locks beyond row writes.

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type MutationResult<T = {}> =
  | ({ ok: true } & T)
  | { ok: false; code: FaultErrorCode; status: number };

const err = (code: FaultErrorCode, status = 400): { ok: false; code: FaultErrorCode; status: number } => ({
  ok: false,
  code,
  status,
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function appUrl(): string {
  return process.env.NEXTAUTH_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

// ── Photos ─────────────────────────────────────────────

async function storePhotos(files: File[]): Promise<{ key: string; type: string }[]> {
  const storage = getStorage();
  const stored: { key: string; type: string }[] = [];
  for (const f of files) {
    const ext = f.type === "image/jpeg" ? "jpg" : f.type.split("/")[1];
    // Random key: not guessable from the fault id; `faults/` is served only
    // by the visibility-checked GET /api/modules/faults/photos/[photoId].
    const key = `faults/${randomUUID()}.${ext}`;
    await storage.put(key, Buffer.from(await f.arrayBuffer()), { contentType: f.type });
    stored.push({ key, type: f.type });
  }
  return stored;
}

async function removeStoredBestEffort(keys: string[]): Promise<void> {
  const storage = getStorage();
  for (const k of keys) {
    try {
      await storage.delete(k);
    } catch (e) {
      console.warn("[faults] could not delete stored photo", k, e);
    }
  }
}

function validatePhotos(existing: number, files: File[]): FaultErrorCode | null {
  const c = checkPhotoCount(existing, files.length);
  if (!c.ok) return c.code;
  for (const f of files) {
    const r = checkPhoto({ type: f.type, size: f.size });
    if (!r.ok) return r.code;
  }
  return null;
}

// ── Create ─────────────────────────────────────────────

export interface CreateFaultInput {
  title: string;
  description: string | null;
  locationEntityId: string;
  locationNote: string | null;
  visibility: FaultVisibility | null;
}

export async function createFault(
  actor: FaultActor,
  input: CreateFaultInput,
  files: File[]
): Promise<MutationResult<{ id: string }>> {
  if (!actor.canReport) return err("FAULT_FORBIDDEN", 403);
  const title = checkTitle(input.title);
  if (!title.ok) return err(title.code);

  const locations = await listReporterLocations(actor.userId, actor.root.id);
  const allowed = checkLocationAllowed(
    input.locationEntityId,
    locations.map((l) => l.id)
  );
  if (!allowed.ok) return err(allowed.code);
  const location = locations.find((l) => l.id === input.locationEntityId)!;

  const vis = checkReporterVisibility(location.kind, input.visibility);
  if (!vis.ok) return err(vis.code);

  const photoErr = validatePhotos(0, files);
  if (photoErr) return err(photoErr);

  const stored = await storePhotos(files);
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(faults)
        .values({
          rootEntityId: actor.root.id,
          locationEntityId: location.id,
          scopeEntityId: location.scopeEntityId,
          locationNote: input.locationNote?.trim() || null,
          reporterId: actor.userId,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          visibility: vis.visibility,
        })
        .returning({ id: faults.id });
      if (stored.length) {
        await tx.insert(faultPhotos).values(
          stored.map((s) => ({
            faultId: row.id,
            storageKey: s.key,
            contentType: s.type,
            uploadedById: actor.userId,
          }))
        );
      }
      await tx.insert(faultEvents).values({
        faultId: row.id,
        actorId: actor.userId,
        type: "created",
        newValue: { status: "new" },
        isPublic: true,
      });
      return row.id;
    });
    return { ok: true, id };
  } catch (e) {
    await removeStoredBestEffort(stored.map((s) => s.key));
    throw e;
  }
}

// ── Reporter edit / withdraw ───────────────────────────

export interface ReporterEditInput {
  title?: string;
  description?: string | null;
  locationNote?: string | null;
  visibility?: FaultVisibility;
}

async function loadOwn(actor: FaultActor, id: string) {
  const row = await loadFaultRow(actor.root.id, id);
  // 404, not 403: never confirm someone else's private report exists.
  if (!row || row.reporterId !== actor.userId) return null;
  return row;
}

async function touch(tx: Tx, id: string, boardSide: boolean) {
  await tx
    .update(faults)
    .set({
      updatedAt: new Date(),
      ...(boardSide ? { boardTouchedAt: sql`coalesce(${faults.boardTouchedAt}, now())` } : {}),
    })
    .where(eq(faults.id, id));
}

export async function reporterEdit(
  actor: FaultActor,
  id: string,
  input: ReporterEditInput
): Promise<MutationResult> {
  const row = await loadOwn(actor, id);
  if (!row) return err("FAULT_NOT_FOUND", 404);
  const can = checkReporterEdit({ status: row.status, boardTouched: row.boardTouchedAt !== null });
  if (!can.ok) return err(can.code, 409);

  const patch: Partial<typeof faults.$inferInsert> = {};
  const changes: { field: string; old: unknown; new: unknown }[] = [];
  if (input.title !== undefined) {
    const t = checkTitle(input.title);
    if (!t.ok) return err(t.code);
    const v = input.title.trim();
    if (v !== row.title) {
      patch.title = v;
      changes.push({ field: "title", old: row.title, new: v });
    }
  }
  if (input.description !== undefined) {
    const v = input.description?.trim() || null;
    if (v !== row.description) {
      patch.description = v;
      changes.push({ field: "description", old: row.description, new: v });
    }
  }
  if (input.locationNote !== undefined) {
    const v = input.locationNote?.trim() || null;
    if (v !== row.locationNote) {
      patch.locationNote = v;
      changes.push({ field: "locationNote", old: row.locationNote, new: v });
    }
  }
  if (input.visibility !== undefined && input.visibility !== row.visibility) {
    // Reporter may only narrow relative to the CURRENT visibility.
    const order = FAULT_VISIBILITIES as readonly string[];
    if (!order.includes(input.visibility)) return err("FAULT_INVALID_INPUT");
    if (order.indexOf(input.visibility) > order.indexOf(row.visibility)) {
      return err("FAULT_VISIBILITY_WIDEN_FORBIDDEN");
    }
    patch.visibility = input.visibility;
    changes.push({ field: "visibility", old: row.visibility, new: input.visibility });
  }
  if (changes.length === 0) return { ok: true };

  const applied = await db.transaction(async (tx) => {
    // Guard in the UPDATE itself: the board may have moved the fault (or
    // touched it) between loadOwn and here — the pre-check alone would let
    // the reporter overwrite a fault that is no longer editable.
    const updated = await tx
      .update(faults)
      .set(patch)
      .where(
        and(
          eq(faults.id, id),
          eq(faults.reporterId, actor.userId),
          eq(faults.status, "new"),
          isNull(faults.boardTouchedAt)
        )
      )
      .returning({ id: faults.id });
    if (updated.length === 0) return false;
    await touch(tx, id, false);
    await tx.insert(faultEvents).values(
      changes.map((c) => ({
        faultId: id,
        actorId: actor.userId,
        type: "edited" as const,
        field: c.field,
        oldValue: c.old,
        newValue: c.new,
      }))
    );
    return true;
  });
  if (!applied) return err("FAULT_NOT_EDITABLE", 409);
  return { ok: true };
}

/**
 * Withdraw (decided 2026-11-18, re-confirmed by the owner): status →
 * `withdrawn`, the record, its history AND its photos stay for the board
 * (the board may still need them). No copy promises deletion — the
 * confirm dialog says the report stays in the history.
 */
export async function withdrawFault(actor: FaultActor, id: string): Promise<MutationResult> {
  const row = await loadOwn(actor, id);
  if (!row) return err("FAULT_NOT_FOUND", 404);
  const can = checkWithdraw({ status: row.status, boardTouched: row.boardTouchedAt !== null });
  if (!can.ok) return err(can.code, 409);
  const applied = await db.transaction(async (tx) => {
    const updated = await tx
      .update(faults)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(and(eq(faults.id, id), eq(faults.status, "new"), isNull(faults.boardTouchedAt)))
      .returning({ id: faults.id });
    // Raced with a board change — report it instead of a silent no-op.
    if (updated.length === 0) return false;
    await tx.insert(faultEvents).values({
      faultId: id,
      actorId: actor.userId,
      type: "status_changed",
      field: "status",
      oldValue: "new",
      newValue: "withdrawn",
      isPublic: true,
    });
    return true;
  });
  if (!applied) return err("FAULT_WITHDRAW_NOT_ALLOWED", 409);
  return { ok: true };
}

// ── Photos (reporter while editable, or board) ─────────

async function canTouchPhotos(actor: FaultActor, row: NonNullable<Awaited<ReturnType<typeof loadFaultRow>>>) {
  if (actor.board) return { ok: true as const, boardSide: true };
  if (row.reporterId !== actor.userId) return { ok: false as const, res: err("FAULT_NOT_FOUND", 404) };
  const can = checkReporterEdit({ status: row.status, boardTouched: row.boardTouchedAt !== null });
  if (!can.ok) return { ok: false as const, res: err(can.code, 409) };
  return { ok: true as const, boardSide: false };
}

export async function addPhotos(
  actor: FaultActor,
  id: string,
  files: File[]
): Promise<MutationResult<{ ids: string[] }>> {
  const row = await loadFaultRow(actor.root.id, id);
  if (!row) return err("FAULT_NOT_FOUND", 404);
  const gate = await canTouchPhotos(actor, row);
  if (!gate.ok) return gate.res;
  // Fast fail before storing files; the authoritative count is re-taken
  // inside the transaction under the fault row lock below.
  const [{ n }] = await db
    .select({ n: count() })
    .from(faultPhotos)
    .where(eq(faultPhotos.faultId, id));
  const photoErr = validatePhotos(n, files);
  if (photoErr) return err(photoErr);

  const stored = await storePhotos(files);
  try {
    const result = await db.transaction(async (tx): Promise<
      { ok: true; ids: string[] } | { ok: false; code: FaultErrorCode }
    > => {
      // Lock the fault row: concurrent uploads serialize here, so two
      // requests can't both see "3 photos" and push the total past 5.
      const [locked] = await tx
        .select({ status: faults.status, boardTouchedAt: faults.boardTouchedAt })
        .from(faults)
        .where(eq(faults.id, id))
        .for("update");
      if (!locked) return { ok: false, code: "FAULT_NOT_FOUND" };
      if (!gate.boardSide) {
        const can = checkReporterEdit({
          status: locked.status,
          boardTouched: locked.boardTouchedAt !== null,
        });
        if (!can.ok) return { ok: false, code: can.code };
      }
      const [{ n: current }] = await tx
        .select({ n: count() })
        .from(faultPhotos)
        .where(eq(faultPhotos.faultId, id));
      const countCheck = checkPhotoCount(current, stored.length);
      if (!countCheck.ok) return { ok: false, code: countCheck.code };

      const inserted = await tx
        .insert(faultPhotos)
        .values(
          stored.map((s) => ({
            faultId: id,
            storageKey: s.key,
            contentType: s.type,
            uploadedById: actor.userId,
          }))
        )
        .returning({ id: faultPhotos.id });
      await touch(tx, id, gate.boardSide);
      await tx.insert(faultEvents).values(
        inserted.map((p) => ({
          faultId: id,
          actorId: actor.userId,
          type: "photo_added" as const,
          field: "photo",
          newValue: p.id,
        }))
      );
      return { ok: true, ids: inserted.map((p) => p.id) };
    });
    if (!result.ok) {
      await removeStoredBestEffort(stored.map((s) => s.key));
      return err(
        result.code,
        result.code === "FAULT_NOT_FOUND" ? 404 : result.code === "FAULT_NOT_EDITABLE" ? 409 : 400
      );
    }
    return { ok: true, ids: result.ids };
  } catch (e) {
    await removeStoredBestEffort(stored.map((s) => s.key));
    throw e;
  }
}

export async function removePhoto(
  actor: FaultActor,
  id: string,
  photoId: string
): Promise<MutationResult> {
  const row = await loadFaultRow(actor.root.id, id);
  if (!row) return err("FAULT_NOT_FOUND", 404);
  const gate = await canTouchPhotos(actor, row);
  if (!gate.ok) return gate.res;
  const [photo] = await db
    .select({ id: faultPhotos.id, key: faultPhotos.storageKey })
    .from(faultPhotos)
    .where(and(eq(faultPhotos.id, photoId), eq(faultPhotos.faultId, id)))
    .limit(1);
  if (!photo) return err("FAULT_NOT_FOUND", 404);
  await db.transaction(async (tx) => {
    await tx.delete(faultPhotos).where(eq(faultPhotos.id, photoId));
    await touch(tx, id, gate.boardSide);
    await tx.insert(faultEvents).values({
      faultId: id,
      actorId: actor.userId,
      type: "photo_removed",
      field: "photo",
      oldValue: photoId,
    });
  });
  await removeStoredBestEffort([photo.key]);
  return { ok: true };
}

// ── Board: fields ──────────────────────────────────────

export interface BoardPatch {
  priority?: FaultPriority;
  categoryId?: string | null;
  assigneeUserId?: string | null;
  contractorId?: string | null;
  invoiced?: boolean;
  expenseId?: string | null;
  internalNote?: string | null;
  visibility?: FaultVisibility;
  locationEntityId?: string;
  locationNote?: string | null;
}

async function nameOf(table: "user" | "contractor" | "category", id: string | null, rootId: string) {
  if (!id) return null;
  if (table === "user") {
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, id)).limit(1);
    return u ? { id, name: u.name } : undefined;
  }
  if (table === "contractor") {
    const [c] = await db
      .select({ name: faultContractors.name })
      .from(faultContractors)
      .where(and(eq(faultContractors.id, id), eq(faultContractors.rootEntityId, rootId)))
      .limit(1);
    return c ? { id, name: c.name } : undefined;
  }
  const [c] = await db
    .select({ slug: faultCategories.slug, customName: faultCategories.customName })
    .from(faultCategories)
    .where(and(eq(faultCategories.id, id), eq(faultCategories.rootEntityId, rootId)))
    .limit(1);
  return c ? { id, slug: c.slug, name: c.customName } : undefined;
}

/** Expense picker / link check: non-voided expense of the same community. */
async function expenseExists(expenseId: string, rootId: string): Promise<boolean> {
  if (!(await isModuleEnabled("accounting"))) return false;
  const [row] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .innerJoin(entities, eq(entities.id, expenses.entityId))
    .where(
      and(
        eq(expenses.id, expenseId),
        isNull(expenses.voidedAt),
        sql`(${entities.rootId} = ${rootId} OR ${entities.id} = ${rootId})`
      )
    )
    .limit(1);
  return !!row;
}

export async function boardUpdate(
  actor: FaultActor,
  id: string,
  patch: BoardPatch
): Promise<MutationResult> {
  if (!actor.board) return err("FAULT_FORBIDDEN", 403);
  const full = actor.board === "full";
  if (
    !full &&
    (patch.internalNote !== undefined || patch.invoiced !== undefined || patch.expenseId !== undefined)
  ) {
    return err("FAULT_FORBIDDEN", 403);
  }
  const row = await loadFaultRow(actor.root.id, id);
  if (!row) return err("FAULT_NOT_FOUND", 404);

  const rootId = actor.root.id;
  const set: Partial<typeof faults.$inferInsert> = {};
  const changes: { field: string; old: unknown; new: unknown }[] = [];
  const push = (field: string, old: unknown, nw: unknown) => changes.push({ field, old, new: nw });

  if (patch.priority !== undefined && patch.priority !== row.priority) {
    if (!(FAULT_PRIORITIES as readonly string[]).includes(patch.priority)) return err("FAULT_INVALID_INPUT");
    set.priority = patch.priority;
    push("priority", row.priority, patch.priority);
  }
  if (patch.categoryId !== undefined && patch.categoryId !== row.categoryId) {
    const nw = await nameOf("category", patch.categoryId, rootId);
    if (nw === undefined) return err("FAULT_INVALID_INPUT");
    set.categoryId = patch.categoryId;
    push("categoryId", await nameOf("category", row.categoryId, rootId) ?? null, nw);
  }

  // Assignee: user and contractor are mutually exclusive.
  const nextAssignee = patch.assigneeUserId !== undefined ? patch.assigneeUserId : row.assigneeUserId;
  const nextContractor = patch.contractorId !== undefined ? patch.contractorId : row.contractorId;
  const a = checkAssignee({ assigneeUserId: nextAssignee, contractorId: nextContractor });
  if (!a.ok) return err(a.code);
  if (patch.assigneeUserId !== undefined && patch.assigneeUserId !== row.assigneeUserId) {
    if (patch.assigneeUserId && !(await isFaultManager(rootId, patch.assigneeUserId))) {
      return err("FAULT_INVALID_INPUT");
    }
    set.assigneeUserId = patch.assigneeUserId;
    push(
      "assigneeUserId",
      (await nameOf("user", row.assigneeUserId, rootId)) ?? null,
      (await nameOf("user", patch.assigneeUserId, rootId)) ?? null
    );
  }
  if (patch.contractorId !== undefined && patch.contractorId !== row.contractorId) {
    const nw = await nameOf("contractor", patch.contractorId, rootId);
    if (nw === undefined) return err("FAULT_INVALID_INPUT");
    set.contractorId = patch.contractorId;
    push("contractorId", (await nameOf("contractor", row.contractorId, rootId)) ?? null, nw);
  }

  if (full && patch.expenseId !== undefined && patch.expenseId !== row.expenseId) {
    if (patch.expenseId && !(await expenseExists(patch.expenseId, rootId))) {
      return err("FAULT_EXPENSE_NOT_FOUND");
    }
    set.expenseId = patch.expenseId;
    push("expenseId", row.expenseId, patch.expenseId);
    // Linking an invoice marks the fault invoiced (spec AC).
    if (patch.expenseId && !row.invoiced && patch.invoiced === undefined) {
      set.invoiced = true;
      push("invoiced", false, true);
    }
  }
  if (full && patch.invoiced !== undefined && patch.invoiced !== row.invoiced) {
    set.invoiced = patch.invoiced;
    push("invoiced", row.invoiced, patch.invoiced);
  }
  if (full && patch.internalNote !== undefined) {
    const v = patch.internalNote?.trim() || null;
    if (v !== row.internalNote) {
      set.internalNote = v;
      push("internalNote", row.internalNote, v);
    }
  }
  if (patch.visibility !== undefined && patch.visibility !== row.visibility) {
    if (!(FAULT_VISIBILITIES as readonly string[]).includes(patch.visibility)) return err("FAULT_INVALID_INPUT");
    set.visibility = patch.visibility;
    push("visibility", row.visibility, patch.visibility);
  }
  if (patch.locationEntityId !== undefined && patch.locationEntityId !== row.locationEntityId) {
    const l = await resolveBoardLocation(patch.locationEntityId, rootId);
    if (!l) return err("FAULT_LOCATION_NOT_ALLOWED");
    set.locationEntityId = l.id;
    set.scopeEntityId = l.scopeEntityId;
    push("locationEntityId", row.locationEntityId, { id: l.id, name: l.name });
  }
  if (patch.locationNote !== undefined) {
    const v = patch.locationNote?.trim() || null;
    if (v !== row.locationNote) {
      set.locationNote = v;
      push("locationNote", row.locationNote, v);
    }
  }
  if (changes.length === 0) return { ok: true };

  await db.transaction(async (tx) => {
    await tx.update(faults).set(set).where(eq(faults.id, id));
    await touch(tx, id, true);
    await tx.insert(faultEvents).values(
      changes.map((c) => ({
        faultId: id,
        actorId: actor.userId,
        type: "field_changed" as const,
        field: c.field,
        oldValue: c.old as object,
        newValue: c.new as object,
      }))
    );
  });
  return { ok: true };
}

// ── Board: status ──────────────────────────────────────

export async function changeStatus(
  actor: FaultActor,
  id: string,
  to: FaultStatus,
  publicMessage: string | null,
  locale?: string
): Promise<MutationResult<{ eventId: string }>> {
  if (!actor.board) return err("FAULT_FORBIDDEN", 403);
  const row = await loadFaultRow(actor.root.id, id);
  if (!row) return err("FAULT_NOT_FOUND", 404);
  const message = publicMessage?.trim() || null;
  const check = checkBoardTransition(row.status, to, message);
  if (!check.ok) return err(check.code, check.code === "FAULT_INVALID_TRANSITION" ? 409 : 400);

  const eventId = await db.transaction(async (tx) => {
    // Optimistic guard: only move from the status we validated against.
    const updated = await tx
      .update(faults)
      .set({
        status: to,
        resolvedAt: to === "resolved" ? new Date() : null,
        updatedAt: new Date(),
        boardTouchedAt: sql`coalesce(${faults.boardTouchedAt}, now())`,
      })
      .where(and(eq(faults.id, id), eq(faults.status, row.status)))
      .returning({ id: faults.id });
    if (updated.length === 0) return null;
    const [ev] = await tx
      .insert(faultEvents)
      .values({
        faultId: id,
        actorId: actor.userId,
        type: "status_changed",
        field: "status",
        oldValue: row.status,
        newValue: to,
        publicMessage: message,
        isPublic: true,
      })
      .returning({ id: faultEvents.id });
    return ev.id;
  });
  if (!eventId) return err("FAULT_INVALID_TRANSITION", 409);

  if (row.reporterId && row.reporterId !== actor.userId) {
    await notifyReporter({
      faultId: id,
      eventId,
      reporterId: row.reporterId,
      title: row.title,
      status: to,
      publicMessage: message,
      locale,
    }).catch((e) => console.error("[faults] status notification failed:", e));
  }
  return { ok: true, eventId };
}

/**
 * Claim-then-send (dedupe on the event id): a replayed request finds the
 * claim row and sends nothing. On a failed e-mail the claim is released so
 * a retry can send. TODO(decision): no opt-out — transactional message
 * about the reporter's own report (spec Decisions 9).
 */
async function notifyReporter(p: {
  faultId: string;
  eventId: string;
  reporterId: string;
  title: string;
  status: FaultStatus;
  publicMessage: string | null;
  locale?: string;
}): Promise<void> {
  const claimed = await db
    .insert(faultNotificationsSent)
    .values({
      kind: "status_changed",
      faultId: p.faultId,
      recipientId: p.reporterId,
      eventId: p.eventId,
      dedupeKey: p.eventId,
    })
    .onConflictDoNothing({
      target: [
        faultNotificationsSent.kind,
        faultNotificationsSent.recipientId,
        faultNotificationsSent.dedupeKey,
      ],
    })
    .returning({ id: faultNotificationsSent.id });
  if (claimed.length === 0) return;

  const [reporter] = await db
    .select({ email: users.email, name: users.name, status: users.status })
    .from(users)
    .where(eq(users.id, p.reporterId))
    .limit(1);
  if (!reporter || reporter.status !== "active") return;

  const url = `${appUrl()}/poruchy/${p.faultId}`;
  if (reporter.email) {
    const sent = await sendFaultStatusChanged({
      recipientEmail: reporter.email,
      recipientName: reporter.name,
      faultTitle: p.title,
      status: p.status,
      publicMessage: p.publicMessage,
      faultUrl: url,
      locale: p.locale,
    });
    if (!sent) {
      await db.delete(faultNotificationsSent).where(eq(faultNotificationsSent.id, claimed[0].id));
      return;
    }
  }
  const locale =
    p.locale && (routing.locales as readonly string[]).includes(p.locale) ? p.locale : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "Faults" });
  await sendPushNotification(p.reporterId, {
    title: t("push.statusTitle", { status: t(`status.${p.status}` as "status.new") }),
    body: p.title,
    url: `/poruchy/${p.faultId}`,
  });
}
