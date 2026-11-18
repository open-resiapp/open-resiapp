import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { ssoConsumedTokens } from "@/db/schema";

// BYT-20261117-002 Phase 6: stateless, signed, short-lived tokens.
//
// Format: base64url(JSON payload) "." base64url(HMAC-SHA256(key, payloadPart))
// The key is derived per purpose from the existing auth secret
// (AUTH_SECRET, falling back to NEXTAUTH_SECRET) — no new env var, no DB row,
// no per-node memory, so every replica verifies every token. A token minted
// for one purpose never verifies for another (different derived key + the
// purpose is also inside the payload).
//
// These tokens are an INTERNAL authenticity mechanism (like a session
// cookie). They are never part of an externally-verifiable audit artefact,
// so mixing in the server secret is fine (docs/domain/voting.md invariant
// on secretless audit hashes is about audit leaves, not about this).

export type SignedTokenPurpose =
  | "vote-passkey"
  | "vote-email"
  | "vote-withdraw-passkey"
  | "vote-withdraw-email"
  | "webauthn-register"
  | "webauthn-activate"
  | "webauthn-login"
  // BYT-20261118-001: one-click meeting RSVP from the invitation e-mail.
  // Claims { postId, userId }; can only upsert / clear that user's RSVP.
  | "meeting-rsvp";

export interface SignedTokenClaims {
  /** purpose */
  p: SignedTokenPurpose;
  /** issued-at, epoch ms */
  iat: number;
  /** expiry, epoch ms */
  exp: number;
  /** random nonce — makes every token (and WebAuthn challenge) unique */
  n: string;
}

export type SignedTokenError =
  | "TOKEN_MALFORMED"
  | "TOKEN_BAD_SIGNATURE"
  | "TOKEN_WRONG_PURPOSE"
  | "TOKEN_EXPIRED";

/**
 * Confirmation (passkey / e-mail link) cannot work on this install because
 * of missing configuration. Routes map it to 503 CONFIRMATION_UNAVAILABLE.
 *   "secret"     — AUTH_SECRET / NEXTAUTH_SECRET missing (or < 32 chars in production)
 *   "public-url" — production without NEXTAUTH_URL / APP_URL / WEBAUTHN_ORIGINS
 */
export class ConfirmationUnavailableError extends Error {
  readonly reason: "secret" | "public-url";
  constructor(reason: "secret" | "public-url" = "secret") {
    super(
      reason === "secret"
        ? "AUTH_SECRET / NEXTAUTH_SECRET is not set or too short"
        : "NEXTAUTH_URL / APP_URL / WEBAUTHN_ORIGINS is not configured"
    );
    this.name = "ConfirmationUnavailableError";
    this.reason = reason;
  }
}
/** Older name, kept so existing `instanceof` checks keep working. */
export { ConfirmationUnavailableError as SignedTokenUnavailableError };

const MIN_PRODUCTION_SECRET_LENGTH = 32;

function serverSecret(): string {
  // `||` so an empty AUTH_SECRET="" falls through to NEXTAUTH_SECRET.
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new ConfirmationUnavailableError("secret");
  // Fail closed in production: a short secret makes every vote token forgeable.
  if (
    process.env.NODE_ENV === "production" &&
    secret.length < MIN_PRODUCTION_SECRET_LENGTH
  ) {
    throw new ConfirmationUnavailableError("secret");
  }
  return secret;
}

