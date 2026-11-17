import "server-only";

import type { NextRequest } from "next/server";

import { routing } from "@/i18n/routing";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limiter";
import { getUserAuthRow } from "@/lib/user-context";
import {
  getAuthorizationEndpoint,
  getIssuer,
  getPublicOrigin,
  getRegistrationEndpoint,
  getResourceUrl,
  getRevocationEndpoint,
  getTokenEndpoint,
} from "../config";
import { isMcpEnabled } from "../module-state";
import {
  authorizeParamsToQuery,
  errorRedirectFor,
  readAuthorizeParams,
  validateAuthorizeRequest,
} from "./authorize";
import { ClientError, getClientByClientId, registerDcrClient } from "./clients";
import { ADVERTISED_SCOPES, formatScopes } from "./scopes";
import {
  exchangeAuthorizationCode,
  GrantError,
  revokeByToken,
  rotateRefreshToken,
  type IssuedTokens,
} from "./tokens";

// OAuth 2.1 authorization-server endpoints + RFC 9728 / RFC 8414 metadata
// (BYT-20261117-001 §2). Route files under src/app re-export these. Every
// endpoint 404s while the `mcp` module is disabled.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

const notFound = () => new Response(null, { status: 404 });

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS_HEADERS, "Cache-Control": "no-store", Pragma: "no-cache", ...extra },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

export async function handleOAuthPreflight(): Promise<Response> {
  if (!(await isMcpEnabled())) return notFound();
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// ── Metadata ────────────────────────────────────────────

/** RFC 9728 Protected Resource Metadata for <origin>/api/mcp. */
export async function handleProtectedResourceMetadata(req: NextRequest): Promise<Response> {
  if (!(await isMcpEnabled())) return notFound();
  return json(
    {
      resource: getResourceUrl(req.url),
      authorization_servers: [getIssuer(req.url)],
      scopes_supported: [...ADVERTISED_SCOPES],
      bearer_methods_supported: ["header"],
      resource_name: "ResiApp MCP",
    },
    200,
    { "Cache-Control": "public, max-age=300" }
  );
}

/** RFC 8414 Authorization Server Metadata. */
export async function handleAuthorizationServerMetadata(req: NextRequest): Promise<Response> {
  if (!(await isMcpEnabled())) return notFound();
  return json(
    {
      issuer: getIssuer(req.url),
      authorization_endpoint: getAuthorizationEndpoint(req.url),
      token_endpoint: getTokenEndpoint(req.url),
      registration_endpoint: getRegistrationEndpoint(req.url),
      revocation_endpoint: getRevocationEndpoint(req.url),
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [...ADVERTISED_SCOPES],
      authorization_response_iss_parameter_supported: true,
      client_id_metadata_document_supported: true,
    },
    200,
    { "Cache-Control": "public, max-age=300" }
  );
}

// ── Authorization endpoint ──────────────────────────────

function pickLocale(req: NextRequest): string {
  const cookie = req.cookies.get("NEXT_LOCALE")?.value;
  const locales = routing.locales as readonly string[];
  if (cookie && locales.includes(cookie)) return cookie;
  return routing.defaultLocale;
}

/**
 * GET /api/oauth/authorize — validates the request and hands the browser to
 * the localized consent page. Bad client / redirect_uri → consent page shows
 * the error (no redirect to an unverified URI); other errors → client
 * redirect_uri with `error` + `iss`.
 */
export async function handleAuthorize(req: NextRequest): Promise<Response> {
  if (!(await isMcpEnabled())) return notFound();
  const limited = checkRateLimit(req, RATE_LIMITS.oauth, "oauth");
  if (limited) return limited;

  const params = readAuthorizeParams(req.nextUrl.searchParams);
  const origin = getPublicOrigin(req.url);
  const locale = pickLocale(req);
  const v = await validateAuthorizeRequest(params, req.url);

  if (v.kind === "redirect_error") {
    return Response.redirect(errorRedirectFor(v, req.url), 302);
  }
  // ok AND fatal both go to the consent page — it re-validates and renders
  // either the consent screen or the error.
  return Response.redirect(
    `${origin}/${locale}/oauth/authorize?${authorizeParamsToQuery(params)}`,
    302
  );
}

// ── Token endpoint ──────────────────────────────────────

async function readForm(req: NextRequest): Promise<URLSearchParams | null> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  try {
    if (type.includes("application/x-www-form-urlencoded")) {
      return new URLSearchParams(await req.text());
    }
    if (type.includes("application/json")) {
      const body = (await req.json()) as Record<string, unknown>;
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(body ?? {})) {
        if (typeof v === "string") p.set(k, v);
      }
      return p;
    }
  } catch {
    return null;
  }
  return null;
}

