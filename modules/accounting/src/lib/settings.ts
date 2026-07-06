import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { validateBankAccount } from "bysquare/pay";
import { db } from "@/db";
import { accountingSettings, serviceCategories, auditLog } from "../db/schema";
import { isValidIban, normalizeIban } from "./iban";

// Accounting settings (spec: allocation strategy persists per HOA and is
// auditable; append-only — every change inserts a new effective-from row,
// history stays intact). Current settings = latest effectiveFrom <= now.

type Country = "sk" | "cz";

export interface AccountingSettingsView {
  allocationStrategy: "proportional" | "priority_ordered";
  priorityOrder: string[];
  bankIban: string | null;
  /** Day of month the predpis is due (1–28); null = last day of month. */
  dueDay: number | null;
  /** Arrears threshold in cents for owner-visible debtor list; null = off. */
  debtorDisclosureThresholdCents: number | null;
  /** Heat základní složka percent (vyhláška 269/2015); null = default 40. */
  heatBasicSharePct: number | null;
  /** Full catalog for the priority-order editor. */
  categorySlugs: string[];
}

export async function getAccountingSettings(
  entityId: string,
  country: Country
): Promise<AccountingSettingsView> {
  const [row] = await db
    .select({
      allocationStrategy: accountingSettings.allocationStrategy,
      priorityOrder: accountingSettings.priorityOrder,
      bankIban: accountingSettings.bankIban,
      dueDay: accountingSettings.dueDay,
      debtorDisclosureThresholdCents:
        accountingSettings.debtorDisclosureThresholdCents,
      heatBasicSharePct: accountingSettings.heatBasicSharePct,
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

  const categories = await db
    .select({ slug: serviceCategories.slug })
    .from(serviceCategories)
    .where(eq(serviceCategories.country, country))
    .orderBy(serviceCategories.sortOrder);

  return {
    allocationStrategy: row?.allocationStrategy ?? "proportional",
    priorityOrder: Array.isArray(row?.priorityOrder)
      ? (row.priorityOrder as string[])
      : [],
    bankIban: row?.bankIban ?? null,
    dueDay: row?.dueDay ?? null,
    debtorDisclosureThresholdCents:
      row?.debtorDisclosureThresholdCents ?? null,
    heatBasicSharePct: row?.heatBasicSharePct ?? null,
    categorySlugs: categories.map((c) => c.slug),
  };
}

export async function updateAccountingSettings(input: {
  entityId: string;
  country: Country;
  actorId: string;
  allocationStrategy: "proportional" | "priority_ordered";
  priorityOrder: string[];
  bankIban: string | null;
  dueDay: number | null;
  debtorDisclosureThresholdCents: number | null;
  heatBasicSharePct: number | null;
}): Promise<void> {
  if (
    input.dueDay !== null &&
    (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 28)
  ) {
    throw new Error("accounting: due day must be 1-28 or empty (end of month)");
  }
  if (
    input.heatBasicSharePct !== null &&
    (!Number.isInteger(input.heatBasicSharePct) ||
      input.heatBasicSharePct < 0 ||
      input.heatBasicSharePct > 100)
  ) {
    throw new Error("accounting: heat basic share must be 0-100 % or empty");
  }
  if (
    input.debtorDisclosureThresholdCents !== null &&
    (!Number.isInteger(input.debtorDisclosureThresholdCents) ||
      input.debtorDisclosureThresholdCents < 0)
  ) {
    throw new Error("accounting: debtor threshold must be a non-negative amount");
  }
  let iban: string | null = null;
  if (input.bankIban !== null && input.bankIban.trim() !== "") {
    iban = normalizeIban(input.bankIban);
    if (!iban || !isValidIban(iban)) {
      throw new Error("accounting: invalid IBAN (MOD-97 check failed)");
    }
    // Same validator the PAY by square encoder runs — a mismatch here
    // would accept the IBAN at write time and then fail every predpis
    // PDF at read time.
    try {
      validateBankAccount({ iban }, "bankAccount");
    } catch {
      throw new Error("accounting: invalid IBAN (bank registry check failed)");
    }
  }

  // Priority order is validated + persisted regardless of the active
  // strategy — switching proportional → priority_ordered must restore the
  // treasurer's arranged order, not silently reset to catalog default.
  if (input.priorityOrder.length > 0) {
    const valid = await db
      .select({ slug: serviceCategories.slug })
      .from(serviceCategories)
      .where(eq(serviceCategories.country, input.country));
    const known = new Set(valid.map((v) => v.slug));
    for (const slug of input.priorityOrder) {
      if (!known.has(slug)) {
        throw new Error(`accounting: unknown category ${slug} in priority order`);
      }
    }
  }

  await db.transaction(async (tx) => {
    await tx.insert(accountingSettings).values({
      entityId: input.entityId,
      allocationStrategy: input.allocationStrategy,
      priorityOrder:
        input.priorityOrder.length > 0 ? input.priorityOrder : null,
      bankIban: iban,
      dueDay: input.dueDay,
      debtorDisclosureThresholdCents: input.debtorDisclosureThresholdCents,
      heatBasicSharePct: input.heatBasicSharePct,
      // DB clock, not app clock — reads filter with `effectiveFrom <=
      // now()` on Postgres time; app-clock skew would hide a fresh row.
      effectiveFrom: sql`now()`,
      createdById: input.actorId,
    });
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_settings",
      recordId: input.entityId,
      after: {
        allocationStrategy: input.allocationStrategy,
        priorityOrder: input.priorityOrder,
        bankIban: iban,
        dueDay: input.dueDay,
        debtorDisclosureThresholdCents: input.debtorDisclosureThresholdCents,
        heatBasicSharePct: input.heatBasicSharePct,
      },
    });
  });
}
