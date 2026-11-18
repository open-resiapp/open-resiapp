import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountingPeriods,
  journalEntries,
  journalLines,
} from "../db/schema";
import { postOpeningBalance, reverseOpeningBalance } from "../engine/booking";
import { ACCOUNT_CODES } from "../seeds/coa-sk";
import { getOrCreateOpenPeriod } from "./periods";
import { listDomUnits } from "./dom-units";

// Opening-balance tool server logic (spec §Opening-balance correction
// tool). Domain invariant 6: `banka + pokladnica = Σ fpúo + Σ zálohy +
// výsledok minulých rokov` must hold before the first business posting —
// the engine derives the korekcia against 428 so the entry balances by
// construction.
//
// Per unit the treasurer enters FOUR separate numbers (they used to be
// netted into one signed value per fund, so savings in the fund and
// arrears of the same owner cancelled out):
//   - fpuoCents    FPÚO balance attributed to the unit (Cr 472; negative =
//                  unpaid fund contributions, Dr 311.100 — legacy meaning)
//   - zalohyCents  service advances held (Cr 478; negative = Dr 311.200)
//   - nedoplatok   owner's arrears (Dr 311.200)
//   - preplatok    owner's credit (Cr 379 — same parking account a payment
//                  remainder lands on, so karta / overdue see it as credit)
//
// Correction = reversal + repost, never edit/delete. The ACTIVE opening
// entry is an `opening_balance` entry that is neither a reversal (its
// sourceId points at another opening entry) nor reversed by one. Business
// postings made after the opening (predpis, payments) stay untouched: all
// balances are sums of postings, so swapping the opening entry for a
// corrected one changes exactly the opening amounts and nothing else.
// The reversal and repost go into the opening period, which must still be
// OPEN — corrections never touch a locked period (domain invariant 4).

/** Stable error codes — the UI maps them to i18n strings. */
export type OpeningBalanceErrorCode =
  | "already_posted"
  | "not_posted"
  | "opening_period_locked"
  | "invalid_amounts"
  | "unknown_unit"
  | "reason_required";

export class OpeningBalanceError extends Error {
  constructor(public readonly code: OpeningBalanceErrorCode) {
    super(`accounting: opening balance ${code}`);
  }
}

export interface OpeningBalanceUnit {
  id: string;
  name: string;
  flatNumber: string | null;
}

export interface OpeningUnitBalance {
  unitEntityId: string;
  fpuoCents: number;
  zalohyCents: number;
  nedoplatokCents: number;
  preplatokCents: number;
}

/** What the active opening entry holds — prefill for a correction. */
export interface PostedOpeningBalance {
  journalEntryId: string;
  year: number;
  /** False once the opening period is locked — no correction possible. */
  periodOpen: boolean;
  bankaCents: number;
  pokladnicaCents: number;
  unitBalances: OpeningUnitBalance[];
}

export interface OpeningBalanceState {
  entityId: string;
  country: "sk" | "cz";
  year: number;
  alreadyPosted: boolean;
  posted: PostedOpeningBalance | null;
  units: OpeningBalanceUnit[];
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = typeof db | Tx;

/** The active opening entry of the dom, or null. */
async function findActiveOpeningEntry(
  ex: Executor,
  entityId: string
): Promise<{ id: string; periodId: string } | null> {
  const rows = await ex
    .select({
      id: journalEntries.id,
      periodId: journalEntries.periodId,
      sourceId: journalEntries.sourceId,
    })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.entityId, entityId),
        eq(journalEntries.sourceType, "opening_balance")
      )
    );
  const ids = new Set(rows.map((r) => r.id));
  const reversals = rows.filter((r) => r.sourceId && ids.has(r.sourceId));
  const reversedIds = new Set(reversals.map((r) => r.sourceId!));
  const reversalIds = new Set(reversals.map((r) => r.id));
  const active = rows.filter(
    (r) => !reversalIds.has(r.id) && !reversedIds.has(r.id)
  );
  return active[0] ? { id: active[0].id, periodId: active[0].periodId } : null;
}

