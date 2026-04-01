import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { checkRateLimit, RATE_LIMITS, getClientIp } from "@/lib/rate-limiter";
import { logExternalApiRequest } from "@/lib/audit-log";

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || undefined;
  const endpoint = "/api/external/v1/health";

  const rateLimited = checkRateLimit(request, RATE_LIMITS.health, "health");
  if (rateLimited) {
    logExternalApiRequest({
      endpoint,
      method: "GET",
      ipAddress: ip,
      userAgent,
      statusCode: 429,
      authResult: "rate_limited",
      responseTimeMs: Date.now() - startTime,
    });
    return rateLimited;
  }

  try {
    // Simple DB connectivity check — no data leakage
    await db.execute(sql`SELECT 1`);

    logExternalApiRequest({
      endpoint,
      method: "GET",
      ipAddress: ip,
      userAgent,
      statusCode: 200,
      authResult: "unauthenticated",
      responseTimeMs: Date.now() - startTime,
    });

    return NextResponse.json({ status: "ok" });
  } catch {
    logExternalApiRequest({
      endpoint,
      method: "GET",
      ipAddress: ip,
      userAgent,
      statusCode: 503,
      authResult: "unauthenticated",
      responseTimeMs: Date.now() - startTime,
    });

    return NextResponse.json({ status: "unhealthy" }, { status: 503 });
  }
}
