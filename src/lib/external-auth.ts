import { NextRequest, NextResponse } from "next/server";
import { validateApiKeyFromRequest, type ValidatedApiKey } from "./api-keys";
import { checkRateLimit, RATE_LIMITS, getClientIp } from "./rate-limiter";
import { logExternalApiRequest } from "./audit-log";
import type { ApiKeyPermission } from "@/types";

const PERMISSION_HIERARCHY: Record<ApiKeyPermission, number> = {
  read: 1,
  read_write: 2,
  full: 3,
};

function hasRequiredPermission(
  actual: ApiKeyPermission,
  required: ApiKeyPermission
): boolean {
  return PERMISSION_HIERARCHY[actual] >= PERMISSION_HIERARCHY[required];
}

type ExternalHandler = (
  request: NextRequest,
  apiKey: ValidatedApiKey,
  context?: { params: Promise<Record<string, string>> }
) => Promise<NextResponse>;

export function withExternalAuth(
  handler: ExternalHandler,
  requiredPermission: ApiKeyPermission
) {
  return async (
    request: NextRequest,
    context?: { params: Promise<Record<string, string>> }
  ) => {
    const startTime = Date.now();
    const ip = getClientIp(request);
    const userAgent = request.headers.get("user-agent") || undefined;
    const endpoint = new URL(request.url).pathname;
    const method = request.method;

    // Rate limit before auth (prevents bcrypt DoS)
    const rateLimited = checkRateLimit(request, RATE_LIMITS.api, "api");
    if (rateLimited) {
      logExternalApiRequest({
        endpoint,
        method,
        ipAddress: ip,
        userAgent,
        statusCode: 429,
        authResult: "rate_limited",
        responseTimeMs: Date.now() - startTime,
      });
      return rateLimited;
    }

    const apiKey = await validateApiKeyFromRequest(request);

    if (!apiKey) {
      logExternalApiRequest({
        endpoint,
        method,
        ipAddress: ip,
        userAgent,
        statusCode: 401,
        authResult: request.headers.get("X-API-Key")
          ? "invalid_key"
          : "unauthenticated",
        responseTimeMs: Date.now() - startTime,
      });
      return NextResponse.json(
        { error: "Missing or invalid API key" },
        { status: 401 }
      );
    }

    if (!hasRequiredPermission(apiKey.permissions, requiredPermission)) {
      logExternalApiRequest({
        connectionId: apiKey.id,
        endpoint,
        method,
        ipAddress: ip,
        userAgent,
        statusCode: 403,
        authResult: "insufficient_permission",
        responseTimeMs: Date.now() - startTime,
      });
      return NextResponse.json(
        { error: "Insufficient permissions" },
        { status: 403 }
      );
    }

    const response = await handler(request, apiKey, context);

    logExternalApiRequest({
      connectionId: apiKey.id,
      endpoint,
      method,
      ipAddress: ip,
      userAgent,
      statusCode: response.status,
      authResult: "success",
      responseTimeMs: Date.now() - startTime,
    });

    return response;
  };
}
