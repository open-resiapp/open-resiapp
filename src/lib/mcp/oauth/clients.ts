import "server-only";

import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { oauthClients } from "@/db/schema";
import { CIMD_CACHE_TTL_MS } from "../config";
import { randomToken } from "./crypto";
import { SafeFetchError, assertFetchableUrl, safeFetchJson } from "./safe-fetch";

// OAuth client resolution (BYT-20261117-001 §2):
//   - CIMD first: a client_id that is an https URL is a Client ID Metadata
//     Document; fetched SSRF-safe, validated, cached in oauth_clients (24 h).
//   - DCR (RFC 7591) fallback: random client_id issued by /api/oauth/register.
// Only public clients (token_endpoint_auth_method "none") — PKCE protects
// the code; no client secrets are ever issued or accepted.

export type OAuthClientRow = typeof oauthClients.$inferSelect;

export class ClientError extends Error {
  constructor(
    readonly error: "invalid_client" | "invalid_client_metadata" | "invalid_redirect_uri",
    readonly description: string
  ) {
    super(description);
    this.name = "ClientError";
  }
}

/** Is `client_id` a CIMD URL (https with a path)? */
export function isCimdClientId(clientId: string): boolean {
  try {
    const u = new URL(clientId);
    return u.protocol === "https:" && u.pathname.length > 1;
  } catch {
    return false;
  }
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Redirect URI policy: https anywhere, or http on a loopback host (native
 * apps, RFC 8252 §7.3). No fragments, no credentials.
 */
export function isAcceptableRedirectUri(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) return true;
  // Private-use URI schemes for native apps (e.g. "com.example.app:/cb").
  if (/^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/i.test(u.protocol)) return true;
  return false;
}

/** Exact string match against the registered list (OAuth 2.1 §2.3.1). */
export function redirectUriAllowed(client: OAuthClientRow, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri);
}

function str(v: unknown, max = 2048): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

function safeHttpsUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    return new URL(s).protocol === "https:" ? s : null;
  } catch {
    return null;
  }
}

interface ParsedMetadata {
  name: string;
  logoUri: string | null;
  clientUri: string | null;
  redirectUris: string[];
}

/** Shared validation of a client metadata object (CIMD document or DCR body). */
export function parseClientMetadata(
  raw: unknown,
  fallbackName: string
): ParsedMetadata {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ClientError("invalid_client_metadata", "metadata must be a JSON object");
  }
  const m = raw as Record<string, unknown>;
  if (m.client_secret !== undefined || m.client_secret_expires_at !== undefined) {
    throw new ClientError("invalid_client_metadata", "client secrets are not supported");
  }
  const authMethod = m.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== "none") {
    throw new ClientError(
      "invalid_client_metadata",
      "only public clients (token_endpoint_auth_method=none) are supported"
    );
  }
  // Grant types we don't support are ignored, not rejected (RFC 7591 §2):
  // Claude's CIMD lists jwt-bearer too. The token endpoint only ever issues
  // authorization_code / refresh_token grants, so extras grant nothing.
  if (m.grant_types !== undefined) {
    if (
      !Array.isArray(m.grant_types) ||
      !m.grant_types.every((g) => typeof g === "string") ||
      !m.grant_types.includes("authorization_code")
    ) {
      throw new ClientError("invalid_client_metadata", "grant_types must include authorization_code");
    }
  }
  if (m.response_types !== undefined) {
    if (!Array.isArray(m.response_types) || !m.response_types.every((r) => r === "code")) {
      throw new ClientError("invalid_client_metadata", "unsupported response_types");
    }
  }
  const redirectUris = m.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > 20 ||
    !redirectUris.every((u) => typeof u === "string" && u.length <= 2048 && isAcceptableRedirectUri(u))
  ) {
    throw new ClientError("invalid_redirect_uri", "redirect_uris must be a non-empty list of https or loopback URIs");
  }
  return {
    name: (str(m.client_name, 255) ?? fallbackName).slice(0, 255),
    logoUri: safeHttpsUrl(m.logo_uri),
    clientUri: safeHttpsUrl(m.client_uri),
    redirectUris: redirectUris as string[],
  };
}

