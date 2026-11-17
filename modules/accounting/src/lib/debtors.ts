import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";
import { McpError } from "@/lib/mcp/errors";
import type { Principal } from "@/lib/mcp/principal";
import { accountingSettings } from "../db/schema";
import { domUnitsWhere, listDomUnits } from "./dom-units";
import { isAccountingReader } from "./authz";
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
  /** Present for the board audience only. */
  unitId?: string;
  unitLabel: string;
  balanceCents: number;
  /** Owner names when statutory disclosure applies; null = not disclosed. */
  ownerNames: string[] | null;
}

/**
 * Who the list is built for (BYT-20261117-001 Decided 2):
 *   - "board": treasurer / chairman / admin — every unit in debt, with
 *     owner names, regardless of the disclosure settings or unit ownership.
 *   - "owner": a dom owner — the §11 disclosure view (threshold + SK 500 €
 *     name rule).
 */
export type DebtorAudience = "board" | "owner";

export interface DebtorList {
  audience: DebtorAudience;
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
      audience: "owner",
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
    audience: "owner",
    enabled: true,
    thresholdCents,
    namesEnabled: namesActive,
    nameThresholdCents: SK_DEBTOR_NAME_THRESHOLD_CENTS,
    debtors,
  };
}

/**
 * Board view (Decided 2): every unit with a positive balance (= debt), with
 * all active owner names. Internal to the board — not the §11 publication,
 * so neither the disclosure threshold nor the 500 € name rule applies.
 * `thresholdCents: 0` / `namesEnabled: true` keep the UI payload shape.
 */
export async function getBoardDebtorList(
  entityId: string,
  country: Country
): Promise<DebtorList> {
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
    .filter((d) => d.balanceCents > 0)
    .sort((a, b) => b.balanceCents - a.balanceCents);
  const namesByUnit = await ownerNamesForUnits(debtorsRaw.map((d) => d.unitId));
  return {
    audience: "board",
    enabled: true,
    thresholdCents: 0,
    namesEnabled: true,
    nameThresholdCents: SK_DEBTOR_NAME_THRESHOLD_CENTS,
    debtors: debtorsRaw.map((d) => ({
      unitId: d.unitId,
      unitLabel: d.unitLabel,
      balanceCents: d.balanceCents,
      ownerNames: namesByUnit.get(d.unitId) ?? [],
    })),
  };
}

/** Does the user hold an active OWNER membership on any unit of the dom? */
async function isDomOwner(userId: string, entityId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active"),
        domUnitsWhere(entityId)
      )
    )
    .limit(1);
  return !!row;
}

/** Which debtor view the principal gets; null = no access. */
export async function resolveDebtorAudience(
  p: Pick<Principal, "userId" | "role" | "status" | "entityId" | "boardRoles">
): Promise<DebtorAudience | null> {
  if (p.status !== "active") return null;
  if (isAccountingReader(p.role, p.boardRoles)) return "board";
  if (await isDomOwner(p.userId, p.entityId)) return "owner";
  return null;
}

/**
 * Debtor list for a principal — shared by GET /api/accounting/debtors and
 * the MCP `list_debtors` tool. Throws McpError("forbidden") for anyone who
 * is neither a reader nor a dom owner (e.g. tenants).
 */
export async function getDebtorListForPrincipal(
  p: Pick<Principal, "userId" | "role" | "status" | "entityId" | "boardRoles">,
  country: Country
): Promise<DebtorList> {
  const audience = await resolveDebtorAudience(p);
  if (!audience) throw new McpError("forbidden");
  return audience === "board"
    ? getBoardDebtorList(p.entityId, country)
    : getDebtorList(p.entityId, country);
}
