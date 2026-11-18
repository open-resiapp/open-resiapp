import "server-only";

import { and, desc, eq, gt, isNull, lt, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  oauthAuthorizationCodes,
  oauthClients,
  oauthTokens,
} from "@/db/schema";
import {
  ACCESS_TOKEN_TTL_S,
  AUTH_CODE_TTL_S,
  REFRESH_TOKEN_TTL_S,
} from "../config";
import type { Scope } from "../principal";
import { randomToken, sha256Hex, verifyPkceS256 } from "./crypto";
import { normalizeStoredScopes } from "./scopes";
import type { OAuthClientRow } from "./clients";

// Authorization codes + token families (BYT-20261117-001 §2). Every
// state transition is a single conditional UPDATE … RETURNING, so two
// replicas racing on the same code / refresh token can never both win.

export class GrantError extends Error {
  constructor(
    readonly error: "invalid_grant" | "invalid_request" | "invalid_target",
    readonly description: string
  ) {
    super(description);
    this.name = "GrantError";
  }
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scopes: Scope[];
}

// ── Authorization codes ─────────────────────────────────

export async function createAuthorizationCode(input: {
  client: OAuthClientRow;
  userId: string;
  codeChallenge: string;
  redirectUri: string;
  resource: string;
  scopes: readonly Scope[];
}): Promise<string> {
  const code = randomToken(32);
  await db.insert(oauthAuthorizationCodes).values({
    codeHash: sha256Hex(code),
    clientId: input.client.id,
    userId: input.userId,
    codeChallenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    resource: input.resource,
    scopes: [...input.scopes],
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_S * 1000),
  });
  // Opportunistic cleanup of long-dead codes (~2 %); never blocks the grant.
  if (Math.random() < 0.02) {
    db.delete(oauthAuthorizationCodes)
      .where(lt(oauthAuthorizationCodes.expiresAt, new Date(Date.now() - 24 * 3600 * 1000)))
      .catch(() => {});
  }
  return code;
}

async function insertTokenRow(input: {
  familyId: string;
  clientRowId: string;
  userId: string;
  scopes: readonly Scope[];
  resource: string;
}): Promise<IssuedTokens> {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const now = Date.now();
  await db.insert(oauthTokens).values({
    accessHash: sha256Hex(accessToken),
    refreshHash: sha256Hex(refreshToken),
    familyId: input.familyId,
    clientId: input.clientRowId,
    userId: input.userId,
    scopes: [...input.scopes],
    resource: input.resource,
    accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_S * 1000),
    refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_S * 1000),
  });
  return {
    accessToken,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_S,
    scopes: [...input.scopes],
  };
}

/** authorization_code grant: single-use, 60 s, PKCE S256, resource match. */
export async function exchangeAuthorizationCode(input: {
  code: string;
  client: OAuthClientRow;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
  isUserActive: (userId: string) => Promise<boolean>;
}): Promise<{ tokens: IssuedTokens; userId: string }> {
  const [row] = await db
    .update(oauthAuthorizationCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(oauthAuthorizationCodes.codeHash, sha256Hex(input.code)),
        isNull(oauthAuthorizationCodes.usedAt),
        gt(oauthAuthorizationCodes.expiresAt, new Date())
      )
    )
    .returning();
  if (!row) {
    await revokeFamilyOfReusedCode(input.code);
    throw new GrantError("invalid_grant", "authorization code is invalid, expired or already used");
  }
  if (row.clientId !== input.client.id) {
    throw new GrantError("invalid_grant", "authorization code was issued to another client");
  }
  if (row.redirectUri !== input.redirectUri) {
    throw new GrantError("invalid_grant", "redirect_uri does not match the authorization request");
  }
  if (row.resource !== input.resource) {
    throw new GrantError("invalid_target", "resource does not match the authorization request");
  }
  if (!verifyPkceS256(input.codeVerifier, row.codeChallenge)) {
    throw new GrantError("invalid_grant", "PKCE verification failed");
  }
  if (!(await input.isUserActive(row.userId))) {
    throw new GrantError("invalid_grant", "user is not active");
  }
  const tokens = await insertTokenRow({
    // The family id IS the code row id, so a later replay of this code can
    // find and revoke everything issued from it without a schema change.
    familyId: row.id,
    clientRowId: row.clientId,
    userId: row.userId,
    scopes: normalizeStoredScopes(row.scopes),
    resource: row.resource,
  });
  return { tokens, userId: row.userId };
}

/**
 * RFC 6749 §4.1.2: a code presented again after it was redeemed → revoke
 * every token issued from it (the family whose id is the code row id; the
 * family's later refresh rotations keep that id). An unknown / merely
 * expired code revokes nothing. Read + one conditional UPDATE, PK / indexed.
 */
