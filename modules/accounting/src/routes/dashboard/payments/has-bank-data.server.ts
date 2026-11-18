import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { payments } from "@modules/accounting/src/db/schema";
import { getFioConnection } from "@modules/accounting/src/lib/fio";
import { getEnableBankingConnection } from "@modules/accounting/src/lib/enable-banking";

/**
 * Whether the dom already brings payments in from the bank (an active Fio or
 * Enable Banking connection, or at least one imported bank line). Decides the default tab of
 * Platby od vlastníkov. Read-only; returns a boolean only — the tab content
 * itself is still served by the role-guarded APIs.
 */
export async function hasBankData(): Promise<boolean> {
  const root = await getCommunityRoot();
  if (!root) return false;
  const [fio, eb, imported] = await Promise.all([
    getFioConnection(root.id),
    getEnableBankingConnection(root.id),
    db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.entityId, root.id),
          inArray(payments.source, ["bank_import", "fio_api", "enable_banking_api"])
        )
      )
      .limit(1),
  ]);
  return fio.connected || eb.connected || imported.length > 0;
}
