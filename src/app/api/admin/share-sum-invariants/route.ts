import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { resolveBoardRootId } from "@/lib/current-entity";
import { hasPermission } from "@/lib/permissions";
import { listShareSumViolations } from "@/lib/share-sum-invariants.server";
import type { UserRole } from "@/types";

/**
 * Admin-only: list housing_unit entities whose active memberships' sum of
 * owner_unit_share_* does not equal 1/1. Logic lives in
 * src/lib/share-sum-invariants.server.ts (also read by the dashboard
 * server layout for the BYT-20260511-001 banner).
 */
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // BYT-20261118-003: only units of the caller's current community.
  const rootId = await resolveBoardRootId(session.user.id);
  return NextResponse.json({ invalid: await listShareSumViolations(rootId) });
}
