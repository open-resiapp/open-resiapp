import "server-only";

import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { getStorage, buildStorageKey } from "@/lib/storage";
import { expenseInbox, auditLog } from "../db/schema";
import { createExpense } from "./expenses";
import { uploadAttachment } from "./attachments";
import { voidExpense } from "./expenses";
import { ocrInvoice } from "./invoice-ocr.server";
import { extractInvoiceFields } from "./invoice-extract";

// Expense collector inbox (AC 478/479). A parked invoice PDF the treasurer
// posts as an expense in ≤2 clicks. OCR fields are suggestions only; the
// stored PDF becomes the posted expense's mandatory scan (AC 440), so it is
// never hard-deleted.

type Country = "sk" | "cz";

const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 15 * 1024 * 1024;

export interface InboxRow {
  id: string;
  sourceKind: "upload" | "email";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  ocrEngine: string | null;
  ocrIco: string | null;
  ocrDic: string | null;
  ocrIban: string | null;
  ocrVs: string | null;
  ocrAmountCents: number | null;
  ocrConfidencePct: number | null;
  status: "pending" | "posted" | "dismissed";
  postedExpenseId: string | null;
  createdAt: string;
}

/** Upload a PDF/image → store it, OCR it, park a pending inbox row. */
export async function createInboxItem(input: {
  entityId: string;
  actorId: string;
  fileName: string;
  contentType: string;
  body: Buffer;
}): Promise<{ id: string }> {
  if (!ALLOWED_TYPES.has(input.contentType)) {
    throw new Error("accounting: only PDF / JPEG / PNG / WebP invoices allowed");
  }
  if (input.body.length === 0 || input.body.length > MAX_BYTES) {
    throw new Error("accounting: file empty or over 15 MB");
  }

  // Store under a uuid key so same-named uploads never collide.
  const ext = input.contentType === "application/pdf" ? "pdf" : "img";
  const key = buildStorageKey(
    `accounting/${input.entityId}/inbox`,
    `${randomUUID()}.${ext}`
  );
  await getStorage().put(key, input.body, {
    contentType: input.contentType,
    filename: input.fileName,
  });

  // Best-effort OCR — never blocks the parking of the row.
  const ocr = await ocrInvoice(new Uint8Array(input.body), input.contentType);
  const fields = extractInvoiceFields(ocr.text);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(expenseInbox)
      .values({
        entityId: input.entityId,
        uploadedById: input.actorId,
        sourceKind: "upload",
        pdfStorageKey: key,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.body.length,
        ocrEngine: ocr.engine,
        ocrIco: fields.ico,
        ocrDic: fields.dic,
        ocrIban: fields.iban,
        ocrVs: fields.vs,
        ocrAmountCents: fields.amountCents,
        ocrConfidencePct: fields.confidencePct,
        status: "pending",
      })
      .returning({ id: expenseInbox.id });
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "insert",
      tableName: "mod_accounting_expense_inbox",
      recordId: row.id,
      after: { fileName: input.fileName, ocrEngine: ocr.engine },
    });
    return { id: row.id };
  });
}

/** List inbox rows for the dom (pending first / newest first). */
export async function listInbox(
  entityId: string,
  status?: "pending" | "posted" | "dismissed"
): Promise<InboxRow[]> {
  const rows = await db
    .select()
    .from(expenseInbox)
    .where(
      status
        ? and(eq(expenseInbox.entityId, entityId), eq(expenseInbox.status, status))
        : eq(expenseInbox.entityId, entityId)
    )
    .orderBy(desc(expenseInbox.createdAt));
  return rows.map((r) => ({
    id: r.id,
    sourceKind: r.sourceKind,
    fileName: r.fileName,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    ocrEngine: r.ocrEngine,
    ocrIco: r.ocrIco,
    ocrDic: r.ocrDic,
    ocrIban: r.ocrIban,
    ocrVs: r.ocrVs,
    ocrAmountCents: r.ocrAmountCents,
    ocrConfidencePct: r.ocrConfidencePct,
    status: r.status,
    postedExpenseId: r.postedExpenseId,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Dismiss a pending row (treasurer decided not to post it). */
export async function dismissInboxItem(input: {
  entityId: string;
  id: string;
  actorId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: expenseInbox.id, status: expenseInbox.status })
      .from(expenseInbox)
      .where(
        and(eq(expenseInbox.id, input.id), eq(expenseInbox.entityId, input.entityId))
      )
      .for("update");
    if (!row) throw new Error("accounting: inbox item not found");
    if (row.status !== "pending") {
      throw new Error("accounting: only a pending inbox item can be dismissed");
    }
    await tx
      .update(expenseInbox)
      .set({ status: "dismissed" })
      .where(eq(expenseInbox.id, input.id));
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_expense_inbox",
      recordId: input.id,
      after: { status: "dismissed" },
    });
  });
}