function tokenResponse(tokens: IssuedTokens): Response {
  return json({
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: tokens.expiresIn,
    refresh_token: tokens.refreshToken,
    scope: formatScopes(tokens.scopes),
  });
}

async function isUserActive(userId: string): Promise<boolean> {
  const user = await getUserAuthRow(userId);
  return user?.status === "active";
}

/** POST /api/oauth/token — authorization_code + refresh_token grants. */
export async function handleToken(req: NextRequest): Promise<Response> {
  if (!(await isMcpEnabled())) return notFound();
  const limited = checkRateLimit(req, RATE_LIMITS.oauth, "oauth");
  if (limited) return limited;

  const form = await readForm(req);
  if (!form) return oauthError("invalid_request", "body must be application/x-www-form-urlencoded");
  if (form.get("client_secret") || req.headers.get("authorization")) {
    return oauthError("invalid_client", "only public clients are supported", 401);
  }

  const clientId = form.get("client_id");
  if (!clientId) return oauthError("invalid_request", "client_id is required");
  const client = await getClientByClientId(clientId);
  if (!client) return oauthError("invalid_client", "unknown client_id", 401);

  const grantType = form.get("grant_type");
  try {
    if (grantType === "authorization_code") {
      const code = form.get("code");
      const redirectUri = form.get("redirect_uri");
      const codeVerifier = form.get("code_verifier");
      const resource = form.get("resource");
      if (!code || !redirectUri || !codeVerifier) {
        return oauthError("invalid_request", "code, redirect_uri and code_verifier are required");
      }
      if (!resource) return oauthError("invalid_target", "resource is required");
      if (resource !== getResourceUrl(req.url)) {
        return oauthError("invalid_target", "resource must be this server's MCP endpoint");
      }
      const { tokens } = await exchangeAuthorizationCode({
        code,
        client,
        redirectUri,
        codeVerifier,
        resource,
        isUserActive,
      });
      return tokenResponse(tokens);
    }

    if (grantType === "refresh_token") {
      const refreshToken = form.get("refresh_token");
      if (!refreshToken) return oauthError("invalid_request", "refresh_token is required");
      const resource = form.get("resource");
      if (resource && resource !== getResourceUrl(req.url)) {
        return oauthError("invalid_target", "resource must be this server's MCP endpoint");
      }
      const { tokens } = await rotateRefreshToken({
        refreshToken,
        client,
        resource: resource || null,
        isUserActive,
      });
      return tokenResponse(tokens);
    }

    return oauthError("unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
  } catch (err) {
    if (err instanceof GrantError) return oauthError(err.error, err.description);
    throw err;
  }
}

// ── Dynamic Client Registration (RFC 7591) ──────────────

/** POST /api/oauth/register — public clients only; deprecated fallback to CIMD. */
export async function handleRegister(req: NextRequest): Promise<Response> {
  if (!(await isMcpEnabled())) return notFound();
  const limited = checkRateLimit(req, RATE_LIMITS.oauth, "oauth-register");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return oauthError("invalid_client_metadata", "body must be JSON");
  }
  try {
    const row = await registerDcrClient(body);
    return json(
      {
        client_id: row.clientId,
        client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
        client_name: row.name,
        redirect_uris: row.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        ...(row.logoUri ? { logo_uri: row.logoUri } : {}),
        ...(row.clientUri ? { client_uri: row.clientUri } : {}),
      },
      201
    );
  } catch (err) {
    if (err instanceof ClientError) return oauthError(err.error, err.description);
    throw err;
  }
}

// ── Revocation (RFC 7009) ───────────────────────────────

/** POST /api/oauth/revoke — revokes the token's whole family; always 200. */
export async function handleRevoke(req: NextRequest): Promise<Response> {
  if (!(await isMcpEnabled())) return notFound();
  const limited = checkRateLimit(req, RATE_LIMITS.oauth, "oauth");
  if (limited) return limited;
  const form = await readForm(req);
  const token = form?.get("token");
  if (!token) return oauthError("invalid_request", "token is required");
  await revokeByToken(token);
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}
