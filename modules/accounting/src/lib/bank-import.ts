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

  // Counterparty IBANs learned ONLY from HUMAN-confirmed matches (any
  // allocation with allocatedBy='manual', i.e. reconciliation confirms).
  // Learning from auto-matches would make a single wrong VS auto-match
  // self-reinforcing: the wrong unit "learns" the payer's IBAN and every
  // later payment from that account keeps auto-matching wrongly.
  const ibans = await tx
    .selectDistinct({
      unitEntityId: payments.unitEntityId,
      iban: payments.counterpartyIban,
    })
    .from(payments)
    .innerJoin(
      paymentAllocations,
      eq(paymentAllocations.paymentId, payments.id)
    )
    .where(
      and(
        eq(payments.entityId, entityId),
        isNotNull(payments.unitEntityId),
        isNotNull(payments.counterpartyIban),
        isNull(payments.voidedAt),
        eq(paymentAllocations.allocatedBy, "manual")
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
const LEDGER_CURRENCY: Record<Country, string> = { sk: "EUR", cz: "CZK" };

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
  const expectedCurrency = LEDGER_CURRENCY[input.country];
  for (const stmt of statements) {
    for (const line of stmt.transactions) {
      if (line.currency && line.currency !== expectedCurrency) {
        throw new Error(
          `accounting: statement carries ${line.currency} amounts — this ledger books ${expectedCurrency}`
        );
      }
    }
  }

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

    const matchable = await gatherMatchableUnits(tx, input.entityId);

    const summary: ImportSummary = {
      statements: statements.length,
      credits: 0,
      imported: 0,
      skippedDuplicates: 0,
      autoMatched: 0,
      needsReview: 0,
      debitsSkipped: 0,
    };

    for (const stmt of statements) {
      let position = 0;
      for (const line of stmt.transactions) {
        position += 1;
        if (line.direction === "debit") {
          summary.debitsSkipped += 1;
          continue;
        }
        if (line.amountCents <= 0) {
          // Zero-amount informational entries carry no money.
          continue;
        }
        summary.credits += 1;

        // Idempotency key: the bank's AcctSvcrRef, or a synthesized
        // statement-scoped key when the bank omits it — a NULL key would
        // bypass the unique index and re-import the line on every upload.
        const externalTxId =
          line.externalTxId ??
          `stmt:${stmt.iban ?? "?"}:${stmt.statementId ?? "?"}:${position}`;

        // Pre-check scoped to the dom (the unique index is per entity —
        // AcctSvcrRef is only unique per bank, not across doms).
        const [existing] = await tx
          .select({ id: payments.id })
          .from(payments)
          .where(
            and(
              eq(payments.entityId, input.entityId),
              eq(payments.externalTxId, externalTxId)
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
            source: "bank_import",
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
            externalTxId,
            rawPayload: line as unknown as Record<string, unknown>,
            createdById: input.actorId,
          })
          .returning({ id: payments.id });
        summary.imported += 1;

        if (autoUnit) {
          // Same fiscal-year rule as manual entry — the payment's
          // receivedAt year when that period is open, else current open.
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
          });
          summary.autoMatched += 1;
        } else {
          summary.needsReview += 1;
        }
      }
    }

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
          eq(payments.source, "bank_import"),
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
