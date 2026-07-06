import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";
import {
  feeAssessments,
  accountingPeriods,
  accountingSettings,
  payments,
  paymentAllocations,
  unitSettings,
  auditLog,
} from "../db/schema";
import {
  parseCamt053,
  Camt053ParseError,
  type Camt053Transaction,
} from "@/lib/import/parsers/bank-camt053";
import {
  suggestMatch,
  type MatchableUnit,
  type MatchSuggestion,
} from "../matching/match";
import { periodForReceivedAt } from "./periods";
import { domUnitsWhere } from "./dom-units";
import { allocateAndPostPayment } from "./payments";
import { postAllDueMonths } from "./fee-schedule-publish";

// CAMT.053 bank import + reconciliation (BYT-20260512-002 Phase 2).
// Import is idempotent via payments.external_tx_id UNIQUE — re-importing
// the same statement inserts 0 new rows. Credits auto-match per the
// matching engine (VS primary); everything below the auto-apply threshold
// waits unposted for the reconciliation UI. Debits (outgoing money) are
// counted and skipped — expenses arrive in Phase 3.

type Country = "sk" | "cz";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── matchable-unit context ─────────────────────────────

async function gatherMatchableUnits(
  tx: Tx,
  entityId: string
): Promise<MatchableUnit[]> {
  const units = await tx
    .select({ id: entities.id, vs: unitSettings.vs })
    .from(entities)
    .leftJoin(unitSettings, eq(unitSettings.unitEntityId, entities.id))
    .where(domUnitsWhere(entityId))
    .orderBy(asc(entities.name));
  const unitIds = units.map((u) => u.id);
  if (unitIds.length === 0) return [];

  // Counterparty IBANs learned ONLY from HUMAN-confirmed matches
  // (payments.matchedBy = 'manual' — reconciliation confirms and manual
  // entry). Learning from auto-matches would make a single wrong VS
  // auto-match self-reinforcing: the wrong unit "learns" the payer's IBAN
  // and every later payment from that account keeps auto-matching wrongly.
  const ibans = await tx
    .selectDistinct({
      unitEntityId: payments.unitEntityId,
      iban: payments.counterpartyIban,
    })
    .from(payments)
    .where(
      and(
        eq(payments.entityId, entityId),
        isNotNull(payments.unitEntityId),
        isNotNull(payments.counterpartyIban),
        isNull(payments.voidedAt),
        eq(payments.matchedBy, "manual")
      )
    );
  const ibansByUnit = new Map<string, Set<string>>();
  for (const row of ibans) {
    let set = ibansByUnit.get(row.unitEntityId!);
    if (!set) {
      set = new Set();
      ibansByUnit.set(row.unitEntityId!, set);
    }
    set.add(row.iban!);
  }

  const owners = await tx
    .select({ entityId: memberships.entityId, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(memberships.userId, users.id))
    .where(
      and(
        inArray(memberships.entityId, unitIds),
        eq(memberships.role, "owner"),
        eq(memberships.status, "active")
      )
    );
  const namesByUnit = new Map<string, string[]>();
  for (const o of owners) {
    const list = namesByUnit.get(o.entityId);
    if (list) list.push(o.name);
    else namesByUnit.set(o.entityId, [o.name]);
  }

  // Open (due, unpaid) total per unit for amount plausibility.
  const allocatedSub = sql<number>`coalesce((
    select sum(${paymentAllocations.amountCents})::int
    from ${paymentAllocations}
    join ${payments} p2 on p2.id = ${paymentAllocations.paymentId}
    where ${paymentAllocations.assessmentId} = ${feeAssessments.id}
      and p2.voided_at is null
  ), 0)`;
  const openRows = await tx
    .select({
      unitEntityId: feeAssessments.unitEntityId,
      open: sql<number>`sum(${feeAssessments.amountCents} - ${allocatedSub})::int`,
    })
    .from(feeAssessments)
    .innerJoin(
      accountingPeriods,
      eq(feeAssessments.periodId, accountingPeriods.id)
    )
    .where(
      and(
        eq(accountingPeriods.entityId, entityId),
        inArray(feeAssessments.unitEntityId, unitIds),
        sql`${feeAssessments.journalEntryId} is not null`
      )
    )
    .groupBy(feeAssessments.unitEntityId);
  const openByUnit = new Map(
    openRows.map((r) => [r.unitEntityId, Math.max(0, r.open)])
  );

  return units.map((u) => ({
    unitEntityId: u.id,
    vs: u.vs,
    knownIbans: [...(ibansByUnit.get(u.id) ?? [])],
    ownerNames: namesByUnit.get(u.id) ?? [],
    openCents: openByUnit.get(u.id) ?? 0,
  }));
}

// ── import ─────────────────────────────────────────────

export interface ImportSummary {
  statements: number;
  credits: number;
  imported: number;
  skippedDuplicates: number;
  autoMatched: number;
  needsReview: number;
  debitsSkipped: number;
}

/** Ledger currency per country — imports in any other currency refuse. */
export const LEDGER_CURRENCY: Record<Country, string> = {
  sk: "EUR",
  cz: "CZK",
};

/** One incoming bank line, source-agnostic (camt.053 upload, Fio poll). */
export interface NormalizedBankLine {
  /** Non-null — callers synthesize a stable key when the bank omits one. */
  externalTxId: string;
  amountCents: number;
  direction: "credit" | "debit";
  bookingDate: string | null;
  valueDate: string | null;
  vs: string | null;
  ss: string | null;
  ks: string | null;
  counterpartyIban: string | null;
  counterpartyName: string | null;
  narrative: string | null;
}

/**
 * The shared import pipeline: dedupe per dom, insert, auto-match, post.
 * Runs inside the caller's transaction (caller already holds the
 * open-period locks via postAllDueMonths).
 */
async function importLines(
  tx: Tx,
  input: {
    entityId: string;
    country: Country;
    actorId: string;
    source: "bank_import" | "fio_api";
    lines: NormalizedBankLine[];
    summary: ImportSummary;
  }
): Promise<void> {
  const matchable = await gatherMatchableUnits(tx, input.entityId);
  const { summary } = input;

  for (const line of input.lines) {
    if (line.direction === "debit") {
      summary.debitsSkipped += 1;
      continue;
    }
    if (line.amountCents <= 0) {
      // Zero-amount informational entries carry no money.
      continue;
    }
    summary.credits += 1;

    // Dedupe scoped to the dom (the unique index is per entity — bank
    // references are only unique per bank, not across doms). The insert
    // below is additionally onConflictDoNothing so a concurrent import of
    // the same lines counts duplicates instead of aborting on 23505.
    const [existing] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          eq(payments.entityId, input.entityId),
          eq(payments.externalTxId, line.externalTxId)
        )
      )
      .limit(1);
    if (existing) {
      summary.skippedDuplicates += 1;
      continue;
    }

    const suggestion = suggestMatch(
      {
        vs: line.vs,
        ss: line.ss,
        amountCents: line.amountCents,
        counterpartyIban: line.counterpartyIban,
        counterpartyName: line.counterpartyName,
      },
      matchable
    );
    const autoUnit = suggestion.autoApply ? suggestion.unitEntityId : null;

    const receivedAt = line.bookingDate
      ? new Date(`${line.bookingDate}T00:00:00Z`)
      : new Date();
    const [payment] = await tx
      .insert(payments)
      .values({
        entityId: input.entityId,
        unitEntityId: autoUnit,
        source: input.source,
        method: "bank",
        receivedAt,
        valueDate: line.valueDate
          ? new Date(`${line.valueDate}T00:00:00Z`)
          : null,
        amountCents: line.amountCents,
        vs: line.vs,
        ss: line.ss,
        ks: line.ks,
        counterpartyIban: line.counterpartyIban,
        counterpartyName: line.counterpartyName,
        narrative: line.narrative,
        externalTxId: line.externalTxId,
        rawPayload: line as unknown as Record<string, unknown>,
        createdById: input.actorId,
      })
      .onConflictDoNothing()
      .returning({ id: payments.id });
    if (!payment) {
      summary.skippedDuplicates += 1;
      continue;
    }
    summary.imported += 1;

    if (autoUnit) {
      // Same fiscal-year rule as manual entry — the payment's receivedAt
      // year when that period is open, else the current open period.
      const period = await periodForReceivedAt(
        tx,
        input.entityId,
        receivedAt
      );
      await allocateAndPostPayment(tx, {
        paymentId: payment.id,
        entityId: input.entityId,
        periodId: period.id,
        country: input.country,
        unitEntityId: autoUnit,
        amountCents: line.amountCents,
        actorId: input.actorId,
        allocatedBy: "auto",
        matchedBy: "auto",
      });
      summary.autoMatched += 1;
    } else {
      summary.needsReview += 1;
    }
  }
}