export interface PostInboxInput {
  entityId: string;
  country: Country;
  id: string;
  actorId: string;
  // Confirmed / edited expense fields (the 2-click form).
  supplierName: string;
  supplierIco: string;
  supplierDic: string;
  supplierIban: string;
  invoiceNo: string;
  invoiceDate: Date;
  dueDate: Date | null;
  serviceCategoryId: string | null;
  okruh: "fpuo" | "svc";
  amountCents: number;
  amountNettoCents: number;
  dphCents: number;
  dphRateBp: number | null;
  nextInspectionDueAt: Date | null;
  isRecurring: boolean;
}

/**
 * Post a pending inbox row as a real expense: create the doklad, attach the
 * parked PDF as its mandatory scan, and mark the row posted. Mirrors the
 * expense-create compensation — if the attachment fails, the just-created
 * (unpaid) expense is voided so no attachment-less doklad persists.
 */
export async function postInboxItemAsExpense(
  input: PostInboxInput
): Promise<{ expenseId: string }> {
  // Claim the row first (must be pending, dom-scoped) and read its PDF key.
  const inbox = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: expenseInbox.id,
        status: expenseInbox.status,
        pdfStorageKey: expenseInbox.pdfStorageKey,
        fileName: expenseInbox.fileName,
        contentType: expenseInbox.contentType,
      })
      .from(expenseInbox)
      .where(
        and(eq(expenseInbox.id, input.id), eq(expenseInbox.entityId, input.entityId))
      )
      .for("update");
    if (!row) throw new Error("accounting: inbox item not found");
    if (row.status !== "pending") {
      throw new Error("accounting: inbox item already handled");
    }
    return row;
  });

  // Fetch the parked scan bytes BEFORE creating the doklad — a missing
  // object must fail while nothing is posted.
  const stored = await getStorage().get(inbox.pdfStorageKey);
  if (!stored) throw new Error("accounting: parked scan is missing from storage");

  const { expenseId } = await createExpense({
    entityId: input.entityId,
    country: input.country,
    createdById: input.actorId,
    supplierName: input.supplierName,
    supplierIco: input.supplierIco,
    supplierDic: input.supplierDic,
    supplierIban: input.supplierIban,
    invoiceNo: input.invoiceNo,
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate,
    serviceCategoryId: input.serviceCategoryId,
    okruh: input.okruh,
    amountCents: input.amountCents,
    amountNettoCents: input.amountNettoCents,
    dphCents: input.dphCents,
    dphRateBp: input.dphRateBp,
    nextInspectionDueAt: input.nextInspectionDueAt,
    isRecurring: input.isRecurring,
  });

  try {
    await uploadAttachment({
      entityId: input.entityId,
      expenseId,
      role: "original",
      fileName: inbox.fileName,
      contentType: inbox.contentType,
      body: stored.body,
      actorId: input.actorId,
    });
  } catch (attachErr) {
    try {
      await voidExpense({
        entityId: input.entityId,
        country: input.country,
        expenseId,
        actorId: input.actorId,
        reason: "attachment upload failed while posting inbox item",
      });
    } catch (voidErr) {
      console.error(
        `accounting: inbox post attachment failed AND compensating void failed for expense ${expenseId}`,
        attachErr,
        voidErr
      );
    }
    throw attachErr;
  }

  // Mark the row posted + audit. If this last update fails the doklad still
  // stands (with its scan); the row simply stays pending and can be retried
  // — the duplicate-invoice guard in createExpense blocks a double-post.
  await db.transaction(async (tx) => {
    await tx
      .update(expenseInbox)
      .set({ status: "posted", postedExpenseId: expenseId })
      .where(eq(expenseInbox.id, input.id));
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_expense_inbox",
      recordId: input.id,
      after: { status: "posted", postedExpenseId: expenseId },
    });
  });

  return { expenseId };
}
