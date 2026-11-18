import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, settlements } from "../db/schema";
import type { Tx } from "../engine/booking";
import { ReadingError } from "./reading-rounds-format";

// Year lock for meter readings / person-months / building meters / rounds
// (BYT-20261118-006 §Lock). A year is read-only — for owners AND the board
// — once its period left `open` (reconciling | published | closed: a draft
// settlement may already have used the data, decision 2026-11-18) or a
// settlement row exists for it. Reads and export stay available.

type Executor = Tx | typeof db;

export async function isReadingYearLocked(
  entityId: string,
  year: number,
  executor: Executor = db
): Promise<boolean> {
  const [period] = await executor
    .select({ id: accountingPeriods.id, status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        eq(accountingPeriods.year, year)
      )
    );
  if (!period) return false;
  if (period.status !== "open") return true;
  const [settlement] = await executor
    .select({ id: settlements.id })
    .from(settlements)
    .where(eq(settlements.periodId, period.id))
    .limit(1);
  return Boolean(settlement);
}

/** Throws `period_locked` when the year is locked. */
export async function assertReadingYearOpen(
  entityId: string,
  year: number,
  executor: Executor = db
): Promise<void> {
  if (await isReadingYearLocked(entityId, year, executor)) {
    throw new ReadingError("period_locked");
  }
}

export function utcYear(d: Date): number {
  return d.getUTCFullYear();
}
