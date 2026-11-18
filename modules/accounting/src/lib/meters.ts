import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { meterReadings, auditLog, readingRounds } from "../db/schema";
import { canReadUnitLedger, getUnitReadScope } from "./karta-bytu";
import { inScope, todayIso } from "./ownership-windows";
import { canWriteAccounting } from "./authz";
import { domUnitsWhere } from "./dom-units";
import { entities, memberships } from "@/db/schema";
import type { Tx } from "../engine/booking";
import { ReadingError } from "./reading-rounds-format";
import { assertReadingYearOpen, utcYear } from "./reading-lock";

// Meter readings (BYT-20260512-002 Phase 4 input + owner self-service).
// Owners enter readings for their OWN units (same scoping as karta bytu);
// treasurer/admin for any unit. Corrections: void (audit-logged) + enter
// anew — vyúčtovanie reads non-voided rows only.
//
// BYT-20261118-006: errors are stable ReadingError codes (never prose), and
// every write rejects with `period_locked` once the reading's year is locked
// (reading-lock.ts) — this also covers the MCP submit_meter_reading action.

export type MeterType = "heat" | "water_cold" | "water_hot" | "electricity";

export const METER_TYPES: MeterType[] = [
  "heat",
  "water_cold",
  "water_hot",
  "electricity",
];

export interface MeterReadingRow {
  id: string;
  unitEntityId: string;
  meterType: MeterType;
  readingDate: string;
  valueMilli: number;
  createdById: string;
}

export async function listReadingsForUnit(
  entityId: string,
  unitEntityId: string
): Promise<MeterReadingRow[]> {
  const rows = await db
    .select({
      id: meterReadings.id,
      unitEntityId: meterReadings.unitEntityId,
      meterType: meterReadings.meterType,
      readingDate: meterReadings.readingDate,
      valueMilli: meterReadings.valueMilli,
      createdById: meterReadings.createdById,
    })
    .from(meterReadings)
    .where(
      and(
        eq(meterReadings.entityId, entityId),
        eq(meterReadings.unitEntityId, unitEntityId),
        isNull(meterReadings.voidedAt)
      )
    )
    .orderBy(desc(meterReadings.readingDate), desc(meterReadings.createdAt));
  return rows.map((r) => ({
    ...r,
    readingDate: r.readingDate.toISOString(),
  }));
}

/**
 * A unit's readings as the viewer may see them (BYT-20261118-012): board
 * readers all, an owner only readings dated inside their own ownership
 * windows (a buyer never sees the seller's readings). null = no access.
 * Shared by GET /api/accounting/meters and the MCP list_meter_readings tool.
 */
export async function listReadingsForViewer(input: {
  userId: string;
  userRole: string;
  entityId: string;
  unitEntityId: string;
}): Promise<MeterReadingRow[] | null> {
  const scope = await getUnitReadScope(
    input.userId,
    input.userRole,
    input.entityId,
    input.unitEntityId
  );
  if (!scope) return null;
  const rows = await listReadingsForUnit(input.entityId, input.unitEntityId);
  return rows.filter((r) => inScope(r.readingDate, scope.windows));
}

/** Owner-of-unit OR board writer/reader may READ a unit's readings. */
export async function canEnterReading(
  userId: string,
  userRole: string,
  entityId: string,
  unitEntityId: string
): Promise<boolean> {
  // Same access surface as the unit ledger: board roles + owning members.
  return canReadUnitLedger(userId, userRole, entityId, unitEntityId);
}

/**
 * Owner of the unit TODAY (no board shortcut): active owner membership
 * whose validity [valid_from, valid_to) contains today — a future buyer
 * may not write yet, a seller whose ownership ended may not any more
 * (BYT-20261118-007 windows; same rule as listOwnedUnits).
 */
export async function isUnitOwner(
  userId: string,
  unitEntityId: string
): Promise<boolean> {
  const today = todayIso();
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.entityId, unitEntityId),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active"),
        sql`${memberships.validFrom} <= ${today}::date`,
        sql`(${memberships.validTo} IS NULL OR ${memberships.validTo} > ${today}::date)`
      )
    )
    .limit(1);
  return Boolean(row);
}

/**
 * WRITE access to a unit's readings: board writers (treasurer / admin) for
 * any unit, owners for their own. Board readers (chairman) only read —
 * spec AC "board readers get 403 on every write".
 */
export async function canWriteReadingForUnit(
  userId: string,
  userRole: string,
  entityId: string,
  unitEntityId: string
): Promise<boolean> {
  if (await canWriteAccounting(userId, userRole, entityId)) return true;
  return isUnitOwner(userId, unitEntityId);
}

export interface CreateReadingInput {
  entityId: string;
  unitEntityId: string;
  meterType: MeterType;
  readingDate: Date;
  valueMilli: number;
  actorId: string;
  /** Audit-log justification, e.g. "MCP: Claude" for AI-proposed writes. */
  justification?: string | null;
  roundId?: string | null;
  photoStorageKey?: string | null;
  note?: string | null;
  late?: boolean;
}

/** Validation shared by every create path (throws ReadingError). */
function assertReadingValues(input: { valueMilli: number; readingDate: Date }) {
  if (!Number.isInteger(input.valueMilli)) {
    throw new ReadingError("value_invalid");
  }
  if (input.valueMilli < 0) throw new ReadingError("value_negative");
  if (input.valueMilli > 2_147_483_647) throw new ReadingError("value_invalid");
  if (Number.isNaN(input.readingDate.getTime())) {
    throw new ReadingError("date_outside_round");
  }
  if (input.readingDate.getTime() > Date.now() + 24 * 3600 * 1000) {
    throw new ReadingError("date_in_future");
  }
}