/**
 * Reads the per-unit values back from the entry's journal lines. Mapping
 * (canonical, reversible — reposting it yields an identical entry):
 *   472 Cr−Dr → fpuo, 311.100 Dr → −fpuo (legacy negative fund),
 *   478 Cr−Dr → zálohy, 311.200 Dr → nedoplatok (a legacy negative zálohy
 *   posted the same line, so it reads back as nedoplatok — same ledger
 *   effect), 379 Cr−Dr → preplatok, 221 / 211 Dr → banka / pokladnica.
 */
async function readPostedOpening(
  entityId: string,
  entry: { id: string; periodId: string }
): Promise<PostedOpeningBalance> {
  const [period] = await db
    .select({ year: accountingPeriods.year, status: accountingPeriods.status })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.id, entry.periodId));
  const lines = await db
    .select({
      code: accounts.code,
      debitCents: journalLines.debitCents,
      creditCents: journalLines.creditCents,
      unitEntityId: journalLines.unitEntityId,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
    .innerJoin(journalEntries, eq(journalLines.journalEntryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.journalEntryId, entry.id),
        eq(journalEntries.entityId, entityId)
      )
    );

  let bankaCents = 0;
  let pokladnicaCents = 0;
  const byUnit = new Map<string, OpeningUnitBalance>();
  const unitRow = (id: string) => {
    let row = byUnit.get(id);
    if (!row) {
      row = {
        unitEntityId: id,
        fpuoCents: 0,
        zalohyCents: 0,
        nedoplatokCents: 0,
        preplatokCents: 0,
      };
      byUnit.set(id, row);
    }
    return row;
  };
  for (const l of lines) {
    const cr = l.creditCents - l.debitCents;
    if (l.code === ACCOUNT_CODES.BANKA) bankaCents += -cr;
    else if (l.code === ACCOUNT_CODES.POKLADNICA) pokladnicaCents += -cr;
    if (!l.unitEntityId) continue;
    const row = unitRow(l.unitEntityId);
    switch (l.code) {
      case ACCOUNT_CODES.ZAVAZKY_FPUO:
      case ACCOUNT_CODES.POHLADAVKY_VLASTNICI_FPUO:
        row.fpuoCents += cr;
        break;
      case ACCOUNT_CODES.ZAVAZKY_SLUZBY:
        row.zalohyCents += cr;
        break;
      case ACCOUNT_CODES.POHLADAVKY_VLASTNICI_SLUZBY:
        row.nedoplatokCents += -cr;
        break;
      case ACCOUNT_CODES.INE_ZAVAZKY:
        row.preplatokCents += cr;
        break;
    }
  }

  return {
    journalEntryId: entry.id,
    year: period?.year ?? new Date().getFullYear(),
    periodOpen: period?.status === "open",
    bankaCents,
    pokladnicaCents,
    unitBalances: [...byUnit.values()],
  };
}

export async function getOpeningBalanceState(
  rootEntityId: string,
  country: "sk" | "cz",
  year: number
): Promise<OpeningBalanceState> {
  const units = await listDomUnits(rootEntityId);
  const active = await findActiveOpeningEntry(db, rootEntityId);
  const posted = active ? await readPostedOpening(rootEntityId, active) : null;

  return {
    entityId: rootEntityId,
    country,
    year: posted?.year ?? year,
    alreadyPosted: !!active,
    posted,
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
    nedoplatokCents?: number;
    preplatokCents?: number;
  }[];
}

export interface SubmitOpeningBalanceResult {
  journalEntryId: string;
  periodId: string;
  /** The korekcia the engine booked against 428 (positive = credit). */
  korekciaCents: number;
  /** Set on a correction: the reversal entry of the replaced opening. */
  reversalEntryId?: string;
}

function korekcia(input: SubmitOpeningBalanceInput): number {
  const assets = input.bankaCents + input.pokladnicaCents;
  // Liabilities toward owners (fund, advances, credit) minus their debts.
  const net = input.unitBalances.reduce(
    (s, u) =>
      s +
      u.fpuoCents +
      u.zalohyCents +
      (u.preplatokCents ?? 0) -
      (u.nedoplatokCents ?? 0),
    0
  );
  return assets - net;
}

