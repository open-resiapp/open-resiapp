import "server-only";

import { randomUUID } from "crypto";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import { boardMembers, entities, users } from "@/db/schema";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { expenses } from "@modules/accounting/src/db/schema";

import { FAULT_CATEGORY_SLUGS } from "../engine/catalog";
import { faultCategories, faultContractors } from "../db/schema";

// Categories, contractors and assignable board users for one community.

export interface CategoryOption {
  id: string;
  slug: string;
  /** i18n key (seeded) — render with t(`category.${slug}`). */
  nameKey: string | null;
  customName: string | null;
}

/**
 * Seed the fixed catalog for `rootId`. Idempotent DML only (insert … on
 * conflict do nothing on the (root, slug) unique index) — multi-replica
 * safe, no DDL, no locks beyond the index.
 */
export async function ensureCategoryCatalog(rootId: string): Promise<void> {
  await db
    .insert(faultCategories)
    .values(
      FAULT_CATEGORY_SLUGS.map((slug, i) => ({
        rootEntityId: rootId,
        slug,
        nameKey: `Faults.category.${slug}`,
        sortOrder: (i + 1) * 10,
      }))
    )
    .onConflictDoNothing({ target: [faultCategories.rootEntityId, faultCategories.slug] });
}

export async function listCategories(rootId: string): Promise<CategoryOption[]> {
  let rows = await selectCategories(rootId);
  if (rows.length === 0) {
    await ensureCategoryCatalog(rootId);
    rows = await selectCategories(rootId);
  }
  return rows;
}

function selectCategories(rootId: string) {
  return db
    .select({
      id: faultCategories.id,
      slug: faultCategories.slug,
      nameKey: faultCategories.nameKey,
      customName: faultCategories.customName,
    })
    .from(faultCategories)
    .where(and(eq(faultCategories.rootEntityId, rootId), isNull(faultCategories.archivedAt)))
    .orderBy(asc(faultCategories.sortOrder), asc(faultCategories.createdAt));
}

export async function addCustomCategory(rootId: string, name: string): Promise<CategoryOption> {
  const [row] = await db
    .insert(faultCategories)
    .values({
      rootEntityId: rootId,
      slug: `custom-${randomUUID()}`,
      customName: name,
      sortOrder: 1000,
    })
    .returning({
      id: faultCategories.id,
      slug: faultCategories.slug,
      nameKey: faultCategories.nameKey,
      customName: faultCategories.customName,
    });
  return row;
}

export interface ContractorOption {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export async function listContractors(rootId: string): Promise<ContractorOption[]> {
  return db
    .select({
      id: faultContractors.id,
      name: faultContractors.name,
      phone: faultContractors.phone,
      email: faultContractors.email,
    })
    .from(faultContractors)
    .where(and(eq(faultContractors.rootEntityId, rootId), isNull(faultContractors.archivedAt)))
    .orderBy(asc(faultContractors.name));
}

export async function addContractor(
  rootId: string,
  input: { name: string; phone?: string | null; email?: string | null; ico?: string | null; note?: string | null }
): Promise<ContractorOption> {
  const [row] = await db
    .insert(faultContractors)
    .values({
      rootEntityId: rootId,
      name: input.name,
      phone: input.phone || null,
      email: input.email || null,
      ico: input.ico || null,
      note: input.note || null,
    })
    .returning({
      id: faultContractors.id,
      name: faultContractors.name,
      phone: faultContractors.phone,
      email: faultContractors.email,
    });
  return row;
}

export interface BoardUserOption {
  id: string;
  name: string;
  email: string | null;
}

/**
 * Active users who manage faults in `rootId`: flat admin / caretaker, plus
 * holders of an active board_members role. Assignee picker + digest
 * recipients.
 */
export async function listFaultManagers(rootId: string): Promise<BoardUserOption[]> {
  const boardIds = db
    .select({ id: boardMembers.userId })
    .from(boardMembers)
    .where(and(eq(boardMembers.entityId, rootId), eq(boardMembers.isActive, true)));
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.status, "active"),
        eq(users.isActive, true),
        or(inArray(users.role, ["admin", "caretaker"]), inArray(users.id, boardIds))
      )
    )
    .orderBy(asc(users.name));
}

export async function isFaultManager(rootId: string, userId: string): Promise<boolean> {
  const list = await listFaultManagers(rootId);
  return list.some((u) => u.id === userId);
}


export interface ExpenseOption {
  id: string;
  supplierName: string;
  invoiceNo: string;
  invoiceDate: string;
  amountCents: number;
}

/**
 * Expense picker (spec AC): non-voided accounting expenses of the same
 * community. Empty when accounting is disabled. Read-only query against the
 * accounting table; the link itself is a plain id (no cross-module FK).
 */
export async function listLinkableExpenses(rootId: string): Promise<ExpenseOption[]> {
  if (!(await isModuleEnabled("accounting"))) return [];
  const rows = await db
    .select({
      id: expenses.id,
      supplierName: expenses.supplierName,
      invoiceNo: expenses.invoiceNo,
      invoiceDate: expenses.invoiceDate,
      amountCents: expenses.amountCents,
    })
    .from(expenses)
    .innerJoin(entities, eq(entities.id, expenses.entityId))
    .where(and(isNull(expenses.voidedAt), or(eq(entities.rootId, rootId), eq(entities.id, rootId))))
    .orderBy(desc(expenses.invoiceDate))
    .limit(200);
  return rows.map((r) => ({ ...r, invoiceDate: r.invoiceDate.toISOString() }));
}