/** Runs the shared pipeline in its own transaction (Fio poll path). */
export async function importNormalizedLines(input: {
  entityId: string;
  country: Country;
  actorId: string;
  source: "bank_import" | "fio_api";
  lines: NormalizedBankLine[];
}): Promise<ImportSummary> {
  return db.transaction(async (tx) => {
    await postAllDueMonths(tx, {
      entityId: input.entityId,
      country: input.country,
    });
    const summary: ImportSummary = {
      statements: 1,
      credits: 0,
      imported: 0,
      skippedDuplicates: 0,
      autoMatched: 0,
      needsReview: 0,
      debitsSkipped: 0,
    };
    await importLines(tx, { ...input, summary });
    // Every money mutation is audited — API-sourced imports included.
    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "insert",
      tableName: "mod_accounting_payments",
      recordId: input.entityId,
      after: { bankImport: summary, source: input.source },
      justification:
        input.source === "fio_api" ? "fio sync" : "bank line import",
    });
    return summary;
  });
}

/** Refuses any line whose currency differs from the ledger's. */
export function assertLedgerCurrency(
  country: Country,
  lines: { currency?: string | null }[]
): void {
  const expected = LEDGER_CURRENCY[country];
  for (const line of lines) {
    if (line.currency && line.currency !== expected) {
      throw new Error(
        `accounting: statement carries ${line.currency} amounts — this ledger books ${expected}`
      );
    }
  }
}