async function fetchCimd(clientId: string): Promise<ParsedMetadata> {
  try {
    assertFetchableUrl(clientId);
  } catch (err) {
    throw new ClientError(
      "invalid_client",
      `client_id URL not fetchable (${err instanceof SafeFetchError ? err.reason : "invalid"})`
    );
  }
  const u = new URL(clientId);
  if (u.hash || /(^|\/)\.\.?(\/|$)/.test(u.pathname)) {
    throw new ClientError("invalid_client", "client_id URL must not contain fragments or dot segments");
  }
  let doc: unknown;
  try {
    doc = await safeFetchJson(clientId);
  } catch (err) {
    throw new ClientError(
      "invalid_client",
      `client metadata document could not be fetched (${err instanceof SafeFetchError ? err.reason : "error"})`
    );
  }
  if (!doc || typeof doc !== "object" || (doc as Record<string, unknown>).client_id !== clientId) {
    throw new ClientError("invalid_client", "client metadata document client_id does not match");
  }
  return parseClientMetadata(doc, u.hostname);
}

async function findByClientId(clientId: string): Promise<OAuthClientRow | null> {
  const [row] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  return row ?? null;
}

/**
 * Resolves a `client_id` to a client row. CIMD ids are (re)fetched when the
 * cache is stale; DCR ids must already exist. Throws ClientError.
 */
export async function resolveClient(clientId: string): Promise<OAuthClientRow> {
  if (!clientId || clientId.length > 2048) {
    throw new ClientError("invalid_client", "client_id missing");
  }
  const cached = await findByClientId(clientId);

  if (!isCimdClientId(clientId)) {
    if (!cached || cached.source !== "dcr") {
      throw new ClientError("invalid_client", "unknown client_id");
    }
    return cached;
  }

  if (
    cached &&
    cached.source === "cimd" &&
    cached.fetchedAt &&
    Date.now() - cached.fetchedAt.getTime() < CIMD_CACHE_TTL_MS
  ) {
    return cached;
  }

  const meta = await fetchCimd(clientId);
  const [row] = await db
    .insert(oauthClients)
    .values({
      clientId,
      source: "cimd",
      name: meta.name,
      logoUri: meta.logoUri,
      clientUri: meta.clientUri,
      redirectUris: meta.redirectUris,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: oauthClients.clientId,
      set: {
        source: "cimd",
        name: meta.name,
        logoUri: meta.logoUri,
        clientUri: meta.clientUri,
        redirectUris: meta.redirectUris,
        fetchedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/** Looks up an already-known client by its OAuth client_id (token endpoint). */
export function getClientByClientId(clientId: string): Promise<OAuthClientRow | null> {
  return findByClientId(clientId);
}

const STALE_CIMD_MS = 30 * 24 * 3600 * 1000;
const PRUNE_BATCH = 20;
const PRUNE_PROBABILITY = 0.05;

/**
 * Opportunistic, bounded cleanup of cached CIMD client rows nobody uses:
 * not re-fetched for 30 days and no codes / tokens point at them. Safe to
 * drop — a CIMD client is re-fetched on its next authorize. One short
 * statement (≤ PRUNE_BATCH rows), no background job, runs on ~5 % of DCR
 * registrations; the outer WHERE repeats the predicate so a row touched
 * concurrently by another replica (re-fetch, new code) is re-checked and
 * kept. Fire-and-forget: never blocks or fails the registration.
 */
function maybePruneStaleCimdClients(): void {
  if (Math.random() >= PRUNE_PROBABILITY) return;
  const cutoff = new Date(Date.now() - STALE_CIMD_MS);
  const unused = sql`c.source = 'cimd'
      AND c.fetched_at < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM oauth_tokens t WHERE t.client_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM oauth_authorization_codes a WHERE a.client_id = c.id)`;
  db.execute(
    sql`DELETE FROM oauth_clients c
        WHERE c.id IN (SELECT c.id FROM oauth_clients c WHERE ${unused} LIMIT ${PRUNE_BATCH})
          AND ${unused}`
  ).catch((err) => console.warn("[oauth] CIMD prune skipped:", (err as Error).message));
}

/** RFC 7591 registration of a public client. */
export async function registerDcrClient(metadata: unknown): Promise<OAuthClientRow> {
  const meta = parseClientMetadata(metadata, "AI app");
  maybePruneStaleCimdClients();
  const [row] = await db
    .insert(oauthClients)
    .values({
      clientId: `dcr_${randomToken(24)}`,
      source: "dcr",
      name: meta.name,
      logoUri: meta.logoUri,
      clientUri: meta.clientUri,
      redirectUris: meta.redirectUris,
      fetchedAt: null,
    })
    .returning();
  return row;
}
