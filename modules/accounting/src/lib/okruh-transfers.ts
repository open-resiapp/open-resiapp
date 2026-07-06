import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { okruhTransfers, auditLog } from "../db/schema";

// Inter-okruh transfer log (AC 417) — METADATA ONLY.
//
// Records a transient cover between funds (e.g. FPÚO → služby, SK §10 ods. 3)
// and, when it is a návratná pôžička, keeps it on a return-due list so the
// treasurer remembers to repay the source fund. It posts NO journal entry
// and moves NO balance — the correct double-entry needs a dedicated
// inter-okruh account pair the SK COA lacks (BLOCKED under AC 416/417 on an
// účtovník's confirmation + the §10 ods. 3 approval question). See the spec
// Notes. An `open` return-due entry = returnDueFlag AND returnedAt IS NULL.

type Okruh = "fpuo" | "svc" | "mgmt";

export interface OkruhTransferRow {
  id: string;
  fromOkruh: Okruh;
  toOkruh: Okruh;
  amountCents: number;
  transferDate: string;
  note: string | null;
  returnDueFlag: boolean;
  returnDueNote: string | null;
  returnedAt: string | null;
  createdAt: string;
}

export async function createOkruhTransfer(input: {
  entityId: string;
  actorId: string;
  fromOkruh: Okruh;
  toOkruh: Okruh;
  amountCents: number;
  transferDate: Date;
  note: string | null;
  returnDueFlag: boolean;
  returnDueNote: string | null;
}): Promise<{ id: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("accounting: transfer amount must be > 0");
  }
  if (input.fromOkruh === input.toOkruh) {
    throw new Error("accounting: transfer must be between different okruhy");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(okruhTransfers)
      .values({
        entityId: input.entityId,
        fromOkruh: input.fromOkruh,
        toOkruh: input.toOkruh,
        amountCents: input.amountCents,
        transferDate: input.transferDate,
        note: input.note,
        returnDueFlag: input.returnDueFlag,
        returnDueNote: input.returnDueFlag ? input.returnDueNote : null,
        createdById: input.actorId,
      })
      .returning({ id: okruhTransfers.id });
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "insert",
      tableName: "mod_accounting_okruh_transfer",
      recordId: row.id,
      after: {
        fromOkruh: input.fromOkruh,
        toOkruh: input.toOkruh,
        amountCents: input.amountCents,
        returnDueFlag: input.returnDueFlag,
      },
    });
    return { id: row.id };
  });
}

export async function listOkruhTransfers(
  entityId: string,
  openReturnDueOnly = false
): Promise<OkruhTransferRow[]> {
  const rows = await db
    .select()
    .from(okruhTransfers)
    .where(
      openReturnDueOnly
        ? and(
            eq(okruhTransfers.entityId, entityId),
            eq(okruhTransfers.returnDueFlag, true),
            isNull(okruhTransfers.returnedAt)
          )
        : eq(okruhTransfers.entityId, entityId)
    )
    .orderBy(desc(okruhTransfers.transferDate), desc(okruhTransfers.createdAt));
  return rows.map((r) => ({
    id: r.id,
    fromOkruh: r.fromOkruh,
    toOkruh: r.toOkruh,
    amountCents: r.amountCents,
    transferDate: r.transferDate.toISOString(),
    note: r.note,
    returnDueFlag: r.returnDueFlag,
    returnDueNote: r.returnDueNote,
    returnedAt: r.returnedAt ? r.returnedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Flag / unflag a transfer as a return-due loan (metadata only). */
export async function setTransferReturnDue(input: {
  entityId: string;
  id: string;
  actorId: string;
  returnDueFlag: boolean;
  returnDueNote: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: okruhTransfers.id })
      .from(okruhTransfers)
      .where(
        and(
          eq(okruhTransfers.id, input.id),
          eq(okruhTransfers.entityId, input.entityId)
        )
      )
      .for("update");
    if (!row) throw new Error("accounting: transfer not found");
    await tx
      .update(okruhTransfers)
      .set({
        returnDueFlag: input.returnDueFlag,
        // Clearing the flag drops it off the open list; keep the note only
        // while flagged.
        returnDueNote: input.returnDueFlag ? input.returnDueNote : null,
      })
      .where(eq(okruhTransfers.id, input.id));
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_okruh_transfer",
      recordId: input.id,
      after: { returnDueFlag: input.returnDueFlag },
    });
  });
}

/** Mark a return-due loan as repaid to the source fund (closes it). */
export async function markTransferReturned(input: {
  entityId: string;
  id: string;
  actorId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: okruhTransfers.id })
      .from(okruhTransfers)
      .where(
        and(
          eq(okruhTransfers.id, input.id),
          eq(okruhTransfers.entityId, input.entityId)
        )
      )
      .for("update");
    if (!row) throw new Error("accounting: transfer not found");
    await tx
      .update(okruhTransfers)
      .set({ returnedAt: sql`now()` })
      .where(eq(okruhTransfers.id, input.id));
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_okruh_transfer",
      recordId: input.id,
      after: { returnedAt: "now" },
    });
  });
}