export async function importCamt053Statement(input: {
  entityId: string;
  country: Country;
  actorId: string;
  xml: string;
}): Promise<ImportSummary> {
  let statements;
  try {
    statements = parseCamt053(input.xml);
  } catch (err) {
    if (err instanceof Camt053ParseError) {
      throw new Error(`accounting: invalid camt.053 file — ${err.message}`);
    }
    throw err;
  }

  // Amounts are stored as plain cents with NO currency column — a
  // foreign-currency line booked verbatim would corrupt every balance.
  assertLedgerCurrency(
    input.country,
    statements.flatMap((s) => s.transactions)
  );

  return db.transaction(async (tx) => {
    // Serializes with every other money mutation AND posts due months so
    // auto-match allocations see current receivables.
    await postAllDueMonths(tx, {
      entityId: input.entityId,
      country: input.country,
    });

    // The statement must belong to the dom's configured collection
    // account — checked inside the tx so a concurrent settings change
    // can't slip a wrong-account file through.
    const [settingsRow] = await tx
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
    if (settingsRow?.bankIban) {
      for (const stmt of statements) {
        if (stmt.iban && stmt.iban !== settingsRow.bankIban) {
          throw new Error(
            `accounting: statement account ${stmt.iban} does not match the configured IBAN — wrong file?`
          );
        }
      }
    }

    const summary: ImportSummary = {
      statements: statements.length,
      credits: 0,
      imported: 0,
      skippedDuplicates: 0,
      autoMatched: 0,
      needsReview: 0,
      debitsSkipped: 0,
    };

    // Idempotency key: the bank's AcctSvcrRef, or a synthesized
    // statement-scoped key when the bank omits it — a NULL key would
    // bypass the unique index and re-import the line on every upload.
    // The synthetic key carries date + amount so two DIFFERENT statements
    // that both lack ids can't collide position-by-position; a statement
    // with neither AcctSvcrRef nor an Id at all refuses (no stable key).
    for (const stmt of statements) {
      if (
        !stmt.statementId &&
        stmt.transactions.some((l) => !l.externalTxId)
      ) {
        throw new Error(
          "accounting: statement has neither transaction references nor a statement id — cannot import idempotently"
        );
      }
    }
    const lines: NormalizedBankLine[] = statements.flatMap((stmt) =>
      stmt.transactions.map((line, i) => ({
        externalTxId:
          line.externalTxId ??
          `stmt:${stmt.iban ?? "?"}:${stmt.statementId}:${line.bookingDate ?? "?"}:${line.amountCents}:${i + 1}`,
        amountCents: line.amountCents,
        direction: line.direction,
        bookingDate: line.bookingDate,
        valueDate: line.valueDate,
        vs: line.vs,
        ss: line.ss,
        ks: line.ks,
        counterpartyIban: line.counterpartyIban,
        counterpartyName: line.counterpartyName,
        narrative: line.narrative,
      }))
    );

    await importLines(tx, {
      entityId: input.entityId,
      country: input.country,
      actorId: input.actorId,
      source: "bank_import",
      lines,
      summary,
    });

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "insert",
      tableName: "mod_accounting_payments",
      recordId: input.entityId,
      after: { bankImport: summary },
      justification: "camt.053 import",
    });

    return summary;
  });
}

