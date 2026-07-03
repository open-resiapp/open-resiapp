import "server-only";

import { and, eq } from "drizzle-orm";
import { accountingPeriods } from "../db/schema";
import type { Tx } from "../engine/booking";

// The ONE place that mints accounting periods. Period status gates every
// posting (domain invariant 4: published/locked periods are immutable),
// so the "get-or-create + must be open" rule must not fork per call site.

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
