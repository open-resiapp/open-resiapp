import "server-only";

import { and, desc, eq, isNotNull, isNull, like } from "drizzle-orm";
import { db } from "@/db";
import { expenses, serviceCategories } from "../db/schema";
import {
  daysUntil,
  statusFor,
  type RevisionRow,
} from "./revisions-format";

// Technical-audit (revízie) expiry tracking — BYT-20260512-002 Phase 3.
// A revízia is an expense in a REVIZIA_* category carrying the statutory
// next-inspection deadline (nextInspectionDueAt). This surfaces the
// LATEST inspection per category with a computed status so the treasurer
// never misses a deadline (an expired elektro/plyn/výťah revízia is a
// safety + liability problem). Pure status/ICS helpers live in
// revisions-format.ts; re-exported for convenience.
export {
  buildRevisionsIcs,
  type RevisionRow,
  type RevisionStatus,
} from "./revisions-format";

type Country = "sk" | "cz";

/**
 * Latest revízia per REVIZIA_* category (non-voided, with a due date),
 * newest inspection wins. `now` is injectable for tests.
 */
export async function listRevisions(
  entityId: string,
  country: Country,
  now: Date = new Date()
): Promise<RevisionRow[]> {
  const rows = await db
    .select({
      categorySlug: serviceCategories.slug,
      supplierName: expenses.supplierName,
      invoiceDate: expenses.invoiceDate,
      nextInspectionDueAt: expenses.nextInspectionDueAt,
    })
    .from(expenses)
    .innerJoin(
      serviceCategories,
      eq(expenses.serviceCategoryId, serviceCategories.id)
    )
    .where(
      and(
        eq(expenses.entityId, entityId),
        eq(serviceCategories.country, country),
        like(serviceCategories.slug, "REVIZIA_%"),
        isNull(expenses.voidedAt),
        isNotNull(expenses.nextInspectionDueAt)
      )
    )
    .orderBy(desc(expenses.invoiceDate));

  // First row per category = latest inspection (query is date-desc).
  const seen = new Set<string>();
  const out: RevisionRow[] = [];
  for (const r of rows) {
    if (seen.has(r.categorySlug)) continue;
    seen.add(r.categorySlug);
    const nextDueAt = r.nextInspectionDueAt!.toISOString();
    const daysUntilDue = daysUntil(nextDueAt, now);
    out.push({
      categorySlug: r.categorySlug,
      supplierName: r.supplierName,
      lastInspectionDate: r.invoiceDate.toISOString(),
      nextDueAt,
      daysUntilDue,
      status: statusFor(daysUntilDue),
    });
  }
  // Soonest deadline first.
  return out.sort((a, b) => a.daysUntilDue - b.daysUntilDue);
}
