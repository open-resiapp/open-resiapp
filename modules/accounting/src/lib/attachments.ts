import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { getStorage, buildStorageKey } from "@/lib/storage";
import { expenses, expenseAttachments, auditLog } from "../db/schema";
import { hasBoardRole, canWriteAccounting } from "./authz";

// Expense attachments + right-to-inspect visibility (spec §Owner
// self-service, §11 ods. 6 zák. 182/1993). Scans stored via the shared
// storage driver (local disk / S3); rows never hard-delete (10-year
// retention) — a superseded scan is voided. Visibility governs what a
// NON-BOARD owner may download.

type Role = "original" | "redacted";
type Visibility = "public" | "redacted_required" | "restricted";

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_BYTES = 15 * 1024 * 1024;

export interface AttachmentRow {
  id: string;
  role: Role;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export async function listAttachments(
  entityId: string,
  expenseId: string
): Promise<AttachmentRow[]> {
  const rows = await db
    .select({
      id: expenseAttachments.id,
      role: expenseAttachments.role,
      fileName: expenseAttachments.fileName,
      contentType: expenseAttachments.contentType,
      sizeBytes: expenseAttachments.sizeBytes,
      createdAt: expenseAttachments.createdAt,
    })
    .from(expenseAttachments)
    .where(
      and(
        eq(expenseAttachments.entityId, entityId),
        eq(expenseAttachments.expenseId, expenseId),
        isNull(expenseAttachments.voidedAt)
      )
    )
    .orderBy(asc(expenseAttachments.createdAt));
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function uploadAttachment(input: {
  entityId: string;
  expenseId: string;
  role: Role;
  fileName: string;
  contentType: string;
  body: Buffer;
  actorId: string;
}): Promise<{ id: string }> {
  if (!ALLOWED_TYPES.has(input.contentType)) {
    throw new Error("accounting: only PDF / JPEG / PNG / WebP scans allowed");
  }
  if (input.body.length === 0 || input.body.length > MAX_BYTES) {
    throw new Error("accounting: file empty or over 15 MB");
  }

  const [expense] = await db
    .select({ id: expenses.id })
    .from(expenses)
    .where(
      and(eq(expenses.id, input.expenseId), eq(expenses.entityId, input.entityId))
    );
  if (!expense) throw new Error("accounting: expense not found");

  const key = buildStorageKey(
    `accounting/${input.entityId}/expenses`,
    input.fileName
  );
  await getStorage().put(key, input.body, {
    contentType: input.contentType,
    filename: input.fileName,
  });

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenseAttachments)
      .values({
        entityId: input.entityId,
        expenseId: input.expenseId,
        role: input.role,
        storageKey: key,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.body.length,
        createdById: input.actorId,
      })
      .returning({ id: expenseAttachments.id });
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "insert",
      tableName: "mod_accounting_expense_attachments",
      recordId: row.id,
      after: { expenseId: input.expenseId, role: input.role, fileName: input.fileName },
    });
    return { id: row.id };
  });
}

export async function setVisibility(input: {
  entityId: string;
  expenseId: string;
  visibility: Visibility;
  justification: string | null;
  actorId: string;
}): Promise<void> {
  if (input.visibility === "restricted" && !input.justification?.trim()) {
    throw new Error(
      "accounting: restricted visibility requires a written justification (audit-logged)"
    );
  }
  await db.transaction(async (tx) => {
    const [expense] = await tx
      .select({ id: expenses.id })
      .from(expenses)
      .where(
        and(eq(expenses.id, input.expenseId), eq(expenses.entityId, input.entityId))
      );
    if (!expense) throw new Error("accounting: expense not found");

    await tx
      .update(expenses)
      .set({
        attachmentVisibility: input.visibility,
        redactionJustification:
          input.visibility === "restricted" ? input.justification!.trim() : null,
      })
      .where(eq(expenses.id, input.expenseId));

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_expenses",
      recordId: input.expenseId,
      after: { attachmentVisibility: input.visibility },
      justification:
        input.visibility === "restricted" ? input.justification!.trim() : null,
    });
  });
}

export async function voidAttachment(input: {
  entityId: string;
  attachmentId: string;
  actorId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ voidedAt: expenseAttachments.voidedAt })
      .from(expenseAttachments)
      .where(
        and(
          eq(expenseAttachments.id, input.attachmentId),
          eq(expenseAttachments.entityId, input.entityId)
        )
      )
      .for("update");
    if (!row) throw new Error("accounting: attachment not found");
    if (row.voidedAt) return;
    await tx
      .update(expenseAttachments)
      .set({ voidedAt: new Date() })
      .where(eq(expenseAttachments.id, input.attachmentId));
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "void",
      tableName: "mod_accounting_expense_attachments",
      recordId: input.attachmentId,
    });
  });
}

/**
 * Resolves which stored object (if any) a given viewer may download for an
 * attachment. Board/admin see everything; a non-board owner is filtered by
 * the doklad's visibility (right-to-inspect):
 *   public            → the requested role
 *   redacted_required → only role 'redacted'
 *   restricted        → nothing
 * Returns the storage object or null (→ 403/404 at the route).
 */
