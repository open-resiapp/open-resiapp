import "server-only";

import { headers } from "next/headers";

// Public URLs of the MCP resource server + OAuth authorization server
// (BYT-20261117-001 §2). The issuer and resource identifiers must be stable
// across replicas and requests, so they come from configuration
// (MCP_PUBLIC_URL → NEXTAUTH_URL → APP_URL), never from the Host header.
// The request origin is only a last-resort fallback for local dev.

export const MCP_PATH = "/api/mcp";

/** Access token lifetime (1 h). */
export const ACCESS_TOKEN_TTL_S = 60 * 60;
/** Refresh token lifetime (30 d, sliding on rotation). */
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;
/** Authorization code lifetime (60 s, single use). */
export const AUTH_CODE_TTL_S = 60;
/** How long a fetched CIMD document is trusted before it is re-fetched. */
export const CIMD_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function configuredOrigin(): string | null {
  const raw =
    process.env.MCP_PUBLIC_URL ||
    process.env.NEXTAUTH_URL ||
    process.env.AUTH_URL ||
    process.env.APP_URL ||
    "";
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Instance origin, e.g. "https://dom.resiapp.cloud" (no trailing slash). */
export function getPublicOrigin(fallbackRequestUrl?: string): string {
  const configured = configuredOrigin();
  if (configured) return configured;
  if (fallbackRequestUrl) return new URL(fallbackRequestUrl).origin;
  return "http://localhost:3000";
}

/** OAuth issuer (RFC 8414 / RFC 9207 `iss`). */
export function getIssuer(fallbackRequestUrl?: string): string {
  return getPublicOrigin(fallbackRequestUrl);
}

/** RFC 8707 resource / token audience: "<origin>/api/mcp". */
export function getResourceUrl(fallbackRequestUrl?: string): string {
  return `${getPublicOrigin(fallbackRequestUrl)}${MCP_PATH}`;
}

/** RFC 9728 metadata URL for the MCP resource (path-inserted form). */
export function getResourceMetadataUrl(fallbackRequestUrl?: string): string {
  return `${getPublicOrigin(fallbackRequestUrl)}/.well-known/oauth-protected-resource${MCP_PATH}`;
}

export function getAuthorizationEndpoint(fallbackRequestUrl?: string): string {
  return `${getPublicOrigin(fallbackRequestUrl)}/api/oauth/authorize`;
}

export function getTokenEndpoint(fallbackRequestUrl?: string): string {
  return `${getPublicOrigin(fallbackRequestUrl)}/api/oauth/token`;
}

export function getRegistrationEndpoint(fallbackRequestUrl?: string): string {
  return `${getPublicOrigin(fallbackRequestUrl)}/api/oauth/register`;
}

export function getRevocationEndpoint(fallbackRequestUrl?: string): string {
  return `${getPublicOrigin(fallbackRequestUrl)}/api/oauth/revoke`;
}

/**
 * Request URL for server components / server actions, which have no
 * `req.url`: built from x-forwarded-proto / x-forwarded-host (or host).
 * Pass it as `fallbackRequestUrl` — like route handlers pass `req.url` —
 * so the consent page and its action resolve the same origin as
 * /api/oauth/authorize when no public URL is configured. Configured
 * origins still win (getPublicOrigin).
 */
export async function requestUrlFromHeaders(): Promise<string | undefined> {
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!host) return undefined;
  const rawProto = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  const proto = rawProto === "http" || rawProto === "https" ? rawProto : "https";
  try {
    return new URL(`${proto}://${host}/`).toString();
  } catch {
    return undefined;
  }
}
