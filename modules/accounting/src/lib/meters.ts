import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { meterReadings, auditLog } from "../db/schema";
import { canReadUnitLedger } from "./karta-bytu";
import { canWriteAccounting } from "./authz";
import { domUnitsWhere } from "./dom-units";
import { entities } from "@/db/schema";

// Meter readings (BYT-20260512-002 Phase 4 input + owner self-service).
// Owners enter readings for their OWN units (same scoping as karta bytu);
// treasurer/admin for any unit. Corrections: void (audit-logged) + enter
// anew — vyúčtovanie reads non-voided rows only.

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

/** Owner-of-unit OR board writer/reader may touch a unit's readings. */
export async function canEnterReading(
  userId: string,
  userRole: string,
  entityId: string,
  unitEntityId: string
): Promise<boolean> {
  // Same access surface as the unit ledger: board roles + owning members.
  return canReadUnitLedger(userId, userRole, entityId, unitEntityId);
}

export async function createReading(input: {
  entityId: string;
  unitEntityId: string;
  meterType: MeterType;
  readingDate: Date;
  valueMilli: number;
  actorId: string;
}): Promise<{ id: string }> {
  if (!Number.isInteger(input.valueMilli) || input.valueMilli < 0) {
    throw new Error("accounting: reading value must be >= 0");
  }
  if (input.readingDate.getTime() > Date.now() + 24 * 3600 * 1000) {
    throw new Error("accounting: reading date cannot be in the future");
  }

  return db.transaction(async (tx) => {
    const [unit] = await tx
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(eq(entities.id, input.unitEntityId), domUnitsWhere(input.entityId))
      );
    if (!unit) throw new Error("accounting: unknown unit");

    const [reading] = await tx
      .insert(meterReadings)
      .values({
        entityId: input.entityId,
        unitEntityId: input.unitEntityId,
        meterType: input.meterType,
        readingDate: input.readingDate,
        valueMilli: input.valueMilli,
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
      },
    });

    return { id: reading.id };
  });
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
  await db.transaction(async (tx) => {
    const [reading] = await tx
      .select({
        unitEntityId: meterReadings.unitEntityId,
        createdById: meterReadings.createdById,
        voidedAt: meterReadings.voidedAt,
      })
      .from(meterReadings)
      .where(
        and(
          eq(meterReadings.id, input.readingId),
          eq(meterReadings.entityId, input.entityId)
        )
      )
      .for("update");
    if (!reading) throw new Error("accounting: reading not found");
    if (reading.voidedAt) throw new Error("accounting: reading already voided");

    const isWriter = await canWriteAccounting(
      input.actorId,
      input.actorRole,
      input.entityId
    );
    if (!isWriter && reading.createdById !== input.actorId) {
      throw new Error("accounting: forbidden");
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
      justification: "reading voided (correction by re-entry)",
    });
  });
}
