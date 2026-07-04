import "server-only";

import { and, eq } from "drizzle-orm";
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