/** Insert inside a caller's transaction (edit = void + insert in one tx). */
export async function insertReadingTx(
  tx: Tx,
  input: CreateReadingInput
): Promise<{ id: string }> {
  assertReadingValues(input);
  await assertReadingYearOpen(input.entityId, utcYear(input.readingDate), tx);

  const [unit] = await tx
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(eq(entities.id, input.unitEntityId), domUnitsWhere(input.entityId))
    );
  if (!unit) throw new ReadingError("unknown_unit");

  const [reading] = await tx
    .insert(meterReadings)
    .values({
      entityId: input.entityId,
      unitEntityId: input.unitEntityId,
      meterType: input.meterType,
      readingDate: input.readingDate,
      valueMilli: input.valueMilli,
      roundId: input.roundId ?? null,
      photoStorageKey: input.photoStorageKey ?? null,
      note: input.note ?? null,
      late: input.late ?? false,
      createdById: input.actorId,
    })
    .returning({ id: meterReadings.id });

  await tx.insert(auditLog).values({
    entityId: input.entityId,
    actorId: input.actorId,
    action: "insert",
    tableName: "mod_accounting_meter_readings",
    recordId: reading.id,
    after: {
      unitEntityId: input.unitEntityId,
      meterType: input.meterType,
      readingDate: input.readingDate.toISOString(),
      valueMilli: input.valueMilli,
      roundId: input.roundId ?? null,
      photo: Boolean(input.photoStorageKey),
      late: input.late ?? false,
    },
    justification: input.justification ?? null,
  });

  return { id: reading.id };
}

export async function createReading(
  input: CreateReadingInput
): Promise<{ id: string }> {
  assertReadingValues(input);
  return db.transaction((tx) => insertReadingTx(tx, input));
}

/**
 * Voids a reading inside a caller's transaction. Owners may void their OWN
 * entries only while owner-editable (not resolved, round still open for
 * owners); board writers any. Every void is audit-logged.
 */
export async function voidReadingTx(
  tx: Tx,
  input: {
    entityId: string;
    readingId: string;
    actorId: string;
    isWriter: boolean;
    justification?: string;
  }
): Promise<{ unitEntityId: string; meterType: MeterType; roundId: string | null }> {
  const [reading] = await tx
    .select({
      unitEntityId: meterReadings.unitEntityId,
      createdById: meterReadings.createdById,
      voidedAt: meterReadings.voidedAt,
      meterType: meterReadings.meterType,
      valueMilli: meterReadings.valueMilli,
      readingDate: meterReadings.readingDate,
      roundId: meterReadings.roundId,
      resolvedAt: meterReadings.resolvedAt,
    })
    .from(meterReadings)
    .where(
      and(
        eq(meterReadings.id, input.readingId),
        eq(meterReadings.entityId, input.entityId)
      )
    )
    .for("update");
  if (!reading) throw new ReadingError("not_found");
  if (reading.voidedAt) throw new ReadingError("already_voided");

  await assertReadingYearOpen(input.entityId, utcYear(reading.readingDate), tx);

  if (!input.isWriter) {
    if (reading.createdById !== input.actorId) {
      throw new ReadingError("forbidden");
    }
    if (reading.resolvedAt) throw new ReadingError("submission_locked");
    if (reading.roundId) {
      const [round] = await tx
        .select({
          closedForOwnersAt: readingRounds.closedForOwnersAt,
          deadlineAt: readingRounds.deadlineAt,
          allowLate: readingRounds.allowLate,
        })
        .from(readingRounds)
        .where(eq(readingRounds.id, reading.roundId));
      if (
        round &&
        (round.closedForOwnersAt ||
          (!round.allowLate && round.deadlineAt.getTime() < Date.now()))
      ) {
        throw new ReadingError("submission_locked");
      }
    }
  }

  await tx
    .update(meterReadings)
    .set({ voidedAt: new Date(), voidedById: input.actorId })
    .where(eq(meterReadings.id, input.readingId));

  await tx.insert(auditLog).values({
    entityId: input.entityId,
    actorId: input.actorId,
    action: "void",
    tableName: "mod_accounting_meter_readings",
    recordId: input.readingId,
    before: {
      unitEntityId: reading.unitEntityId,
      meterType: reading.meterType,
      valueMilli: reading.valueMilli,
      readingDate: reading.readingDate.toISOString(),
    },
    after: { voidedAt: true },
    justification: input.justification ?? "reading voided (correction by re-entry)",
  });

  return {
    unitEntityId: reading.unitEntityId,
    meterType: reading.meterType,
    roundId: reading.roundId,
  };
}

/**
 * Voids a reading. Owners may void their OWN entries; board writers any.
 * (Mutable-record AC: mis-entered readings correct by void + re-entry.)
 */
export async function voidReading(input: {
  entityId: string;
  readingId: string;
  actorId: string;
  actorRole: string;
}): Promise<void> {
  const isWriter = await canWriteAccounting(
    input.actorId,
    input.actorRole,
    input.entityId
  );
  await db.transaction((tx) =>
    voidReadingTx(tx, {
      entityId: input.entityId,
      readingId: input.readingId,
      actorId: input.actorId,
      isWriter,
    })
  );
}
