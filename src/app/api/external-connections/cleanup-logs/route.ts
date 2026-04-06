import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { externalApiLogs } from "@/db/schema";
import { lt } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function POST() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageApiKeys")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  const result = await db
    .delete(externalApiLogs)
    .where(lt(externalApiLogs.createdAt, ninetyDaysAgo))
    .returning({ id: externalApiLogs.id });

  return NextResponse.json({ deleted: result.length });
}
