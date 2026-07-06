import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  accountingPeriods,
  auditLog,
  journalEntries,
  journalLines,
  settlements,
  settlementUnits,
} from "../db/schema";
import { buildIntegrity, verifyIntegrity, type VerifyResult } from "./export-format";
import { getTrialBalance } from "./accountant-view";

// Signed export bundle for the kontrolná komisia (spec §Accounting
// closes & audit): reproduces the full ledger + audit log and verifies
// tamper-evidently — the komisia (or a court) uploads the file back and
// the server attests it is byte-identical to what it produced, no DB
// access needed on the verifier's side.

type Country = "sk" | "cz";

function serverSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "accounting: NEXTAUTH_SECRET is not set — signed exports unavailable"
    );
  }
  return secret;
}

export async function buildExportBundle(input: {
  entityId: string;
  country: Country;
  entityName: string;
  generatedById: string;
}): Promise<string> {
  const periods = await db
    .select({
      id: accountingPeriods.id,
      year: accountingPeriods.year,
      status: accountingPeriods.status,
    })
    .from(accountingPeriods)
    .where(eq(accountingPeriods.entityId, input.entityId))
    .orderBy(asc(accountingPeriods.year));

  const entries = await db
    .select({
      id: journalEntries.id,
      periodId: journalEntries.periodId,
      postedAt: journalEntries.postedAt,
      description: journalEntries.description,
      sourceType: journalEntries.sourceType,
      sourceId: journalEntries.sourceId,
      createdById: journalEntries.createdById,
      createdAt: journalEntries.createdAt,
    })
    .from(journalEntries)
    .where(eq(journalEntries.entityId, input.entityId))
    .orderBy(asc(journalEntries.createdAt));

  const lines =
    entries.length > 0
      ? await db
          .select({
            journalEntryId: journalLines.journalEntryId,
            accountCode: accounts.code,
            debitCents: journalLines.debitCents,
            creditCents: journalLines.creditCents,
            okruh: journalLines.okruh,
            unitEntityId: journalLines.unitEntityId,
            serviceCategoryId: journalLines.serviceCategoryId,
          })
          .from(journalLines)
          .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
          .where(
            inArray(
              journalLines.journalEntryId,
              entries.map((e) => e.id)
            )
          )
      : [];

  const audit = await db
    .select({
      id: auditLog.id,
      actorId: auditLog.actorId,
      action: auditLog.action,
      tableName: auditLog.tableName,
      recordId: auditLog.recordId,
      before: auditLog.before,
      after: auditLog.after,
      justification: auditLog.justification,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(eq(auditLog.entityId, input.entityId))
    .orderBy(asc(auditLog.createdAt));

  const settlementRows = await db
    .select({
      id: settlements.id,
      periodId: settlements.periodId,
      publishedAt: settlements.publishedAt,
      publishedById: settlements.publishedById,
    })
    .from(settlements)
    .where(eq(settlements.entityId, input.entityId));
  const settlementUnitRows =
    settlementRows.length > 0
      ? await db
          .select({
            settlementId: settlementUnits.settlementId,
            unitEntityId: settlementUnits.unitEntityId,
            payload: settlementUnits.payload,
            totalCostCents: settlementUnits.totalCostCents,
            totalAdvancesCents: settlementUnits.totalAdvancesCents,
            totalDifferenceCents: settlementUnits.totalDifferenceCents,
          })
          .from(settlementUnits)
          .where(
            inArray(
              settlementUnits.settlementId,
              settlementRows.map((s) => s.id)
            )
          )
      : [];

  const trialBalance = await getTrialBalance(input.entityId, input.country);

  const payload = {
    format: "open-resiapp-accounting-export",
    version: 1,
    entity: { id: input.entityId, name: input.entityName },
    generatedAt: new Date().toISOString(),
    generatedById: input.generatedById,
    periods,
    journal: { entries, lines },
    auditLog: audit,
    settlements: { headers: settlementRows, units: settlementUnitRows },
    trialBalance,
  };

  const payloadJson = JSON.stringify(payload);
  const integrity = buildIntegrity(payloadJson, serverSecret());
  // The bundle embeds the payload VERBATIM as the signed string — the
  // verifier hashes exactly what sits between the payload markers, so no
  // canonicalization questions arise.
  return JSON.stringify({ payload, integrity });
}

export function verifyExportBundle(bundleJson: string): VerifyResult & {
  generatedAt?: string;
} {
  let parsed: { payload?: unknown; integrity?: unknown };
  try {
    parsed = JSON.parse(bundleJson);
  } catch {
    return { valid: false, reason: "sha256_mismatch" };
  }
  if (!parsed.payload || !parsed.integrity) {
    return { valid: false, reason: "sha256_mismatch" };
  }
  const result = verifyIntegrity(
    JSON.stringify(parsed.payload),
    parsed.integrity as Parameters<typeof verifyIntegrity>[1],
    serverSecret()
  );
  if (result.valid) {
    const generatedAt = (parsed.payload as { generatedAt?: string })
      .generatedAt;
    return { valid: true, generatedAt };
  }
  return result;
}
