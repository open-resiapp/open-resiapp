import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accountingPeriods, journalEntries } from "../db/schema";
import { postOpeningBalance } from "../engine/booking";
import { getOrCreateOpenPeriod } from "./periods";
import { listDomUnits } from "./dom-units";

// Opening-balance tool server logic (spec §Opening-balance correction
// tool). Domain invariant 6: `banka + pokladnica = Σ fpúo + Σ zálohy +
// výsledok minulých rokov` must hold before the first business posting —
// the engine derives the korekcia against 428 so the entry balances by
// construction; this layer's job is the one-shot guard (opening balance
// posts exactly once per dom) and unit listing.

export interface OpeningBalanceUnit {
  id: string;
  name: string;
  flatNumber: string | null;
}

export interface OpeningBalanceState {
  entityId: string;
  country: "sk" | "cz";
  year: number;
  alreadyPosted: boolean;
  units: OpeningBalanceUnit[];
}

export async function getOpeningBalanceState(
  rootEntityId: string,
  country: "sk" | "cz",
  year: number
): Promise<OpeningBalanceState> {
  const units = await listDomUnits(rootEntityId);

  const [existing] = await db
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.entityId, rootEntityId),
        eq(journalEntries.sourceType, "opening_balance")
      )
    )
    .limit(1);

  return {
    entityId: rootEntityId,
    country,
    year,
    alreadyPosted: !!existing,
    units,
  };
}

export interface SubmitOpeningBalanceInput {
  entityId: string;
  country: "sk" | "cz";
  year: number;
  createdById: string;
  bankaCents: number;
  pokladnicaCents: number;
  unitBalances: {
    unitEntityId: string;
    fpuoCents: number;
    zalohyCents: number;
  }[];
}

export interface SubmitOpeningBalanceResult {
  journalEntryId: string;
  periodId: string;
  /** The korekcia the engine booked against 428 (positive = credit). */
  korekciaCents: number;
}

export async function submitOpeningBalance(
  input: SubmitOpeningBalanceInput
): Promise<SubmitOpeningBalanceResult> {
  if (input.bankaCents < 0 || input.pokladnicaCents < 0) {
    throw new Error("accounting: banka/pokladnica must be >= 0");
  }

  return db.transaction(async (tx) => {
    // Get/create the period first and LOCK its row — two concurrent
    // submits (double-click, retry) serialize here, so the one-shot guard
    // below re-reads committed state and the second submit fails cleanly.
    const period = await getOrCreateOpenPeriod(tx, input.entityId, input.year);
    await tx
      .select({ id: accountingPeriods.id })
      .from(accountingPeriods)
      .where(eq(accountingPeriods.id, period.id))
      .for("update");

    // One-shot guard — opening balance posts exactly once per dom.
    const [existing] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(
        and(
          eq(journalEntries.entityId, input.entityId),
          eq(journalEntries.sourceType, "opening_balance")
        )
      )
      .limit(1);
    if (existing) {
      throw new Error("accounting: opening balance already posted");
    }

    const assets = input.bankaCents + input.pokladnicaCents;
    const liabilities = input.unitBalances.reduce(
      (s, u) => s + u.fpuoCents + u.zalohyCents,
      0
    );
    const korekciaCents = assets - liabilities;

    const journalEntryId = await postOpeningBalance(tx, {
      entityId: input.entityId,
      periodId: period.id,
      country: input.country,
      createdById: input.createdById,
      asOf: new Date(Date.UTC(input.year, 0, 1)),
      bankaCents: input.bankaCents,
      pokladnicaCents: input.pokladnicaCents,
      unitBalances: input.unitBalances,
    });

    return { journalEntryId, periodId: period.id, korekciaCents };
  });
}
