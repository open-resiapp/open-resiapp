import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountingSettings } from "../db/schema";
import { listDomUnits } from "./dom-units";
import { listUnitBalances } from "./karta-bytu";

// Debtor disclosure (§11 zák. 182/1993) — the shromaždenie may approve
// publishing arrears above a threshold. Privacy-safe by construction:
//   - hidden entirely until a treasurer sets a threshold (null = off)
//   - shows the UNIT label + amount, never the owner's name
//   - derived live from journal balances (invariant 11), so a unit that
//     pays drops off immediately

type Country = "sk" | "cz";

export interface DebtorRow {
  unitLabel: string;
  balanceCents: number;
}

export interface DebtorList {
  enabled: boolean;
  thresholdCents: number | null;
  debtors: DebtorRow[];
}

async function currentThreshold(entityId: string): Promise<number | null> {
  const [row] = await db
    .select({ t: accountingSettings.debtorDisclosureThresholdCents })
    .from(accountingSettings)
    .where(
      and(
        eq(accountingSettings.entityId, entityId),
        sql`${accountingSettings.effectiveFrom} <= now()`
      )
    )
    .orderBy(desc(accountingSettings.effectiveFrom))
    .limit(1);
  return row?.t ?? null;
}

export async function getDebtorList(
  entityId: string,
  country: Country
): Promise<DebtorList> {
  const thresholdCents = await currentThreshold(entityId);
  if (thresholdCents === null) {
    return { enabled: false, thresholdCents: null, debtors: [] };
  }

  const units = await listDomUnits(entityId);
  const balances = await listUnitBalances(
    entityId,
    country,
    units.map((u) => u.id)
  );

  const debtors = units
    .map((u) => ({
      unitLabel: u.flatNumber ?? u.name,
      balanceCents: balances.get(u.id) ?? 0,
    }))
    // Positive balance = owes; at or above the approved threshold only.
    .filter((d) => d.balanceCents >= thresholdCents)
    .sort((a, b) => b.balanceCents - a.balanceCents);

  return { enabled: true, thresholdCents, debtors };
}
