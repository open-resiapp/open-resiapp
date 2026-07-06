import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { memberships, users } from "@/db/schema";
import { accountingSettings } from "../db/schema";
import { listDomUnits } from "./dom-units";
import { listUnitBalances } from "./karta-bytu";
import {
  discloseDebtorName,
  SK_DEBTOR_NAME_THRESHOLD_CENTS,
} from "./debtor-disclosure";

// Debtor disclosure (§11 zák. 182/1993) — the shromaždenie may approve
// publishing arrears above a threshold. Privacy-safe by construction:
//   - hidden entirely until a treasurer sets a threshold (null = off)
//   - shows the UNIT label + amount, never the owner's name by default
//   - derived live from journal balances (invariant 11), so a unit that
//     pays drops off immediately
//
// AC 425 (SK only, §9 ods. 3): if the treasurer additionally turns on
// `debtorNamesEnabled`, owner NAMES + sumy are revealed — but ONLY for units
// whose nedoplatok is at/above the statutory 500 €. Below that (or CZ, or
// toggle off) it stays unit + amount only.

type Country = "sk" | "cz";

export interface DebtorRow {
  unitLabel: string;
  balanceCents: number;
  /** Owner names when statutory disclosure applies; null = not disclosed. */
  ownerNames: string[] | null;
}

export interface DebtorList {
  enabled: boolean;
  thresholdCents: number | null;
  /** Whether SK name disclosure is active (informs the UI legend). */
  namesEnabled: boolean;
  /** The statutory name-disclosure threshold (500 €), for the UI legend. */
  nameThresholdCents: number;
  debtors: DebtorRow[];
}

async function currentSettings(
  entityId: string
): Promise<{ thresholdCents: number | null; namesEnabled: boolean }> {
  const [row] = await db
    .select({
      t: accountingSettings.debtorDisclosureThresholdCents,
      names: accountingSettings.debtorNamesEnabled,
    })
    .from(accountingSettings)
    .where(
      and(
        eq(accountingSettings.entityId, entityId),
        sql`${accountingSettings.effectiveFrom} <= now()`
      )
    )
    .orderBy(desc(accountingSettings.effectiveFrom))
    .limit(1);
  return { thresholdCents: row?.t ?? null, namesEnabled: row?.names ?? false };
}

/** Active owner names per unit entity id (co-ownership → multiple names). */
async function ownerNamesForUnits(
  unitEntityIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (unitEntityIds.length === 0) return map;
  const rows = await db
    .select({ unitEntityId: memberships.entityId, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        inArray(memberships.entityId, unitEntityIds),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active")
      )
    );
  for (const r of rows) {
    if (!r.name) continue;
    const list = map.get(r.unitEntityId) ?? [];
    list.push(r.name);
    map.set(r.unitEntityId, list);
  }
  return map;
}

export async function getDebtorList(
  entityId: string,
  country: Country
): Promise<DebtorList> {
  const { thresholdCents, namesEnabled } = await currentSettings(entityId);
  const namesActive = namesEnabled && country === "sk";
  if (thresholdCents === null) {
    return {
      enabled: false,
      thresholdCents: null,
      namesEnabled: namesActive,
      nameThresholdCents: SK_DEBTOR_NAME_THRESHOLD_CENTS,
      debtors: [],
    };
  }

  const units = await listDomUnits(entityId);
  const balances = await listUnitBalances(
    entityId,
    country,
    units.map((u) => u.id)
  );

  const debtorsRaw = units
    .map((u) => ({
      unitId: u.id,
      unitLabel: u.flatNumber ?? u.name,
      balanceCents: balances.get(u.id) ?? 0,
    }))
    // Positive balance = owes; at or above the approved threshold only.
    .filter((d) => d.balanceCents >= thresholdCents)
    .sort((a, b) => b.balanceCents - a.balanceCents);

  // Which of those debtors additionally cross the statutory 500 € so their
  // names may be disclosed (SK + toggle on).
  const discloseUnitIds = debtorsRaw
    .filter((d) =>
      discloseDebtorName({
        namesEnabled,
        country,
        balanceCents: d.balanceCents,
      })
    )
    .map((d) => d.unitId);
  const namesByUnit = await ownerNamesForUnits(discloseUnitIds);
  const discloseSet = new Set(discloseUnitIds);

  const debtors: DebtorRow[] = debtorsRaw.map((d) => ({
    unitLabel: d.unitLabel,
    balanceCents: d.balanceCents,
    ownerNames: discloseSet.has(d.unitId)
      ? namesByUnit.get(d.unitId) ?? []
      : null,
  }));

  return {
    enabled: true,
    thresholdCents,
    namesEnabled: namesActive,
    nameThresholdCents: SK_DEBTOR_NAME_THRESHOLD_CENTS,
    debtors,
  };
}
