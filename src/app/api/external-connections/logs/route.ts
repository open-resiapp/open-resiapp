import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { externalApiLogs } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageApiKeys")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const connectionId = searchParams.get("connectionId");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")));
  const offset = (page - 1) * limit;

  const query = db
    .select()
    .from(externalApiLogs)
    .orderBy(desc(externalApiLogs.createdAt))
    .limit(limit)
    .offset(offset);

  const logs = connectionId
    ? await query.where(eq(externalApiLogs.connectionId, connectionId))
    : await query;

  return NextResponse.json({ logs, page, limit });
}