async function validate(input: SubmitOpeningBalanceInput): Promise<void> {
  if (
    input.bankaCents < 0 ||
    input.pokladnicaCents < 0 ||
    input.unitBalances.some(
      (u) => (u.nedoplatokCents ?? 0) < 0 || (u.preplatokCents ?? 0) < 0
    )
  ) {
    throw new OpeningBalanceError("invalid_amounts");
  }
  // Every unit must be a live unit of this dom (tenancy boundary).
  const domUnitIds = new Set(
    (await listDomUnits(input.entityId)).map((u) => u.id)
  );
  if (input.unitBalances.some((u) => !domUnitIds.has(u.unitEntityId))) {
    throw new OpeningBalanceError("unknown_unit");
  }
}

async function lockPeriod(tx: Tx, entityId: string, year: number) {
  // Get/create the period first and LOCK its row — two concurrent
  // submits (double-click, retry) serialize here, so the one-shot guard
  // re-reads committed state and the second submit fails cleanly.
  const period = await getOrCreateOpenPeriod(tx, entityId, year);
  await tx
    .select({ id: accountingPeriods.id })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.id, period.id))
    .for("update");
  return period;
}

export async function submitOpeningBalance(
  input: SubmitOpeningBalanceInput
): Promise<SubmitOpeningBalanceResult> {
  return db.transaction(async (tx) => {
    await validate(input);
    const period = await lockPeriod(tx, input.entityId, input.year);

    // One-shot guard — one ACTIVE opening entry per dom.
    if (await findActiveOpeningEntry(tx, input.entityId)) {
      throw new OpeningBalanceError("already_posted");
    }

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

    return { journalEntryId, periodId: period.id, korekciaCents: korekcia(input) };
  });
}

/**
 * Corrects the posted opening balance: reverses the active entry (mirror
 * posting, audited with `reason`) and posts the corrected one — one
 * transaction, so the ledger never shows zero or two openings. The year
 * is the original opening's year; that period must still be open.
 */
export async function correctOpeningBalance(
  input: Omit<SubmitOpeningBalanceInput, "year"> & { reason: string }
): Promise<SubmitOpeningBalanceResult> {
  const reason = input.reason.trim();
  if (!reason) throw new OpeningBalanceError("reason_required");

  return db.transaction(async (tx) => {
    const active = await findActiveOpeningEntry(tx, input.entityId);
    if (!active) throw new OpeningBalanceError("not_posted");

    const [period] = await tx
      .select({
        id: accountingPeriods.id,
        year: accountingPeriods.year,
        status: accountingPeriods.status,
      })
      .from(accountingPeriods)
      .where(eq(accountingPeriods.id, active.periodId))
      .for("update");
    if (!period || period.status !== "open") {
      throw new OpeningBalanceError("opening_period_locked");
    }
    const full: SubmitOpeningBalanceInput = { ...input, year: period.year };
    await validate(full);

    // Re-check under the lock: a concurrent correction may have won.
    const again = await findActiveOpeningEntry(tx, input.entityId);
    if (!again || again.id !== active.id) {
      throw new OpeningBalanceError("already_posted");
    }

    const reversalEntryId = await reverseOpeningBalance(tx, {
      entityId: input.entityId,
      country: input.country,
      originalEntryId: active.id,
      periodId: period.id,
      createdById: input.createdById,
      reason,
    });

    const journalEntryId = await postOpeningBalance(tx, {
      entityId: input.entityId,
      periodId: period.id,
      country: input.country,
      createdById: input.createdById,
      asOf: new Date(Date.UTC(period.year, 0, 1)),
      bankaCents: full.bankaCents,
      pokladnicaCents: full.pokladnicaCents,
      unitBalances: full.unitBalances,
    });

    return {
      journalEntryId,
      periodId: period.id,
      korekciaCents: korekcia(full),
      reversalEntryId,
    };
  });
}
