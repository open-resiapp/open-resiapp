import "server-only";

import type { NextRequest } from "next/server";

import { checkRateLimit, checkRateLimitKey, RATE_LIMITS } from "@/lib/rate-limiter";
import { getResourceMetadataUrl, getResourceUrl } from "./config";
import { sha256Hex } from "./oauth/crypto";
import { ADVERTISED_SCOPES, formatScopes } from "./oauth/scopes";
import { validateAccessToken, type ValidAccessToken } from "./oauth/tokens";

// Bearer authentication for /api/mcp (BYT-20261117-001 §2, §7). Mirrors
// external-auth.ts: rate-limit BEFORE the token lookup (per IP and per
// token fingerprint), then validate audience / expiry / revocation.

function challengeHeader(reqUrl: string, error?: "invalid_token"): string {
  const parts = [
    `resource_metadata="${getResourceMetadataUrl(reqUrl)}"`,
    `scope="${formatScopes(ADVERTISED_SCOPES)}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  return `Bearer ${parts.join(", ")}`;
}

/** 401 with the RFC 9728 discovery challenge. */
export function unauthorizedResponse(reqUrl: string, tokenPresented: boolean): Response {
  return Response.json(
    tokenPresented
      ? { error: "invalid_token", error_description: "The access token is invalid, expired or revoked" }
      : { error: "unauthorized", error_description: "Bearer token required" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": challengeHeader(reqUrl, tokenPresented ? "invalid_token" : undefined),
        "Cache-Control": "no-store",
      },
    }
  );
}

function rateLimitedResponse(retryAfter: number): Response {
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "Retry-After": String(retryAfter) } }
  );
}

export type BearerResult =
  | { ok: true; token: ValidAccessToken; rawToken: string }
  | { ok: false; response: Response };

export async function authenticateBearer(req: NextRequest): Promise<BearerResult> {
  // AI hosts send every user from a few egress IPs: generous per-IP cap that
  // never feeds the IP block list; the per-token limit below is the main one.
  const ipLimited = checkRateLimit(req, RATE_LIMITS.mcpIp, "mcp-ip", { blockOnRepeat: false });
  if (ipLimited) return { ok: false, response: ipLimited };

  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(header.trim());
  if (!match) return { ok: false, response: unauthorizedResponse(req.url, header.length > 0) };
  const rawToken = match[1];

  // Per-token limit keyed by a fingerprint — checked before the DB lookup.
  const retryAfter = checkRateLimitKey(sha256Hex(rawToken).slice(0, 32), RATE_LIMITS.mcpToken, "mcp-token");
  if (retryAfter !== null) return { ok: false, response: rateLimitedResponse(retryAfter) };

  const token = await validateAccessToken(rawToken, getResourceUrl(req.url));
  if (!token) return { ok: false, response: unauthorizedResponse(req.url, true) };
  return { ok: true, token, rawToken };
}