// ── reconciliation ─────────────────────────────────────

export interface ReconciliationRow {
  paymentId: string;
  receivedAt: string;
  amountCents: number;
  vs: string | null;
  ss: string | null;
  counterpartyIban: string | null;
  counterpartyName: string | null;
  narrative: string | null;
  suggestion: MatchSuggestion & {
    unitLabel: string | null;
  };
}

/** Unmatched (unposted, non-voided) bank lines with fresh suggestions. */
export async function listUnmatchedBankLines(
  entityId: string
): Promise<ReconciliationRow[]> {
  return db.transaction(async (tx) => {
    const matchable = await gatherMatchableUnits(tx, entityId);
    const labels = await tx
      .select({
        id: entities.id,
        name: entities.name,
        flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      })
      .from(entities)
      .where(domUnitsWhere(entityId));
    const labelById = new Map(
      labels.map((l) => [l.id, l.flatNumber ?? l.name])
    );

    const rows = await tx
      .select({
        id: payments.id,
        receivedAt: payments.receivedAt,
        amountCents: payments.amountCents,
        vs: payments.vs,
        ss: payments.ss,
        counterpartyIban: payments.counterpartyIban,
        counterpartyName: payments.counterpartyName,
        narrative: payments.narrative,
      })
      .from(payments)
      .where(
        and(
          eq(payments.entityId, entityId),
          inArray(payments.source, ["bank_import", "fio_api"]),
          isNull(payments.journalEntryId),
          isNull(payments.voidedAt)
        )
      )
      .orderBy(asc(payments.receivedAt));

    return rows.map((r) => {
      const suggestion = suggestMatch(
        {
          vs: r.vs,
          ss: r.ss,
          amountCents: r.amountCents,
          counterpartyIban: r.counterpartyIban,
          counterpartyName: r.counterpartyName,
        },
        matchable
      );
      return {
        paymentId: r.id,
        receivedAt: r.receivedAt.toISOString(),
        amountCents: r.amountCents,
        vs: r.vs,
        ss: r.ss,
        counterpartyIban: r.counterpartyIban,
        counterpartyName: r.counterpartyName,
        narrative: r.narrative,
        suggestion: {
          ...suggestion,
          unitLabel: suggestion.unitEntityId
            ? labelById.get(suggestion.unitEntityId) ?? null
            : null,
        },
      };
    });
  });
}

