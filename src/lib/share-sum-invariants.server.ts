import "server-only";
import { isUnitHolderRole } from "@/lib/role-options";

import { runOwnershipChecks } from "@/lib/owner-checks";
import { loadOwnersSnapshot } from "@/lib/owners-board.server";

// BYT-20260511-001: housing units whose active owner memberships' sum of
// owner_unit_share_* does not equal 1/1. Shared by
// GET /api/admin/share-sum-invariants and the dashboard shell (banner).
//
// BYT-20261118-003: re-implemented on top of the pure ownership checks
// (src/lib/owner-checks.ts, exact rationals) and scoped to ONE community
// root — it used to scan every community of the instance. Reads the
// request-cached owners snapshot, so the shell banner, the nav badge and
// /owners share one set of queries per request.

export interface ShareSumViolation {
  unitEntityId: string;
  flatNumber: string;
  sumNumerator: string;
  sumDenominator: string;
}

export async function listShareSumViolations(
  rootId: string | null
): Promise<ShareSumViolation[]> {
  if (!rootId) return [];
  const { raw } = await loadOwnersSnapshot(rootId);
  const label = new Map(raw.unitRows.map((u) => [u.id, u.flatNumber ?? ""]));
  const findings = runOwnershipChecks(
    raw.unitRows.map((u) => ({ id: u.id })),
    raw.membershipRows
      .filter((m) => isUnitHolderRole(m.role))
      .map((m) => ({
        userId: m.userId,
        unitId: m.unitId,
        shareNum: m.shareNum,
        shareDen: m.shareDen,
        lvOrdinal: null,
        ownershipForm: null,
      })),
    { lvChecks: false }
  );
  return findings
    .filter((f) => f.code === "share_sum_mismatch")
    .map((f) => ({
      unitEntityId: f.unitIds[0],
      flatNumber: label.get(f.unitIds[0]) ?? "",
      sumNumerator: f.facts.sumNum ?? "0",
      sumDenominator: f.facts.sumDen ?? "1",
    }));
}