export async function resolveAttachmentDownload(input: {
  entityId: string;
  attachmentId: string;
  userId: string;
  userRole: string;
}): Promise<{ storageKey: string; fileName: string; contentType: string } | null> {
  const [att] = await db
    .select({
      storageKey: expenseAttachments.storageKey,
      fileName: expenseAttachments.fileName,
      contentType: expenseAttachments.contentType,
      role: expenseAttachments.role,
      voidedAt: expenseAttachments.voidedAt,
      visibility: expenses.attachmentVisibility,
    })
    .from(expenseAttachments)
    .innerJoin(expenses, eq(expenseAttachments.expenseId, expenses.id))
    .where(
      and(
        eq(expenseAttachments.id, input.attachmentId),
        eq(expenseAttachments.entityId, input.entityId)
      )
    );
  if (!att || att.voidedAt) return null;

  const isBoard =
    input.userRole === "admin" ||
    (await hasBoardRole(input.userId, input.entityId, ["treasurer", "chairman"]));
  if (isBoard) {
    return {
      storageKey: att.storageKey,
      fileName: att.fileName,
      contentType: att.contentType,
    };
  }

  // Non-board owner — apply visibility.
  if (att.visibility === "restricted") return null;
  if (att.visibility === "redacted_required" && att.role !== "redacted") {
    return null;
  }
  return {
    storageKey: att.storageKey,
    fileName: att.fileName,
    contentType: att.contentType,
  };
}

/** True when a treasurer/admin may mutate this dom's attachments. */
export function canManageAttachments(
  userId: string,
  userRole: string,
  entityId: string
): Promise<boolean> {
  return canWriteAccounting(userId, userRole, entityId);
}

export interface InspectRow {
  expenseId: string;
  supplierName: string;
  invoiceNo: string;
  invoiceDate: string;
  categorySlug: string | null;
  okruh: "fpuo" | "svc" | "mgmt";
  amountCents: number;
  visibility: Visibility;
  /** Attachment id the viewer may download, or null (redaction/restricted). */
  viewableAttachmentId: string | null;
  hasAttachment: boolean;
}

/**
 * Right-to-inspect list (§11 ods. 6 zák. 182/1993): every owner of the dom
 * reads the community's spending. Board sees everything with the original
 * scan; a non-board owner sees each doklad filtered by its visibility. All
 * owners of the dom may call this (not scoped to their own unit) — it is
 * whole-dom transparency, not per-unit data.
 */
export async function listInspectExpenses(input: {
  entityId: string;
  userId: string;
  userRole: string;
}): Promise<InspectRow[]> {
  const { serviceCategories } = await import("../db/schema");
  const { isNull: nul, desc } = await import("drizzle-orm");

  const rows = await db
    .select({
      expenseId: expenses.id,
      supplierName: expenses.supplierName,
      invoiceNo: expenses.invoiceNo,
      invoiceDate: expenses.invoiceDate,
      categorySlug: serviceCategories.slug,
      okruh: expenses.okruh,
      amountCents: expenses.amountCents,
      visibility: expenses.attachmentVisibility,
    })
    .from(expenses)
    .leftJoin(
      serviceCategories,
      eq(expenses.serviceCategoryId, serviceCategories.id)
    )
    .where(and(eq(expenses.entityId, input.entityId), nul(expenses.voidedAt)))
    .orderBy(desc(expenses.invoiceDate), desc(expenses.createdAt));

  if (rows.length === 0) return [];

  const isBoard =
    input.userRole === "admin" ||
    (await hasBoardRole(input.userId, input.entityId, ["treasurer", "chairman"]));

  // Non-voided attachments per expense (original + redacted).
  const atts = await db
    .select({
      id: expenseAttachments.id,
      expenseId: expenseAttachments.expenseId,
      role: expenseAttachments.role,
    })
    .from(expenseAttachments)
    .where(
      and(
        eq(expenseAttachments.entityId, input.entityId),
        isNull(expenseAttachments.voidedAt)
      )
    );
  const byExpense = new Map<string, { original?: string; redacted?: string }>();
  for (const a of atts) {
    const e = byExpense.get(a.expenseId) ?? {};
    if (a.role === "redacted") e.redacted = a.id;
    else e.original = a.id;
    byExpense.set(a.expenseId, e);
  }

  return rows.map((r) => {
    const files = byExpense.get(r.expenseId) ?? {};
    const hasAttachment = !!(files.original || files.redacted);
    let viewableAttachmentId: string | null = null;
    if (isBoard) {
      viewableAttachmentId = files.original ?? files.redacted ?? null;
    } else if (r.visibility === "public") {
      viewableAttachmentId = files.original ?? files.redacted ?? null;
    } else if (r.visibility === "redacted_required") {
      viewableAttachmentId = files.redacted ?? null;
    } // restricted → null
    return {
      expenseId: r.expenseId,
      supplierName: r.supplierName,
      invoiceNo: r.invoiceNo,
      invoiceDate: r.invoiceDate.toISOString(),
      categorySlug: r.categorySlug,
      okruh: r.okruh,
      amountCents: r.amountCents,
      visibility: r.visibility,
      viewableAttachmentId,
      hasAttachment,
    };
  });
}
