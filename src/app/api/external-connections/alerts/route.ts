import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { externalApiLogs, pairingRequests } from "@/db/schema";
import { eq, and, gt, inArray } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageApiKeys")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const [failedAuthLogs, rateLimitedLogs, lockedPairings] = await Promise.all([
    db
      .select({ id: externalApiLogs.id })
      .from(externalApiLogs)
      .where(
        and(
          inArray(externalApiLogs.authResult, [
            "invalid_key",
            "insufficient_permission",
          ]),
          gt(externalApiLogs.createdAt, oneHourAgo)
        )
      ),
    db
      .select({ id: externalApiLogs.id })
      .from(externalApiLogs)
      .where(
        and(
          eq(externalApiLogs.authResult, "rate_limited"),
          gt(externalApiLogs.createdAt, oneHourAgo)
        )
      ),
    db
      .select({ id: pairingRequests.id })
      .from(pairingRequests)
      .where(eq(pairingRequests.status, "locked")),
  ]);

  const totalAlerts =
    failedAuthLogs.length + rateLimitedLogs.length + lockedPairings.length;

  return NextResponse.json({
    failedAuth: failedAuthLogs.length,
    rateLimited: rateLimitedLogs.length,
    lockedPairings: lockedPairings.length,
    totalAlerts,
  });
}