async function revokeFamilyOfReusedCode(code: string): Promise<void> {
  const [used] = await db
    .select({ id: oauthAuthorizationCodes.id, usedAt: oauthAuthorizationCodes.usedAt })
    .from(oauthAuthorizationCodes)
    .where(eq(oauthAuthorizationCodes.codeHash, sha256Hex(code)))
    .limit(1);
  if (used?.usedAt) await revokeFamily(used.id);
}

// ── Refresh (rotation + reuse detection) ────────────────

export async function revokeFamily(familyId: string): Promise<void> {
  await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(oauthTokens.familyId, familyId), isNull(oauthTokens.revokedAt)));
}

/**
 * refresh_token grant. The presented token's row is consumed atomically
 * (refreshUsedAt + revokedAt); a NEW row in the same family is issued.
 * Presenting a token whose row was already consumed = reuse → the whole
 * family is revoked (RFC 9700 §4.14.2).
 */
export async function rotateRefreshToken(input: {
  refreshToken: string;
  client: OAuthClientRow;
  resource: string | null;
  isUserActive: (userId: string) => Promise<boolean>;
}): Promise<{ tokens: IssuedTokens; userId: string }> {
  const hash = sha256Hex(input.refreshToken);
  const [existing] = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.refreshHash, hash))
    .limit(1);
  if (!existing) throw new GrantError("invalid_grant", "unknown refresh token");
  if (existing.clientId !== input.client.id) {
    throw new GrantError("invalid_grant", "refresh token was issued to another client");
  }
  if (existing.refreshUsedAt) {
    await revokeFamily(existing.familyId);
    throw new GrantError("invalid_grant", "refresh token reuse detected; grant revoked");
  }
  if (existing.revokedAt) throw new GrantError("invalid_grant", "grant revoked");
  if (!existing.refreshExpiresAt || existing.refreshExpiresAt.getTime() <= Date.now()) {
    throw new GrantError("invalid_grant", "refresh token expired");
  }
  if (input.resource !== null && input.resource !== existing.resource) {
    throw new GrantError("invalid_target", "resource does not match the grant");
  }
  if (!(await input.isUserActive(existing.userId))) {
    await revokeFamily(existing.familyId);
    throw new GrantError("invalid_grant", "user is not active");
  }

  const [consumed] = await db
    .update(oauthTokens)
    .set({ refreshUsedAt: new Date(), revokedAt: new Date() })
    .where(
      and(
        eq(oauthTokens.id, existing.id),
        isNull(oauthTokens.refreshUsedAt),
        isNull(oauthTokens.revokedAt)
      )
    )
    .returning({ id: oauthTokens.id });
  if (!consumed) {
    // Lost a race with a concurrent refresh of the same token = reuse.
    await revokeFamily(existing.familyId);
    throw new GrantError("invalid_grant", "refresh token reuse detected; grant revoked");
  }

  const tokens = await insertTokenRow({
    familyId: existing.familyId,
    clientRowId: existing.clientId,
    userId: existing.userId,
    scopes: normalizeStoredScopes(existing.scopes),
    resource: existing.resource,
  });
  return { tokens, userId: existing.userId };
}

// ── Access token validation ─────────────────────────────

export interface ValidAccessToken {
  tokenId: string;
  familyId: string;
  userId: string;
  clientRowId: string;
  clientId: string;
  clientName: string;
  /**
   * MCP Apps UI capability the client declared at its last `initialize`
   * (null = never recorded) + the protocol version and when — see
   * src/lib/mcp/client-capabilities.ts.
   */
  clientAppsUi: boolean | null;
  clientProtocolVersion: string | null;
  clientCapabilitiesSeenAt: Date | null;
  scopes: Scope[];
  resource: string;
  expiresAt: Date;
}

const LAST_USED_RESOLUTION_MS = 60_000;

/**
 * Looks an access token up by hash; null when unknown, revoked, expired or
 * bound to another audience. Stamps lastUsedAt (at most once a minute).
 */
