import "server-only";

import { and, asc, eq, gt, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import {
  accountingPeriods,
  feeAssessments,
  feeSchedules,
  serviceCategories,
  unitSettings,
} from "../db/schema";
import { domUnitsWhere } from "./dom-units";
import { getAccountingSettings } from "./settings";
import { payBySquareString } from "../qr/pay-by-square";
import { spaydString } from "../qr/spayd";

// Data for the monthly predpis PDF (spec §Predpis: per-owner PDF export
// with VS prominently displayed + payment QR). The PDF itself renders
// client-side; this assembles the current month's amounts from the ACTIVE
// published schedule's assessments and the QR payload — PAY by square for
// SK, QR Platba / SPAYD for CZ (AC 455/456).

type Country = "sk" | "cz";

export interface PredpisPdfData {
  unitLabel: string;
  vs: string;
  year: number;
  month: number;
  rows: { categorySlug: string; amountCents: number }[];
  totalCents: number;
  iban: string;
  /** Payment-QR payload: PAY by square (SK) or SPAYD (CZ). */
  payBySquare: string | null;
}

/**
 * Local calendar month in the domain timezone — a PDF generated at 00:30
 * on the 1st (CEST) must carry the NEW month, not UTC's previous one.
 */
function domainYearMonth(date: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month") };
}

export async function getPredpisPdfData(input: {
  entityId: string;
  country: Country;
  unitEntityId: string;
  beneficiaryName: string;
  now?: Date;
}): Promise<PredpisPdfData> {
  const now = input.now ?? new Date();
  const { year, month } = domainYearMonth(now);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));

  const [unit] = await db
    .select({
      id: entities.id,
      name: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      vs: unitSettings.vs,
    })
    .from(entities)
    .leftJoin(unitSettings, eq(unitSettings.unitEntityId, entities.id))
    .where(and(eq(entities.id, input.unitEntityId), domUnitsWhere(input.entityId)));
  if (!unit) throw new Error("accounting: unknown unit");
  if (!unit.vs) {
    throw new Error("accounting: unit has no VS — assign variabilné symboly first");
  }

  // The schedule owning the current month: published, effective at the
  // month start, not superseded before it.
  const [schedule] = await db
    .select({ id: feeSchedules.id })
    .from(feeSchedules)
    .innerJoin(
      accountingPeriods,
      eq(feeSchedules.periodId, accountingPeriods.id)
    )
    .where(
      and(
        eq(feeSchedules.entityId, input.entityId),
        eq(feeSchedules.status, "published"),
        eq(accountingPeriods.year, year),
        lte(feeSchedules.effectiveFrom, monthStart),
        or(
          isNull(feeSchedules.effectiveTo),
          gt(feeSchedules.effectiveTo, monthStart)
        )
      )
    )
    .orderBy(sql`${feeSchedules.effectiveFrom} desc`)
    .limit(1);
  if (!schedule) {
    throw new Error("accounting: no published predpis covers the current month");
  }

  const rows = await db
    .select({
      categorySlug: serviceCategories.slug,
      amountCents: feeAssessments.amountCents,
    })
    .from(feeAssessments)
    .innerJoin(
      serviceCategories,
      eq(feeAssessments.serviceCategoryId, serviceCategories.id)
    )
    .where(
      and(
        eq(feeAssessments.scheduleId, schedule.id),
        eq(feeAssessments.unitEntityId, input.unitEntityId),
        eq(feeAssessments.month, month)
      )
    )
    .orderBy(asc(serviceCategories.sortOrder));
  if (rows.length === 0) {
    throw new Error("accounting: no assessments for the unit in the current month");
  }
  const totalCents = rows.reduce((s, r) => s + r.amountCents, 0);

  const settings = await getAccountingSettings(input.entityId, input.country);
  if (!settings.bankIban) {
    throw new Error(
      "accounting: bank IBAN is not configured — set it in accounting settings"
    );
  }

  const note = `Predpis ${year}-${String(month).padStart(2, "0")}`;
  const payBySquare =
    input.country === "sk"
      ? payBySquareString({
          iban: settings.bankIban,
          amountCents: totalCents,
          vs: unit.vs,
          beneficiaryName: input.beneficiaryName,
          note,
        })
      : spaydString({
          iban: settings.bankIban,
          amountCents: totalCents,
          vs: unit.vs,
          message: note,
        });

  return {
    unitLabel: unit.flatNumber ?? unit.name,
    vs: unit.vs,
    year,
    month,
    rows,
    totalCents,
    iban: settings.bankIban,
    payBySquare,
  };
}
