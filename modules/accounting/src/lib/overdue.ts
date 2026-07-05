import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accountingSettings,
  settlements,
  settlementUnits,
  unitSettings,
} from "../db/schema";
import { sql } from "drizzle-orm";
import { computeInterest, type RateEntry } from "../sanctions/interest";
import { ECB_MRO_RATES, CNB_REPO_RATES } from "../seeds/interest-rates";
import { openReceivablesForUnit, type OpenReceivable } from "./payments";
import { listDomUnits } from "./dom-units";
import { payBySquareString } from "../qr/pay-by-square";

// Overdue receivables + lawful interest (BYT-20260512-002 Phase 5
// surface). READ-ONLY calculator per spec decision — nothing posts; the
// chairman decides if/when interest is ever booked or claimed.
//
// Due-date rule (decision 2026-07-05, configurable):
//   - monthly assessment: due on settings.dueDay of ITS month (1–28), or
//     the LAST day of the month when unset (common SK default)
//   - settlement nedoplatok: due 30 days after publishing (mirrors the
//     PDF poučenie "spravidla do 30 dní od doručenia")
// Delay starts the day after the due date (engine rule).

type Country = "sk" | "cz";

const HISTORY: Record<Country, RateEntry[]> = {
  sk: ECB_MRO_RATES,
  cz: CNB_REPO_RATES,
};

function lastDayOfMonth(year: number, month: number): Date {
  // Day 0 of the next month = last day of this month.
  return new Date(Date.UTC(year, month, 0));
}

function assessmentDueDate(
  item: OpenReceivable,
  dueDay: number | null
): Date {
  if (dueDay === null) return lastDayOfMonth(item.periodYear, item.month);
  return new Date(Date.UTC(item.periodYear, item.month - 1, dueDay));
}

export interface OverdueItem {
  id: string;
  kind: "assessment" | "settlement";
  categorySlug: string;
  periodYear: number;
  month: number;
  openCents: number;
  dueDate: string;
  daysLate: number;
  ratePct: number;
  interestCents: number;
}

export interface OverdueSummary {
  asOf: string;
  items: OverdueItem[];
  totalOpenCents: number;
  totalInterestCents: number;
  /** True when the seeded rate history may be stale — surface a caveat. */
  ratesUnverified: true;
}

export interface UpomienkaPdfData extends OverdueSummary {
  unitLabel: string;
  vs: string | null;
  iban: string | null;
  /** Dynamic PAY by square for open + interest; null when unavailable. */
  payBySquare: string | null;
  /** SK-only template (statutory citations) — the endpoint enforces it. */
  country: "sk";
}

/**
 * Everything the upomienka PDF needs. SK-only — the statutory citations
 * (nariadenie 87/1995, §517 OZ) belong to the SK template; the CZ
 * upomínka (nař. 351/2013) ships with Phase 6 (template-aware rule).
 */
export async function getUpomienkaPdfData(input: {
  entityId: string;
  country: Country;
  unitEntityId: string;
  beneficiaryName: string;
  now?: Date;
}): Promise<UpomienkaPdfData> {
  if (input.country !== "sk") {
    throw new Error(
      "accounting: the CZ upomínka template ships with Phase 6 — SK template must not serve other countries"
    );
  }
  const summary = await getOverdueForUnit(input);
  if (summary.items.length === 0) {
    throw new Error("accounting: nothing overdue for the unit");
  }

  const units = await listDomUnits(input.entityId);
  const unit = units.find((u) => u.id === input.unitEntityId);
  if (!unit) throw new Error("accounting: unknown unit");

  const [vsRow] = await db
    .select({ vs: unitSettings.vs })
    .from(unitSettings)
    .where(eq(unitSettings.unitEntityId, input.unitEntityId));

  const [settingsRow] = await db
    .select({ bankIban: accountingSettings.bankIban })
    .from(accountingSettings)
    .where(
      and(
        eq(accountingSettings.entityId, input.entityId),
        sql`${accountingSettings.effectiveFrom} <= now()`
      )
    )
    .orderBy(sql`${accountingSettings.effectiveFrom} desc`)
    .limit(1);
  const iban = settingsRow?.bankIban ?? null;

  const totalDue = summary.totalOpenCents + summary.totalInterestCents;
  const payBySquare =
    iban && vsRow?.vs && totalDue > 0
      ? payBySquareString({
          iban,
          amountCents: totalDue,
          vs: vsRow.vs,
          beneficiaryName: input.beneficiaryName,
          note: `Upomienka ${summary.asOf}`,
        })
      : null;

  return {
    ...summary,
    unitLabel: unit.flatNumber ?? unit.name,
    vs: vsRow?.vs ?? null,
    iban,
    payBySquare,
    country: "sk",
  };
}

export async function getOverdueForUnit(input: {
  entityId: string;
  country: Country;
  unitEntityId: string;
  now?: Date;
}): Promise<OverdueSummary> {
  const now = input.now ?? new Date();

  const open = await db.transaction((tx) =>
    openReceivablesForUnit(tx, input.unitEntityId)
  );

  const [settingsRow] = await db
    .select({ dueDay: accountingSettings.dueDay })
    .from(accountingSettings)
    .where(
      and(
        eq(accountingSettings.entityId, input.entityId),
        sql`${accountingSettings.effectiveFrom} <= now()`
      )
    )
    .orderBy(sql`${accountingSettings.effectiveFrom} desc`)
    .limit(1);
  const dueDay = settingsRow?.dueDay ?? null;

  // Settlement receivables anchor to their publish date + 30 days.
  const settlementIds = open
    .filter((o) => o.kind === "settlement")
    .map((o) => o.id);
  const publishedById = new Map<string, Date>();
  if (settlementIds.length > 0) {
    const rows = await db
      .select({
        id: settlementUnits.id,
        publishedAt: settlements.publishedAt,
      })
      .from(settlementUnits)
      .innerJoin(
        settlements,
        eq(settlementUnits.settlementId, settlements.id)
      )
      .where(inArray(settlementUnits.id, settlementIds));
    for (const row of rows) publishedById.set(row.id, row.publishedAt);
  }

  const withDue = open.map((item) => ({
    item,
    dueDate:
      item.kind === "settlement"
        ? new Date(
            (publishedById.get(item.id)?.getTime() ?? now.getTime()) +
              30 * 24 * 3600 * 1000
          )
        : assessmentDueDate(item, dueDay),
  }));

  const { lines } = computeInterest({
    country: input.country,
    history: HISTORY[input.country],
    items: withDue.map(({ item, dueDate }) => ({
      id: item.id,
      amountCents: item.openCents,
      dueDate,
    })),
    asOf: now,
  });
  const lineById = new Map(lines.map((l) => [l.id, l]));

  const items: OverdueItem[] = withDue
    .map(({ item, dueDate }) => {
      const line = lineById.get(item.id)!;
      return {
        id: item.id,
        kind: item.kind,
        categorySlug: item.categorySlug,
        periodYear: item.periodYear,
        month: item.month,
        openCents: item.openCents,
        dueDate: dueDate.toISOString().slice(0, 10),
        daysLate: line.days,
        ratePct: line.ratePct,
        interestCents: line.interestCents,
      };
    })
    .filter((i) => i.daysLate > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return {
    asOf: now.toISOString().slice(0, 10),
    items,
    totalOpenCents: items.reduce((s, i) => s + i.openCents, 0),
    totalInterestCents: items.reduce((s, i) => s + i.interestCents, 0),
    ratesUnverified: true,
  };
}
