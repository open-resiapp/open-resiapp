import "server-only";

import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import {
  accounts,
  accountingPeriods,
  feeAssessments,
  journalEntries,
  journalLines,
  paymentAllocations,
  payments,
  serviceCategories,
} from "../db/schema";
import { ACCOUNT_CODES } from "../seeds/coa-sk";
import { splitByWeights } from "../engine/allocation";
import { domUnitsWhere } from "./dom-units";

// Fond prevádzky, údržby a opráv per unit (auditor report).
//
// Statute: § 10 ods. 1 zák. 182/1993 Z.z. — owners pay into the FPÚO "podľa
// veľkosti spoluvlastníckeho podielu"; § 10 ods. 4 — the fund is kept
// separately from the úhrady za plnenia; § 7b ods. 3 / § 8a ods. 2 — the
// yearly vyúčtovanie použitia FPÚO. The ledger keeps the fund on 472 at
// building level (predpis credits 472 per okruh, čerpanie debits 472 with
// no unit), so the per-unit view is DERIVED:
//
//   opening   = unit-attributed 472 lines of earlier years (+ the opening-
//               balance entry of this year) + FPÚO predpis of earlier years
//               + earlier years' building-level 472 movements split by share
//   predpis   = FPÚO assessments posted in the year (unit-level)
//   paid      = payments allocated to THIS year's FPÚO predpis (info only:
//               the fund accrues at predpis; unpaid part is a receivable)
//   uses      = building-level 472 debits of the year (čerpanie), split by
//               spoluvlastnícky podiel
//   income    = building-level 472 credits of the year that are not predpis
//               (e.g. poistné plnenie, úroky), split by podiel
//   other     = unit-attributed 472 lines of the year other than the
//               opening balance (corrections)
//   closing   = opening + predpis − uses + income + other
//
// Split by share uses splitByWeights (largest remainder) so the units sum
// to the building amount to the cent; a unit without a recorded share
// gets weight 0 and the report flags it. A reconciliation row compares
// Σ closing with the 472 ledger balance — they must match.

type Country = "sk" | "cz";

export interface FpuoUnitRow {
  unitEntityId: string;
  unitLabel: string;
  shareMissing: boolean;
  openingCents: number;
  predpisCents: number;
  paidCents: number;
  usesCents: number;
  incomeCents: number;
  otherCents: number;
  closingCents: number;
}

export interface FpuoReport {
  year: number;
  rows: FpuoUnitRow[];
  totals: Omit<FpuoUnitRow, "unitEntityId" | "unitLabel" | "shareMissing">;
  /** Building-level amounts that could not be split (no shares at all). */
  unallocatedCents: number;
  /** 472 balance (Cr − Dr) at year end straight from the ledger. */
  ledgerClosingCents: number;
  /** ledgerClosing − (Σ closing + unallocated); 0 when consistent. */
  differenceCents: number;
}

function splitSigned(
  amount: number,
  parts: { id: string; weight: number }[]
): Map<string, number> {
  const out = new Map<string, number>();
  if (amount === 0 || parts.every((p) => p.weight <= 0)) return out;
  const split = splitByWeights(Math.abs(amount), parts);
  for (const s of split) out.set(s.id, amount < 0 ? -s.amountCents : s.amountCents);
  return out;
}