function deriveKey(purpose: SignedTokenPurpose): Buffer {
  return createHmac("sha256", serverSecret())
    .update(`open-housing/signed-token/v1/${purpose}`, "utf8")
    .digest();
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

export function signToken<T extends object>(
  purpose: SignedTokenPurpose,
  claims: T,
  ttlMs: number,
  now: number = Date.now()
): { token: string; claims: T & SignedTokenClaims } {
  const full = {
    ...claims,
    p: purpose,
    iat: now,
    exp: now + ttlMs,
    n: randomBytes(12).toString("base64url"),
  } as T & SignedTokenClaims;
  const payloadPart = b64url(JSON.stringify(full));
  const sig = createHmac("sha256", deriveKey(purpose))
    .update(payloadPart, "utf8")
    .digest();
  return { token: `${payloadPart}.${b64url(sig)}`, claims: full };
}

export function verifyToken<T extends object>(
  purpose: SignedTokenPurpose,
  token: unknown,
  now: number = Date.now()
):
  | { ok: true; claims: T & SignedTokenClaims }
  | { ok: false; error: SignedTokenError } {
  if (typeof token !== "string" || token.length > 8192) {
    return { ok: false, error: "TOKEN_MALFORMED" };
  }
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, error: "TOKEN_MALFORMED" };
  }
  const [payloadPart, sigPart] = parts;
  const expected = createHmac("sha256", deriveKey(purpose))
    .update(payloadPart, "utf8")
    .digest();
  let given: Buffer;
  try {
    given = Buffer.from(sigPart, "base64url");
  } catch {
    return { ok: false, error: "TOKEN_MALFORMED" };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, error: "TOKEN_BAD_SIGNATURE" };
  }
  let claims: T & SignedTokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "TOKEN_MALFORMED" };
  }
  if (!claims || typeof claims !== "object" || claims.p !== purpose) {
    return { ok: false, error: "TOKEN_WRONG_PURPOSE" };
  }
  if (typeof claims.exp !== "number" || typeof claims.iat !== "number") {
    return { ok: false, error: "TOKEN_MALFORMED" };
  }
  if (now > claims.exp) {
    return { ok: false, error: "TOKEN_EXPIRED" };
  }
  return { ok: true, claims };
}

// ── Revocation markers ──────────────────────────────────
//
// A stateless token cannot be "taken back" once issued. Where an event must
// invalidate every token issued before it (a withdrawn ballot: the unit's
// state goes back to "no ballot", so a token minted before the first vote
// would match again), the event writes ONE marker row; verification then
// rejects tokens whose `iat` is at or before the marker time.
//
// Storage: the existing `sso_consumed_tokens` table (jti PK, expires_at,
// consumed_at) — it already is the app's "consumed / revoked token" store,
// shared by every replica, no schema change. Keys are prefixed `tokrev:` so
// they can never collide with SSO JWT ids (UUIDs). `expires_at` = marker
// time + the longest token lifetime: after that every token the marker
// guards has expired anyway, so the row may be pruned.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function revocationKey(scope: string): string {
  return `tokrev:${createHash("sha256").update(scope, "utf8").digest("base64url")}`;
}

/** Invalidate every token for `scope` issued at or before `at`. Call inside the transaction that performs the event. */
export async function revokeTokensIssuedBefore(
  tx: Tx,
  scope: string,
  at: Date,
  maxTokenTtlMs: number
): Promise<void> {
  const expiresAt = new Date(at.getTime() + maxTokenTtlMs);
  await tx
    .insert(ssoConsumedTokens)
    .values({ jti: revocationKey(scope), consumedAt: at, expiresAt })
    .onConflictDoUpdate({
      target: ssoConsumedTokens.jti,
      set: {
        consumedAt: sql`greatest(${ssoConsumedTokens.consumedAt}, excluded.consumed_at)`,
        expiresAt: sql`greatest(${ssoConsumedTokens.expiresAt}, excluded.expires_at)`,
      },
    });
}

/** Epoch ms of the latest revocation for `scope`, or 0. */
export async function tokensRevokedAt(tx: Tx | typeof db, scope: string): Promise<number> {
  const [row] = await (tx as typeof db)
    .select({ at: ssoConsumedTokens.consumedAt })
    .from(ssoConsumedTokens)
    .where(eq(ssoConsumedTokens.jti, revocationKey(scope)))
    .limit(1);
  return row ? row.at.getTime() : 0;
}