export async function validateAccessToken(
  accessToken: string,
  expectedResource: string
): Promise<ValidAccessToken | null> {
  const [row] = await db
    .select({
      token: oauthTokens,
      clientId: oauthClients.clientId,
      clientName: oauthClients.name,
      clientAppsUi: oauthClients.appsUiDeclared,
      clientProtocolVersion: oauthClients.mcpProtocolVersion,
      clientCapabilitiesSeenAt: oauthClients.capabilitiesSeenAt,
    })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
    .where(eq(oauthTokens.accessHash, sha256Hex(accessToken)))
    .limit(1);
  if (!row) return null;
  const t = row.token;
  if (t.revokedAt) return null;
  if (t.accessExpiresAt.getTime() <= Date.now()) return null;
  if (t.resource !== expectedResource) return null;

  if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    db.update(oauthTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(oauthTokens.id, t.id))
      .catch(() => {});
  }

  return {
    tokenId: t.id,
    familyId: t.familyId,
    userId: t.userId,
    clientRowId: t.clientId,
    clientId: row.clientId,
    clientName: row.clientName,
    clientAppsUi: row.clientAppsUi,
    clientProtocolVersion: row.clientProtocolVersion,
    clientCapabilitiesSeenAt: row.clientCapabilitiesSeenAt,
    scopes: normalizeStoredScopes(t.scopes),
    resource: t.resource,
    expiresAt: t.accessExpiresAt,
  };
}

// ── Revocation ──────────────────────────────────────────

/** RFC 7009: revoke the family of whichever token (access or refresh) matches. */
export async function revokeByToken(token: string): Promise<void> {
  const hash = sha256Hex(token);
  const [row] = await db
    .select({ familyId: oauthTokens.familyId })
    .from(oauthTokens)
    .where(or(eq(oauthTokens.accessHash, hash), eq(oauthTokens.refreshHash, hash)))
    .limit(1);
  if (row) await revokeFamily(row.familyId);
}

/** Module disabled / admin "revoke all": every live token on the instance. */
export async function revokeAllTokens(): Promise<number> {
  const rows = await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(isNull(oauthTokens.revokedAt))
    .returning({ id: oauthTokens.id });
  await db
    .update(oauthAuthorizationCodes)
    .set({ usedAt: new Date() })
    .where(isNull(oauthAuthorizationCodes.usedAt));
  return rows.length;
}

// ── Grants (profile "Connected AI apps") ────────────────

export interface UserGrant {
  familyId: string;
  clientName: string;
  clientId: string;
  logoUri: string | null;
  scopes: Scope[];
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Live grants of a user: one per token family that still has an unrevoked
 * row whose refresh token has not expired.
 */
export async function listUserGrants(userId: string): Promise<UserGrant[]> {
  const rows = await db
    .select({
      familyId: oauthTokens.familyId,
      scopes: oauthTokens.scopes,
      createdAt: sql<Date>`min(${oauthTokens.createdAt})`.mapWith((v) => new Date(v)),
      lastUsedAt: sql<Date | null>`max(${oauthTokens.lastUsedAt})`.mapWith((v) =>
        v ? new Date(v) : null
      ),
      clientName: oauthClients.name,
      clientId: oauthClients.clientId,
      logoUri: oauthClients.logoUri,
    })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthClients.id, oauthTokens.clientId))
    .where(
      and(
        eq(oauthTokens.userId, userId),
        sql`${oauthTokens.familyId} IN (
          SELECT family_id FROM oauth_tokens
          WHERE user_id = ${userId}
            AND revoked_at IS NULL
            AND refresh_expires_at > now()
        )`
      )
    )
    .groupBy(
      oauthTokens.familyId,
      oauthTokens.scopes,
      oauthClients.name,
      oauthClients.clientId,
      oauthClients.logoUri
    )
    .orderBy(desc(sql`max(${oauthTokens.lastUsedAt})`));

  // Scopes never change inside a family, but group-by on jsonb could split
  // a family if they did — merge defensively.
  const byFamily = new Map<string, UserGrant>();
  for (const r of rows) {
    const prev = byFamily.get(r.familyId);
    const lastUsed = r.lastUsedAt ? r.lastUsedAt.toISOString() : null;
    if (prev) {
      if (lastUsed && (!prev.lastUsedAt || lastUsed > prev.lastUsedAt)) prev.lastUsedAt = lastUsed;
      continue;
    }
    byFamily.set(r.familyId, {
      familyId: r.familyId,
      clientName: r.clientName,
      clientId: r.clientId,
      logoUri: r.logoUri,
      scopes: normalizeStoredScopes(r.scopes),
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: lastUsed,
    });
  }
  return [...byFamily.values()];
}

/** Revokes one of the user's grants; false when it isn't theirs. */
export async function revokeUserGrant(userId: string, familyId: string): Promise<boolean> {
  const rows = await db
    .update(oauthTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(oauthTokens.userId, userId),
        eq(oauthTokens.familyId, familyId),
        isNull(oauthTokens.revokedAt)
      )
    )
    .returning({ id: oauthTokens.id });
  return rows.length > 0;
}
