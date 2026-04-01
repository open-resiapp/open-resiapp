import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { building } from "@/db/schema";
import { completePairing } from "@/lib/pairing";
import { checkRateLimit, RATE_LIMITS, getClientIp } from "@/lib/rate-limiter";
import { logExternalApiRequest } from "@/lib/audit-log";
import {
  validatePartA,
  validatePartB,
  validateAppName,
  sanitizeAppName,
} from "@/lib/input-validation";

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || undefined;
  const endpoint = "/api/external/v1/pair";

  const rateLimited = checkRateLimit(request, RATE_LIMITS.pair, "pair");
  if (rateLimited) {
    logExternalApiRequest({
      endpoint,
      method: "POST",
      ipAddress: ip,
      userAgent,
      statusCode: 429,
      authResult: "rate_limited",
      responseTimeMs: Date.now() - startTime,
    });
    return rateLimited;
  }

  try {
    const body = await request.json();
    const { partA, partB, appName } = body;

    if (!partA || !partB || !appName) {
      return NextResponse.json(
        { error: "Missing required fields: partA, partB, appName" },
        { status: 400 }
      );
    }

    // Validate input formats before any expensive operations
    if (!validatePartA(partA)) {
      return NextResponse.json(
        { error: "Invalid pairing code format" },
        { status: 400 }
      );
    }
    if (!validatePartB(partB)) {
      return NextResponse.json(
        { error: "Invalid key format" },
        { status: 400 }
      );
    }
    if (!validateAppName(appName)) {
      return NextResponse.json(
        { error: "Invalid application name" },
        { status: 400 }
      );
    }

    const sanitizedAppName = sanitizeAppName(appName);

    const result = await completePairing({
      partA,
      partB,
      appName: sanitizedAppName,
      ip,
    });

    if (!result.success) {
      logExternalApiRequest({
        endpoint,
        method: "POST",
        ipAddress: ip,
        userAgent,
        statusCode: 400,
        authResult: "invalid_key",
        responseTimeMs: Date.now() - startTime,
      });
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // Return building info
    const [buildingInfo] = await db.select().from(building).limit(1);

    logExternalApiRequest({
      connectionId: result.connectionId,
      endpoint,
      method: "POST",
      ipAddress: ip,
      userAgent,
      statusCode: 200,
      authResult: "success",
      responseTimeMs: Date.now() - startTime,
    });

    return NextResponse.json({
      success: true,
      buildingId: buildingInfo?.id || null,
      buildingName: buildingInfo?.name || null,
      buildingAddress: buildingInfo?.address || null,
      keyPrefix: result.keyPrefix,
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
