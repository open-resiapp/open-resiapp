import "server-only";

import { getIssuer, getResourceUrl } from "../config";
import type { Scope } from "../principal";
import {
  ClientError,
  redirectUriAllowed,
  resolveClient,
  type OAuthClientRow,
} from "./clients";
import { isValidS256Challenge } from "./crypto";
import { parseScopeParam } from "./scopes";

// Authorization request validation (BYT-20261117-001 §2), shared by the
// /api/oauth/authorize endpoint, the consent page and its server action so
// all three apply exactly the same rules:
//   - client_id + redirect_uri are checked FIRST; if either is bad the user
//     is NOT redirected back (RFC 6749 §4.1.2.1) — the consent page shows
//     an error instead;
//   - everything else is reported to the client's redirect_uri with
//     `error`, `state` and `iss` (RFC 9207).
// Rules: response_type=code, PKCE S256 only (plain / missing method
// rejected), `resource` required and equal to <origin>/api/mcp, scopes known.

export const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
  "resource",
] as const;

export type AuthorizeParams = Partial<Record<(typeof AUTHORIZE_PARAMS)[number], string>>;

export type AuthorizeValidation =
  | { kind: "fatal"; reason: "invalid_client" | "invalid_redirect_uri"; description: string }
  | {
      kind: "redirect_error";
      redirectUri: string;
      error: string;
      description: string;
      state: string | null;
    }
  | {
      kind: "ok";
      client: OAuthClientRow;
      redirectUri: string;
      scopes: Scope[];
      codeChallenge: string;
      state: string | null;
      resource: string;
    };

/** Pulls the known parameters out of URLSearchParams / FormData. */
export function readAuthorizeParams(
  source: URLSearchParams | FormData
): AuthorizeParams {
  const out: AuthorizeParams = {};
  for (const key of AUTHORIZE_PARAMS) {
    const v = source.get(key);
    if (typeof v === "string" && v.length > 0 && v.length <= 4096) out[key] = v;
  }
  return out;
}

export function authorizeParamsToQuery(params: AuthorizeParams): string {
  const q = new URLSearchParams();
  for (const key of AUTHORIZE_PARAMS) {
    const v = params[key];
    if (v !== undefined) q.set(key, v);
  }
  return q.toString();
}

export async function validateAuthorizeRequest(
  params: AuthorizeParams,
  requestUrl?: string
): Promise<AuthorizeValidation> {
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  if (!clientId) {
    return { kind: "fatal", reason: "invalid_client", description: "client_id is required" };
  }
  let client: OAuthClientRow;
  try {
    client = await resolveClient(clientId);
  } catch (err) {
    return {
      kind: "fatal",
      reason: "invalid_client",
      description: err instanceof ClientError ? err.description : "unknown client",
    };
  }
  if (!redirectUri || !redirectUriAllowed(client, redirectUri)) {
    return {
      kind: "fatal",
      reason: "invalid_redirect_uri",
      description: "redirect_uri is not registered for this client",
    };
  }

  const state = params.state ?? null;
  const fail = (error: string, description: string): AuthorizeValidation => ({
    kind: "redirect_error",
    redirectUri,
    error,
    description,
    state,
  });

  if (params.response_type !== "code") {
    return fail("unsupported_response_type", "response_type must be code");
  }
  if (params.code_challenge_method !== "S256") {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  if (!params.code_challenge || !isValidS256Challenge(params.code_challenge)) {
    return fail("invalid_request", "code_challenge is missing or malformed");
  }
  const expectedResource = getResourceUrl(requestUrl);
  if (!params.resource) {
    return fail("invalid_target", "resource is required");
  }
  if (params.resource !== expectedResource) {
    return fail("invalid_target", "resource must be this server's MCP endpoint");
  }
  const scopes = parseScopeParam(params.scope);
  if (!scopes) return fail("invalid_scope", "unknown scope requested");

  return {
    kind: "ok",
    client,
    redirectUri,
    scopes,
    codeChallenge: params.code_challenge,
    state,
    resource: expectedResource,
  };
}

/** redirect_uri + response parameters (+ `iss`, RFC 9207), preserving its query. */
export function buildClientRedirect(
  redirectUri: string,
  values: Record<string, string | null | undefined>,
  requestUrl?: string
): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(values)) {
    if (v !== null && v !== undefined) url.searchParams.set(k, v);
  }
  url.searchParams.set("iss", getIssuer(requestUrl));
  return url.toString();
}

export function errorRedirectFor(
  v: Extract<AuthorizeValidation, { kind: "redirect_error" }>,
  requestUrl?: string
): string {
  return buildClientRedirect(
    v.redirectUri,
    { error: v.error, error_description: v.description, state: v.state },
    requestUrl
  );
}
