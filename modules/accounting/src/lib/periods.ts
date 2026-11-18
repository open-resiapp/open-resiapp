import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods } from "../db/schema";
import type { Tx } from "../engine/booking";

// The ONE place that mints accounting periods. Period status gates every
// posting (domain invariant 4: published/locked periods are immutable),
// so the "get-or-create + must be open" rule must not fork per call site.

/**
 * Locks every OPEN period row of the dom (FOR UPDATE). The shared
 * serialization anchor: postings, voids, credit applications and
 * publishes all take these locks first, so no two money-mutating
 * transactions interleave per dom.
 */
export async function lockOpenPeriods(
  tx: Tx,
  entityId: string
): Promise<void> {
  await tx
    .select({ id: accountingPeriods.id })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        eq(accountingPeriods.status, "open")
      )
    )
    // Deterministic lock order: two transactions locking the same rows in
    // a different order could deadlock.
    .orderBy(asc(accountingPeriods.id))
    .for("update");
}

/**
 * The period a CORRECTION (void reversal, credit application) posts into:
 * the receivedAt/original year is irrelevant — corrections always go to
 * the earliest open period from the current year forward (domain
 * invariant 4). Creates the current-year period when none exists; walks
 * forward past non-open years (year-close scenario).
 */
export async function getCurrentOpenPeriod(
  tx: Tx,
  entityId: string
): Promise<{ id: string; status: string }> {
  const currentYear = new Date().getUTCFullYear();
  for (let year = currentYear; year < currentYear + 5; year++) {
    const [existing] = await tx
      .select({ id: accountingPeriods.id, status: accountingPeriods.status })
      .from(accountingPeriods)
      .where(
        and(
          eq(accountingPeriods.entityId, entityId),
          eq(accountingPeriods.year, year)
        )
      );
    if (!existing) {
      return getOrCreateOpenPeriod(tx, entityId, year);
    }
    if (existing.status === "open") return existing;
  }
  throw new Error(
    "accounting: no open period found in the next 5 years — reopen or create one"
  );
}

/**
 * The period a payment received at `receivedAt` books into: the
 * receivedAt year when that period already exists and is open, otherwise
 * the current open period (never minting past-year periods — they would
 * predate the opening balance). ONE rule for manual entry, bank import
 * and reconciliation — the same December payment must land in the same
 * fiscal year regardless of the entry path.
 */
export async function periodForReceivedAt(
  tx: Tx,
  entityId: string,
  receivedAt: Date
): Promise<{ id: string; status: string }> {
  const receivedYear = receivedAt.getUTCFullYear();
  const [receivedPeriod] = await tx
    .select({ id: accountingPeriods.id, status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        eq(accountingPeriods.year, receivedYear)
      )
    );
  if (receivedPeriod?.status === "open") return receivedPeriod;
  return getCurrentOpenPeriod(tx, entityId);
}

export async function getOrCreateOpenPeriod(
  tx: Tx,
  entityId: string,
  year: number
): Promise<{ id: string; status: string }> {
  // Insert-first with onConflictDoNothing closes the concurrent-create
  // race on the (entityId, year) unique index; the follow-up select reads
  // whichever row won.
  await tx
    .insert(accountingPeriods)
    .values({ entityId, year })
    .onConflictDoNothing();
  const [period] = await tx
    .select({ id: accountingPeriods.id, status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        eq(accountingPeriods.year, year)
      )
    );
  if (!period) {
    throw new Error(`accounting: period ${year} could not be created`);
  }
  if (period.status !== "open") {
    throw new Error(
      `accounting: period ${year} is ${period.status} — corrections post as reversals in the current open period`
    );
  }
  return period;
}

/**
 * Read-only view of where a dated document books (no period is minted):
 * `openYears` — years whose period exists and is open (a document dated
 * there books into its own year); `fallbackYear` — where everything else
 * books per periodForReceivedAt / getCurrentOpenPeriod (the earliest open
 * or not-yet-created period from the current year on). The expense form
 * uses it to warn that an invoice of a locked year lands in — and is
 * settled with — the fallback year's vyúčtovanie.
 */
export async function getPeriodBookingInfo(entityId: string): Promise<{
  openYears: number[];
  lockedYears: number[];
  fallbackYear: number | null;
}> {
  const rows = await db
    .select({ year: accountingPeriods.year, status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.entityId, entityId))
    .orderBy(asc(accountingPeriods.year));
  const byYear = new Map(rows.map((r) => [r.year, r.status]));
  const currentYear = new Date().getUTCFullYear();
  let fallbackYear: number | null = null;
  for (let year = currentYear; year < currentYear + 5; year++) {
    const status = byYear.get(year);
    if (!status || status === "open") {
      fallbackYear = year;
      break;
    }
  }
  return {
    openYears: rows.filter((r) => r.status === "open").map((r) => r.year),
    lockedYears: rows.filter((r) => r.status !== "open").map((r) => r.year),
    fallbackYear,
  };
}
