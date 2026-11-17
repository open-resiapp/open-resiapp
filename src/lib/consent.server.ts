import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { consentRecords } from "@/db/schema";
import type { ConsentRecord } from "@/types";
import { CURRENT_POLICY_VERSION } from "@/lib/consent";

export interface ConsentStatus {
  /** Latest record per consent type (data_processing, communication). */
  consents: Record<string, ConsentRecord>;
  currentPolicyVersion: string;
  /** True unless the latest data_processing record is a grant of the current policy version. */
  needsConsent: boolean;
}

/**
 * GDPR consent status for one user. Shared by GET /api/consents and the
 * dashboard server layout (ShellData) so the rule lives in one place.
 */
export async function getConsentStatus(userId: string): Promise<ConsentStatus> {
  const records = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.userId, userId))
    .orderBy(desc(consentRecords.createdAt));

  // Find latest record per consent type
  const latestByType: Record<string, ConsentRecord> = {};
  for (const record of records) {
    if (!latestByType[record.consentType]) {
      latestByType[record.consentType] = record;
    }
  }

  const dataProcessing = latestByType["data_processing"];
  const hasValidDataProcessing =
    dataProcessing?.action === "granted" &&
    dataProcessing.policyVersion === CURRENT_POLICY_VERSION;

  return {
    consents: latestByType,
    currentPolicyVersion: CURRENT_POLICY_VERSION,
    needsConsent: !hasValidDataProcessing,
  };
}