export async function getFpuoReport(
  entityId: string,
  country: Country,
  year: number
): Promise<FpuoReport> {
  const units = await db
    .select({
      id: entities.id,
      name: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      shareNumerator: sql<number | null>`(${entities.data}->>'share_numerator')::numeric`,
      shareDenominator: sql<number | null>`(${entities.data}->>'share_denominator')::numeric`,
    })
    .from(entities)
    .where(domUnitsWhere(entityId))
    .orderBy(asc(entities.name));

  const weightOf = (u: (typeof units)[number]) => {
    const n = Number(u.shareNumerator);
    const d = Number(u.shareDenominator);
    return Number.isFinite(n) && Number.isFinite(d) && d > 0 && n > 0 ? n / d : 0;
  };
  const weights = units.map((u) => ({ id: u.id, weight: weightOf(u) }));
  const anyWeight = weights.some((w) => w.weight > 0);

  const [fund] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.country, country), eq(accounts.code, ACCOUNT_CODES.ZAVAZKY_FPUO)));

  // 472 lines of this dom up to the year, bucketed in SQL.
  const lineRows = fund
    ? await db
        .select({
          unitEntityId: journalLines.unitEntityId,
          bucket: sql<string>`case
            when ${journalLines.unitEntityId} is not null and (${accountingPeriods.year} < ${year} or ${journalEntries.sourceType} = 'opening_balance') then 'unit_opening'
            when ${journalLines.unitEntityId} is not null then 'unit_other'
            when ${journalEntries.sourceType} = 'fee_schedule_publish' then 'predpis'
            when ${accountingPeriods.year} < ${year} then 'bldg_prior'
            else 'bldg_year' end`,
          debitCents: sql<number>`coalesce(sum(${journalLines.debitCents}), 0)::bigint`,
          creditCents: sql<number>`coalesce(sum(${journalLines.creditCents}), 0)::bigint`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
        .innerJoin(accountingPeriods, eq(journalEntries.periodId, accountingPeriods.id))
        .where(
          and(
            eq(journalEntries.entityId, entityId),
            eq(journalLines.accountId, fund.id),
            lte(accountingPeriods.year, year)
          )
        )
        .groupBy(sql`1`, sql`2`)
    : [];

  const unitOpening = new Map<string, number>();
  const unitOther = new Map<string, number>();
  let bldgPriorNet = 0;
  let bldgYearDebit = 0;
  let bldgYearCredit = 0;
  let ledgerClosing = 0;
  for (const r of lineRows) {
    const dr = Number(r.debitCents);
    const cr = Number(r.creditCents);
    ledgerClosing += cr - dr;
    if (r.bucket === "unit_opening" && r.unitEntityId) {
      unitOpening.set(r.unitEntityId, (unitOpening.get(r.unitEntityId) ?? 0) + cr - dr);
    } else if (r.bucket === "unit_other" && r.unitEntityId) {
      unitOther.set(r.unitEntityId, (unitOther.get(r.unitEntityId) ?? 0) + cr - dr);
    } else if (r.bucket === "bldg_prior") {
      bldgPriorNet += cr - dr;
    } else if (r.bucket === "bldg_year") {
      bldgYearDebit += dr;
      bldgYearCredit += cr;
    }
    // 'predpis' lines are mirrored unit-level by the assessments below.
  }

  // FPÚO predpis per unit: earlier years → opening, this year → predpis.
  const assessmentRows = await db
    .select({
      unitEntityId: feeAssessments.unitEntityId,
      prior: sql<number>`coalesce(sum(${feeAssessments.amountCents}) filter (where ${accountingPeriods.year} < ${year}), 0)::bigint`,
      current: sql<number>`coalesce(sum(${feeAssessments.amountCents}) filter (where ${accountingPeriods.year} = ${year}), 0)::bigint`,
    })
    .from(feeAssessments)
    .innerJoin(accountingPeriods, eq(feeAssessments.periodId, accountingPeriods.id))
    .innerJoin(serviceCategories, eq(feeAssessments.serviceCategoryId, serviceCategories.id))
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        eq(serviceCategories.okruh, "fpuo"),
        sql`${feeAssessments.journalEntryId} is not null`,
        lte(accountingPeriods.year, year)
      )
    )
    .groupBy(feeAssessments.unitEntityId);
  const predpisPrior = new Map(assessmentRows.map((r) => [r.unitEntityId, Number(r.prior)]));
  const predpisYear = new Map(assessmentRows.map((r) => [r.unitEntityId, Number(r.current)]));

  // Paid on THIS year's FPÚO predpis (non-voided payments, incl. credit
  // applications — they allocate through the same table).
  const unitIds = units.map((u) => u.id);
  const paidRows =
    unitIds.length > 0
      ? await db
          .select({
            unitEntityId: feeAssessments.unitEntityId,
            paid: sql<number>`coalesce(sum(${paymentAllocations.amountCents}), 0)::bigint`,
          })
          .from(paymentAllocations)
          .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
          .innerJoin(feeAssessments, eq(feeAssessments.id, paymentAllocations.assessmentId))
          .innerJoin(accountingPeriods, eq(feeAssessments.periodId, accountingPeriods.id))
          .innerJoin(serviceCategories, eq(feeAssessments.serviceCategoryId, serviceCategories.id))
          .where(
            and(
              isNull(payments.voidedAt),
              eq(serviceCategories.okruh, "fpuo"),
              eq(accountingPeriods.year, year),
              inArray(feeAssessments.unitEntityId, unitIds)
            )
          )
          .groupBy(feeAssessments.unitEntityId)
      : [];
  const paidYear = new Map(paidRows.map((r) => [r.unitEntityId, Number(r.paid)]));

  const priorSplit = anyWeight ? splitSigned(bldgPriorNet, weights) : new Map<string, number>();
  const usesSplit = anyWeight ? splitSigned(bldgYearDebit, weights) : new Map<string, number>();
  const incomeSplit = anyWeight ? splitSigned(bldgYearCredit, weights) : new Map<string, number>();
  const unallocatedCents = anyWeight ? 0 : bldgPriorNet + bldgYearCredit - bldgYearDebit;

  const rows: FpuoUnitRow[] = units.map((u) => {
    const openingCents =
      (unitOpening.get(u.id) ?? 0) + (predpisPrior.get(u.id) ?? 0) + (priorSplit.get(u.id) ?? 0);
    const predpisCents = predpisYear.get(u.id) ?? 0;
    const usesCents = usesSplit.get(u.id) ?? 0;
    const incomeCents = incomeSplit.get(u.id) ?? 0;
    const otherCents = unitOther.get(u.id) ?? 0;
    return {
      unitEntityId: u.id,
      unitLabel: u.flatNumber ?? u.name,
      shareMissing: weightOf(u) === 0,
      openingCents,
      predpisCents,
      paidCents: paidYear.get(u.id) ?? 0,
      usesCents,
      incomeCents,
      otherCents,
      closingCents: openingCents + predpisCents - usesCents + incomeCents + otherCents,
    };
  });

  const sum = (k: keyof FpuoReport["totals"]) => rows.reduce((s, r) => s + r[k], 0);
  const totals = {
    openingCents: sum("openingCents"),
    predpisCents: sum("predpisCents"),
    paidCents: sum("paidCents"),
    usesCents: sum("usesCents"),
    incomeCents: sum("incomeCents"),
    otherCents: sum("otherCents"),
    closingCents: sum("closingCents"),
  };

  return {
    year,
    rows,
    totals,
    unallocatedCents,
    ledgerClosingCents: ledgerClosing,
    differenceCents: ledgerClosing - (totals.closingCents + unallocatedCents),
  };
}
