import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities } from "@/db/schema";
import { votingItems, votings } from "@modules/voting/src/db/schema";
import {
  accountingPeriods,
  expenseInbox,
  payments,
  serviceCategories,
} from "../db/schema";
import { domUnitsWhere } from "./dom-units";

// Read-only lookups for the MCP pending-action previews and state checks
// (BYT-20261117-001 §5). Each returns the CURRENT state so a confirm can
// detect "changed since proposal" before calling the commit lib function.

/** Live unit of the dom with its display label, or null. */
export async function getDomUnitLabel(
  entityId: string,
  unitEntityId: string
): Promise<{ id: string; label: string } | null> {
  const [row] = await db
    .select({
      id: entities.id,
      name: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
    })
    .from(entities)
    .where(and(eq(entities.id, unitEntityId), domUnitsWhere(entityId)));
  return row ? { id: row.id, label: row.flatNumber ?? row.name } : null;
}

export interface BankLineState {
  id: string;
  source: string;
  amountCents: number;
  receivedAt: Date;
  vs: string | null;
  counterpartyName: string | null;
  narrative: string | null;
  matched: boolean;
  voided: boolean;
}

export async function getBankLineState(
  entityId: string,
  paymentId: string
): Promise<BankLineState | null> {
  const [row] = await db
    .select({
      id: payments.id,
      source: payments.source,
      amountCents: payments.amountCents,
      receivedAt: payments.receivedAt,
      vs: payments.vs,
      counterpartyName: payments.counterpartyName,
      narrative: payments.narrative,
      journalEntryId: payments.journalEntryId,
      voidedAt: payments.voidedAt,
    })
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.entityId, entityId)));
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    amountCents: row.amountCents,
    receivedAt: row.receivedAt,
    vs: row.vs,
    counterpartyName: row.counterpartyName,
    narrative: row.narrative,
    matched: row.journalEntryId !== null,
    voided: row.voidedAt !== null,
  };
}

export async function getInboxItemState(
  entityId: string,
  id: string
): Promise<{
  id: string;
  status: "pending" | "posted" | "dismissed";
  fileName: string;
  ocrAmountCents: number | null;
} | null> {
  const [row] = await db
    .select({
      id: expenseInbox.id,
      status: expenseInbox.status,
      fileName: expenseInbox.fileName,
      ocrAmountCents: expenseInbox.ocrAmountCents,
    })
    .from(expenseInbox)
    .where(and(eq(expenseInbox.id, id), eq(expenseInbox.entityId, entityId)));
  return row ?? null;
}

export async function getServiceCategory(
  id: string,
  country: "sk" | "cz"
): Promise<{ id: string; slug: string; okruh: string } | null> {
  const [row] = await db
    .select({
      id: serviceCategories.id,
      slug: serviceCategories.slug,
      okruh: serviceCategories.okruh,
    })
    .from(serviceCategories)
    .where(and(eq(serviceCategories.id, id), eq(serviceCategories.country, country)));
  return row ?? null;
}

/** The zhromaždenie vote item a závierka approval references. */
export async function getZavierkaVoteRef(
  entityId: string,
  votingItemId: string
): Promise<{
  votingId: string;
  votingTitle: string;
  itemTitle: string;
  status: string;
} | null> {
  const [row] = await db
    .select({
      votingId: votings.id,
      votingTitle: votings.title,
      itemTitle: votingItems.title,
      status: votings.status,
    })
    .from(votingItems)
    .innerJoin(votings, eq(votingItems.votingId, votings.id))
    .where(and(eq(votingItems.id, votingItemId), eq(votings.entityId, entityId)));
  return row ?? null;
}

export async function getPeriodStatus(
  entityId: string,
  year: number
): Promise<string | null> {
  const [row] = await db
    .select({ status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(and(eq(accountingPeriods.entityId, entityId), eq(accountingPeriods.year, year)));
  return row?.status ?? null;
}