/** Treasurer confirms (or overrides) the unit for an unmatched line. */
export async function confirmBankLineMatch(input: {
  entityId: string;
  country: Country;
  paymentId: string;
  unitEntityId: string;
  actorId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await postAllDueMonths(tx, {
      entityId: input.entityId,
      country: input.country,
    });

    const [unit] = await tx
      .select({ id: entities.id })
      .from(entities)
      .where(
        and(eq(entities.id, input.unitEntityId), domUnitsWhere(input.entityId))
      );
    if (!unit) throw new Error("accounting: unknown unit");

    const [payment] = await tx
      .select({
        amountCents: payments.amountCents,
        receivedAt: payments.receivedAt,
        journalEntryId: payments.journalEntryId,
        voidedAt: payments.voidedAt,
      })
      .from(payments)
      .where(
        and(
          eq(payments.id, input.paymentId),
          eq(payments.entityId, input.entityId)
        )
      )
      .for("update");
    if (!payment) throw new Error("accounting: payment not found");
    if (payment.voidedAt) throw new Error("accounting: payment is voided");
    if (payment.journalEntryId) {
      throw new Error("accounting: payment is already matched");
    }

    await tx
      .update(payments)
      .set({ unitEntityId: input.unitEntityId })
      .where(eq(payments.id, input.paymentId));

    const period = await periodForReceivedAt(
      tx,
      input.entityId,
      payment.receivedAt
    );
    await allocateAndPostPayment(tx, {
      paymentId: input.paymentId,
      entityId: input.entityId,
      periodId: period.id,
      country: input.country,
      unitEntityId: input.unitEntityId,
      amountCents: payment.amountCents,
      actorId: input.actorId,
      allocatedBy: "manual",
      matchedBy: "manual",
    });

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "update",
      tableName: "mod_accounting_payments",
      recordId: input.paymentId,
      after: { matchedUnitEntityId: input.unitEntityId, via: "reconciliation" },
    });
  });
}

/**
 * Treasurer rejects an unmatched bank line — it is not a member payment
 * (bank fee, interest credit, a transfer to another account, a duplicate the
 * dedupe key missed). The line never posted, so there is nothing to reverse:
 * it is marked voided (with an actor + reason) so it leaves the
 * reconciliation queue while staying on the record (10-year retention —
 * never hard-deleted). AC 439.
 */
export async function dismissBankLine(input: {
  entityId: string;
  paymentId: string;
  actorId: string;
  reason?: string | null;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [payment] = await tx
      .select({
        source: payments.source,
        journalEntryId: payments.journalEntryId,
        voidedAt: payments.voidedAt,
      })
      .from(payments)
      .where(
        and(
          eq(payments.id, input.paymentId),
          eq(payments.entityId, input.entityId)
        )
      )
      .for("update");
    if (!payment) throw new Error("accounting: payment not found");
    // Only unmatched imported lines are dismissable — a posted payment is
    // corrected through the void-with-reversal path, never silently hidden.
    if (payment.source !== "bank_import" && payment.source !== "fio_api") {
      throw new Error("accounting: only imported bank lines can be dismissed");
    }
    if (payment.voidedAt) throw new Error("accounting: line already dismissed");
    if (payment.journalEntryId) {
      throw new Error(
        "accounting: line is already matched — void the payment to reverse it"
      );
    }

    const reason = input.reason?.trim() || "dismissed in reconciliation";
    await tx
      .update(payments)
      .set({
        voidedAt: sql`now()`,
        voidedById: input.actorId,
        voidReason: reason,
      })
      .where(eq(payments.id, input.paymentId));

    await tx.insert(auditLog).values({
      entityId: input.entityId,
      actorId: input.actorId,
      action: "void",
      tableName: "mod_accounting_payments",
      recordId: input.paymentId,
      after: { dismissed: true, via: "reconciliation" },
      justification: reason,
    });
  });
}
