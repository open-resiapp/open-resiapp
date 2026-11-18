import "server-only";
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { entities, entityAuditLog, unitNotes, users } from "@/db/schema";
import { isBoardForPath } from "@/lib/documents.server";
import {
  UNIT_NOTE_MAX_LENGTH,
  type UnitNoteDTO,
  type UnitNoteErrorCode,
} from "@/lib/unit-notes";

// Internal board note per unit (BYT-20261118-005 Phase C). One row per unit
// entity, keyed on the entity so it survives a change of owner. Board only
// (active admin membership on the unit's root-to-leaf line). NEVER exposed to
// owners, tenants, caretakers, MCP, exports or entities.data. Audit rows hold
// only { length, updatedAt } — never the text.

/** Unit path if the user is board for that unit; null otherwise (or missing). */
export async function boardUnitPath(
  userId: string,
  entityId: string
): Promise<string | null> {
  const [e] = await db
    .select({ path: entities.path })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);
  if (!e) return null;
  return (await isBoardForPath(userId, e.path)) ? e.path : null;
}

export async function getUnitNote(entityId: string): Promise<UnitNoteDTO | null> {
  const [row] = await db
    .select({
      body: unitNotes.body,
      updatedAt: unitNotes.updatedAt,
      updatedByName: users.name,
    })
    .from(unitNotes)
    .leftJoin(users, eq(unitNotes.updatedById, users.id))
    .where(eq(unitNotes.entityId, entityId))
    .limit(1);
  return row
    ? {
        body: row.body,
        updatedAt: row.updatedAt.toISOString(),
        updatedByName: row.updatedByName,
      }
    : null;
}

export type UnitNoteResult =
  | { ok: true; note: UnitNoteDTO | null }
  | { ok: false; code: UnitNoteErrorCode; current?: UnitNoteDTO | null };

function sameVersion(current: Date | null, expected: string | null): boolean {
  if (!current) return expected === null;
  if (!expected) return false;
  return current.getTime() === Date.parse(expected);
}

/**
 * Create / edit with optimistic concurrency: `expectedUpdatedAt` is the
 * version the editor loaded (null = "there was no note"). A mismatch returns
 * `unit_note.conflict` plus the newer note so the UI can show it.
 * An empty body clears the note (same as clearUnitNote).
 */
export async function saveUnitNote(input: {
  entityId: string;
  actorUserId: string;
  body: string;
  expectedUpdatedAt: string | null;
}): Promise<UnitNoteResult> {
  const text = input.body.replace(/\r\n/g, "\n").trim();
  if (text.length > UNIT_NOTE_MAX_LENGTH) return { ok: false, code: "unit_note.too_long" };
  if (!text) return clearUnitNote(input);

  const conflict = await db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ id: unitNotes.id, body: unitNotes.body, updatedAt: unitNotes.updatedAt })
      .from(unitNotes)
      .where(eq(unitNotes.entityId, input.entityId))
      .for("update")
      .limit(1);
    if (!sameVersion(cur?.updatedAt ?? null, input.expectedUpdatedAt)) return true;

    const now = new Date();
    if (cur) {
      await tx
        .update(unitNotes)
        .set({ body: text, updatedById: input.actorUserId, updatedAt: now })
        .where(eq(unitNotes.id, cur.id));
    } else {
      const inserted = await tx
        .insert(unitNotes)
        .values({
          entityId: input.entityId,
          body: text,
          createdById: input.actorUserId,
          updatedById: input.actorUserId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: unitNotes.entityId })
        .returning({ id: unitNotes.id });
      // Lost a create race with another editor → treat as conflict.
      if (inserted.length === 0) return true;
    }
    await tx.insert(entityAuditLog).values({
      action: "unit_note.update",
      actorUserId: input.actorUserId,
      entityId: input.entityId,
      beforeJson: cur
        ? JSON.stringify({ length: cur.body.length, updatedAt: cur.updatedAt.toISOString() })
        : null,
      afterJson: JSON.stringify({ length: text.length, updatedAt: now.toISOString() }),
    });
    return false;
  });

  const note = await getUnitNote(input.entityId);
  return conflict ? { ok: false, code: "unit_note.conflict", current: note } : { ok: true, note };
}

/** Clear = delete the row (the undo path). Same concurrency guard. */
export async function clearUnitNote(input: {
  entityId: string;
  actorUserId: string;
  expectedUpdatedAt: string | null;
}): Promise<UnitNoteResult> {
  const conflict = await db.transaction(async (tx) => {
    const [cur] = await tx
      .select({ id: unitNotes.id, body: unitNotes.body, updatedAt: unitNotes.updatedAt })
      .from(unitNotes)
      .where(eq(unitNotes.entityId, input.entityId))
      .for("update")
      .limit(1);
    if (!cur) return false; // nothing to clear — idempotent
    if (!sameVersion(cur.updatedAt, input.expectedUpdatedAt)) return true;
    await tx
      .delete(unitNotes)
      .where(and(eq(unitNotes.id, cur.id), eq(unitNotes.entityId, input.entityId)));
    await tx.insert(entityAuditLog).values({
      action: "unit_note.clear",
      actorUserId: input.actorUserId,
      entityId: input.entityId,
      beforeJson: JSON.stringify({
        length: cur.body.length,
        updatedAt: cur.updatedAt.toISOString(),
      }),
      afterJson: null,
    });
    return false;
  });
  if (conflict) {
    return { ok: false, code: "unit_note.conflict", current: await getUnitNote(input.entityId) };
  }
  return { ok: true, note: null };
}
