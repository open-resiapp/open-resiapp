import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { decodeClientDataJSON } from "@simplewebauthn/server/helpers";

import { db } from "@/db";
import { webauthnCredentials } from "@/db/schema";
import {
  ConfirmationUnavailableError,
  signToken,
  verifyToken,
} from "@/lib/signed-token.server";
import {
  PASSKEY_ACTIVATION_TTL_MS,
  PASSKEY_CHALLENGE_TTL_MS,
  type PasskeyErrorCode,
  type PasskeySummary,
} from "@/lib/webauthn";

// BYT-20261117-002 Phase 6: WebAuthn (passkeys) on @simplewebauthn/server v9.
//
// Stateless challenges: a challenge is the UTF-8 bytes of a signed token
// (src/lib/signed-token.server.ts). The browser echoes it back inside
// clientDataJSON, which the authenticator signs — so the server recovers and
// verifies the claims from the signed response itself. No challenge table,
// no per-node memory.
//
// RP ID / origin: taken from configuration, never from the request, when the
// install has a configured public URL — otherwise a reverse proxy under
// another domain could make the server accept that domain's passkeys.
//   WEBAUTHN_ORIGINS  optional, comma-separated full origins
//   WEBAUTHN_RP_ID    optional, defaults to the first origin's hostname
//   NEXTAUTH_URL / APP_URL  used when WEBAUTHN_ORIGINS is unset
// Only when none of these is set AND the server is not in production (bare
// local dev) is the request origin used. In production a missing public URL
// fails closed (ConfirmationUnavailableError → 503 CONFIRMATION_UNAVAILABLE):
// Host / X-Forwarded-Host are client-controlled.
//
// Activation: a newly registered passkey is stored with activated_at NULL and
// cannot confirm a ballot until the owner clicks a single-use e-mail link
// (signed token bound to user + credential, see activatePasskey). A session
// alone therefore never adds a working voting credential.

type RegistrationResponseJSON = Parameters<
  typeof verifyRegistrationResponse
>[0]["response"];
type AuthenticationResponseJSON = Parameters<
  typeof verifyAuthenticationResponse
>[0]["response"];
type AuthenticatorTransportFuture = NonNullable<
  Parameters<typeof verifyAuthenticationResponse>[0]["authenticator"]["transports"]
>[number];

const KNOWN_TRANSPORTS: AuthenticatorTransportFuture[] = [
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
];

// ── Origin / RP ID ──────────────────────────────────────

function toOrigin(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const proto =
    request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
    url.protocol.replace(":", "");
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0].trim() ||
    request.headers.get("host") ||
    url.host;
  return `${proto}://${host}`;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function configuredOrigins(): string[] {
  const explicit = (process.env.WEBAUTHN_ORIGINS || "")
    .split(",")
    .map((s) => toOrigin(s.trim()))
    .filter((s): s is string => Boolean(s));
  if (explicit.length > 0) return [...new Set(explicit)];
  return [
    ...new Set(
      [toOrigin(process.env.NEXTAUTH_URL), toOrigin(process.env.APP_URL)].filter(
        (s): s is string => Boolean(s)
      )
    ),
  ];
}

export function getWebAuthnConfig(request: Request): {
  rpID: string;
  rpName: string;
  origins: string[];
} {
  const configured = configuredOrigins();
  if (configured.length === 0 && isProduction()) {
    throw new ConfirmationUnavailableError("public-url");
  }
  const origins = configured.length > 0 ? configured : [requestOrigin(request)];
  const rpID =
    process.env.WEBAUTHN_RP_ID?.trim() || new URL(origins[0]).hostname;
  const rpName = process.env.APP_NAME?.trim() || rpID;
  return { rpID, rpName, origins };
}

/**
 * Public base URL for links in e-mails (no trailing slash). Production never
 * derives it from request headers (a forged Host would put an attacker's
 * domain into the confirmation link); it throws ConfirmationUnavailableError.
 */
export function getPublicAppUrl(request: Request): string {
  const configured =
    toOrigin(process.env.NEXTAUTH_URL) ??
    toOrigin(process.env.APP_URL) ??
    configuredOrigins()[0] ??
    null;
  if (configured) return configured;
  if (isProduction()) throw new ConfirmationUnavailableError("public-url");
  return requestOrigin(request);
}

// ── Credential store ────────────────────────────────────

export async function listPasskeys(userId: string): Promise<PasskeySummary[]> {
  const rows = await db
    .select({
      id: webauthnCredentials.id,
      deviceLabel: webauthnCredentials.deviceLabel,
      createdAt: webauthnCredentials.createdAt,
      lastUsedAt: webauthnCredentials.lastUsedAt,
      activatedAt: webauthnCredentials.activatedAt,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId))
    .orderBy(desc(webauthnCredentials.createdAt));
  return rows.map((r) => ({
    id: r.id,
    deviceLabel: r.deviceLabel,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    activatedAt: r.activatedAt ? r.activatedAt.toISOString() : null,
  }));
}

/** Whether the user has an ACTIVATED passkey (one that may confirm a ballot). */
export async function userHasPasskey(userId: string): Promise<boolean> {
  return (await userPasskeyState(userId)).active;
}

/** Active = may confirm ballots; pending = registered, waiting for the e-mail link. */
export async function userPasskeyState(
  userId: string
): Promise<{ active: boolean; pending: boolean }> {
  const rows = await db
    .select({ activatedAt: webauthnCredentials.activatedAt })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  return {
    active: rows.some((r) => r.activatedAt !== null),
    pending: rows.some((r) => r.activatedAt === null),
  };
}

/** A pending (not yet activated) passkey of this user, or null. */
export async function getPendingPasskey(
  userId: string,
  id: string
): Promise<{ id: string; credentialId: string; deviceLabel: string | null } | null> {
  const [row] = await db
    .select({
      id: webauthnCredentials.id,
      credentialId: webauthnCredentials.credentialId,
      deviceLabel: webauthnCredentials.deviceLabel,
    })
    .from(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.id, id),
        eq(webauthnCredentials.userId, userId),
        isNull(webauthnCredentials.activatedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function deletePasskey(userId: string, id: string): Promise<boolean> {
  const deleted = await db
    .delete(webauthnCredentials)
    .where(
      and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, userId))
    )
    .returning({ id: webauthnCredentials.id });
  return deleted.length > 0;
}

async function credentialDescriptors(userId: string, activeOnly: boolean) {
  const rows = await db
    .select({
      credentialId: webauthnCredentials.credentialId,
      transports: webauthnCredentials.transports,
    })
    .from(webauthnCredentials)
    .where(
      activeOnly
        ? and(
            eq(webauthnCredentials.userId, userId),
            isNotNull(webauthnCredentials.activatedAt)
          )
        : eq(webauthnCredentials.userId, userId)
    );
  return rows.map((r) => ({
    id: Buffer.from(r.credentialId, "base64url"),
    type: "public-key" as const,
    transports: sanitizeTransports(r.transports),
  }));
}

function sanitizeTransports(
  input: unknown
): AuthenticatorTransportFuture[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const out = input.filter((t): t is AuthenticatorTransportFuture =>
    KNOWN_TRANSPORTS.includes(t as AuthenticatorTransportFuture)
  );
  return out.length > 0 ? out : undefined;
}

/** Short human label from the User-Agent ("iPhone", "Android", "Mac", …). */
export function deviceLabelFromUserAgent(ua: string | null): string | null {
  if (!ua) return null;
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return null;
}

// ── Registration ────────────────────────────────────────

interface RegisterClaims {
  u: string;
}

export async function createRegistrationOptions(
  request: Request,
  user: { id: string; email: string | null; name: string }
) {
  const { rpID, rpName } = getWebAuthnConfig(request);
  const { token } = signToken<RegisterClaims>(
    "webauthn-register",
    { u: user.id },
    PASSKEY_CHALLENGE_TTL_MS
  );
  return generateRegistrationOptions({
    rpName,
    rpID,
    userID: user.id,
    userName: user.email || user.name,
    userDisplayName: user.name,
    challenge: token,
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    attestationType: "none",
    // Pending passkeys too — re-registering the same authenticator is never useful.
    excludeCredentials: await credentialDescriptors(user.id, false),
    authenticatorSelection: {
      // Discoverable: the same passkey also signs in without typing an e-mail.
      residentKey: "required",
      userVerification: "required",
    },
  });
}

/** Recover the signed token carried as a WebAuthn challenge. */
function challengeTokenFrom(clientDataJSON: unknown): {
  challenge: string;
  token: string;
} | null {
  if (typeof clientDataJSON !== "string") return null;
  try {
    const { challenge } = decodeClientDataJSON(clientDataJSON);
    if (typeof challenge !== "string") return null;
    return {
      challenge,
      token: Buffer.from(challenge, "base64url").toString("utf8"),
    };
  } catch {
    return null;
  }
}

export async function verifyRegistration(
  request: Request,
  userId: string,
  response: RegistrationResponseJSON,
  deviceLabel: string | null
): Promise<
  | { ok: true; id: string; credentialId: string; deviceLabel: string | null }
  | { ok: false; code: PasskeyErrorCode }
> {
  const recovered = challengeTokenFrom(response?.response?.clientDataJSON);
  if (!recovered) return { ok: false, code: "CHALLENGE_INVALID" };
  const v = verifyToken<RegisterClaims>("webauthn-register", recovered.token);
  if (!v.ok) {
    return {
      ok: false,
      code: v.error === "TOKEN_EXPIRED" ? "CHALLENGE_EXPIRED" : "CHALLENGE_INVALID",
    };
  }
  if (v.claims.u !== userId) return { ok: false, code: "CHALLENGE_INVALID" };

  const { rpID, origins } = getWebAuthnConfig(request);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: recovered.challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch {
    return { ok: false, code: "REGISTRATION_FAILED" };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, code: "REGISTRATION_FAILED" };
  }
  const { credentialID, credentialPublicKey, counter } =
    verification.registrationInfo;
  const credentialId = Buffer.from(credentialID).toString("base64url");

  const label = deviceLabel?.slice(0, 120) || null;
  // Stored inactive (activated_at NULL) — see activatePasskey.
  const inserted = await db
    .insert(webauthnCredentials)
    .values({
      userId,
      credentialId,
      publicKey: Buffer.from(credentialPublicKey).toString("base64url"),
      counter,
      transports: sanitizeTransports(response.response.transports) ?? null,
      deviceLabel: label,
      activatedAt: null,
    })
    .onConflictDoNothing({ target: webauthnCredentials.credentialId })
    .returning({ id: webauthnCredentials.id });
  if (inserted.length === 0) {
    return { ok: false, code: "PASSKEY_ALREADY_REGISTERED" };
  }
  return { ok: true, id: inserted[0].id, credentialId, deviceLabel: label };
}

// ── Activation (single-use e-mail link) ─────────────────

/** Claims of a passkey activation token: bound to the user AND the exact credential. */
export interface PasskeyActivationClaims {
  /** user id */
  u: string;
  /** credential row id */
  k: string;
  /** WebAuthn credential id (base64url) */
  c: string;
}

export function signPasskeyActivation(
  userId: string,
  cred: { id: string; credentialId: string }
): { token: string; expiresAt: Date } {
  const { token, claims } = signToken<PasskeyActivationClaims>(
    "webauthn-activate",
    { u: userId, k: cred.id, c: cred.credentialId },
    PASSKEY_ACTIVATION_TTL_MS
  );
  return { token, expiresAt: new Date(claims.exp) };
}

export type ActivationView =
  | { status: "invalid" | "expired" | "notFound" }
  | { status: "active" | "pending"; deviceLabel: string | null; createdAt: string };

/** Read-only description of an activation token for the link page (GET never activates). */
export async function describePasskeyActivation(token: unknown): Promise<ActivationView> {
  const v = verifyToken<PasskeyActivationClaims>("webauthn-activate", token);
  if (!v.ok) return { status: v.error === "TOKEN_EXPIRED" ? "expired" : "invalid" };
  const [row] = await db
    .select({
      deviceLabel: webauthnCredentials.deviceLabel,
      createdAt: webauthnCredentials.createdAt,
      activatedAt: webauthnCredentials.activatedAt,
    })
    .from(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.id, v.claims.k),
        eq(webauthnCredentials.userId, v.claims.u),
        eq(webauthnCredentials.credentialId, v.claims.c)
      )
    )
    .limit(1);
  if (!row) return { status: "notFound" };
  return {
    status: row.activatedAt ? "active" : "pending",
    deviceLabel: row.deviceLabel,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Activate a pending passkey of `userId`. Single use: the UPDATE only
 * matches while activated_at IS NULL, so a second click (or a concurrent
 * one on another replica) changes nothing and reports PASSKEY_ALREADY_ACTIVE.
 */
export async function activatePendingPasskey(
  userId: string,
  rowId: string,
  credentialId: string
): Promise<
  | { ok: true; deviceLabel: string | null; activatedAt: Date }
  | { ok: false; code: "PASSKEY_NOT_FOUND" | "PASSKEY_ALREADY_ACTIVE" }
> {
  const activatedAt = new Date();
  const updated = await db
    .update(webauthnCredentials)
    .set({ activatedAt })
    .where(
      and(
        eq(webauthnCredentials.id, rowId),
        eq(webauthnCredentials.userId, userId),
        eq(webauthnCredentials.credentialId, credentialId),
        isNull(webauthnCredentials.activatedAt)
      )
    )
    .returning({ deviceLabel: webauthnCredentials.deviceLabel });
  if (updated.length > 0) {
    return { ok: true, deviceLabel: updated[0].deviceLabel, activatedAt };
  }
  const [row] = await db
    .select({ activatedAt: webauthnCredentials.activatedAt })
    .from(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.id, rowId),
        eq(webauthnCredentials.userId, userId),
        eq(webauthnCredentials.credentialId, credentialId)
      )
    )
    .limit(1);
  return { ok: false, code: row ? "PASSKEY_ALREADY_ACTIVE" : "PASSKEY_NOT_FOUND" };
}

/** Verify an activation token and activate its passkey. */
export async function activatePasskey(
  token: unknown
): Promise<
  | { ok: true; userId: string; deviceLabel: string | null; activatedAt: Date }
  | { ok: false; code: PasskeyErrorCode }
> {
  const v = verifyToken<PasskeyActivationClaims>("webauthn-activate", token);
  if (!v.ok) {
    return {
      ok: false,
      code: v.error === "TOKEN_EXPIRED" ? "ACTIVATION_EXPIRED" : "ACTIVATION_INVALID",
    };
  }
  const r = await activatePendingPasskey(v.claims.u, v.claims.k, v.claims.c);
  if (!r.ok) return r;
  return { ok: true, userId: v.claims.u, deviceLabel: r.deviceLabel, activatedAt: r.activatedAt };
}

// ── Assertion (used to confirm a ballot) ────────────────

type CredentialRow = typeof webauthnCredentials.$inferSelect;

/**
 * Origin, RP ID, user verification, signature and signature counter of one
 * assertion against one stored credential. Returns the new counter, or null
 * when anything fails (counter regression = cloned authenticator, bad
 * signature, wrong origin / RP ID, missing user verification).
 */
async function checkAssertionSignature(
  request: Request,
  cred: CredentialRow,
  response: AuthenticationResponseJSON,
  expectedChallenge: string
): Promise<number | null> {
  const { rpID, origins } = getWebAuthnConfig(request);
  try {
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: true,
      authenticator: {
        credentialID: Buffer.from(cred.credentialId, "base64url"),
        credentialPublicKey: Buffer.from(cred.publicKey, "base64url"),
        counter: cred.counter,
        transports: sanitizeTransports(cred.transports),
      },
    });
    if (!verification.verified || !verification.authenticationInfo.userVerified) {
      return null;
    }
    return verification.authenticationInfo.newCounter;
  } catch {
    return null;
  }
}

/** Assertion options whose challenge is the given signed token. */
export async function createAssertionOptions(
  request: Request,
  userId: string,
  challengeToken: string
) {
  const { rpID } = getWebAuthnConfig(request);
  return generateAuthenticationOptions({
    rpID,
    challenge: challengeToken,
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    userVerification: "required",
    // Only activated passkeys may confirm a ballot.
    allowCredentials: await credentialDescriptors(userId, true),
  });
}

/** The signed token carried in an assertion's challenge, or null. */
export function assertionChallengeToken(
  response: AuthenticationResponseJSON
): { challenge: string; token: string } | null {
  return challengeTokenFrom(response?.response?.clientDataJSON);
}

export type AssertionResult =
  | {
      ok: true;
      credentialRowId: string;
      credentialId: string;
      /** Compact proof kept with the ballot (externally re-verifiable with the public key). */
      proof: string;
    }
  | {
      ok: false;
      code: "PASSKEY_NOT_FOUND" | "PASSKEY_PENDING" | "PASSKEY_VERIFICATION_FAILED";
    };

/**
 * Verify an assertion for `userId` against `expectedChallenge` (already
 * checked by the caller to be a valid signed token bound to the ballot).
 * Checks origin, RP ID, user verification, signature and the signature
 * counter, then advances the stored counter with a compare-and-set so two
 * concurrent uses of the same assertion cannot both pass.
 */
export async function verifyAssertion(
  request: Request,
  userId: string,
  response: AuthenticationResponseJSON,
  expectedChallenge: string
): Promise<AssertionResult> {
  if (!response || typeof response.id !== "string") {
    return { ok: false, code: "PASSKEY_NOT_FOUND" };
  }
  const [cred] = await db
    .select()
    .from(webauthnCredentials)
    .where(
      and(
        eq(webauthnCredentials.credentialId, response.id),
        eq(webauthnCredentials.userId, userId)
      )
    )
    .limit(1);
  if (!cred) return { ok: false, code: "PASSKEY_NOT_FOUND" };
  // A pending passkey (e-mail activation not clicked yet) never confirms.
  if (!cred.activatedAt) return { ok: false, code: "PASSKEY_PENDING" };

  const newCounter = await checkAssertionSignature(request, cred, response, expectedChallenge);
  if (newCounter === null) {
    return { ok: false, code: "PASSKEY_VERIFICATION_FAILED" };
  }

  const updated = await db
    .update(webauthnCredentials)
    .set({
      counter: newCounter,
      lastUsedAt: new Date(),
    })
    .where(
      and(
        eq(webauthnCredentials.id, cred.id),
        eq(webauthnCredentials.counter, cred.counter),
        isNotNull(webauthnCredentials.activatedAt)
      )
    )
    .returning({ id: webauthnCredentials.id });
  if (updated.length === 0) {
    return { ok: false, code: "PASSKEY_VERIFICATION_FAILED" };
  }

  // The public key travels with the proof so the assertion stays verifiable
  // by a third party even after the user removes this passkey.
  const proof = JSON.stringify({
    credentialId: cred.credentialId,
    publicKey: cred.publicKey,
    authenticatorData: response.response.authenticatorData,
    clientDataJSON: response.response.clientDataJSON,
    signature: response.response.signature,
  });
  return {
    ok: true,
    credentialRowId: cred.id,
    credentialId: cred.credentialId,
    proof,
  };
}

// ── Sign-in with a passkey ──────────────────────────────
//
// Discoverable credentials: the login challenge names no user, the browser
// offers the passkeys it holds for this site and the assertion's credential
// id tells us whose it is. Only ACTIVATED passkeys sign in — the same rule as
// for ballots, so a stolen session cannot add a passkey that later opens the
// account.
//
// Replay: the challenge is a signed token (5 min). Synced passkeys always
// report counter 0, so the counter alone cannot stop a captured assertion
// from being sent twice. The compare-and-set below therefore also requires
// that the passkey was not used after this challenge was issued
// (last_used_at < iat): once a login succeeds, the same assertion — and any
// other challenge issued before it — is rejected. Stateless, multi-replica
// safe (one conditional UPDATE).

interface LoginClaims {
  /** random nonce — makes every challenge unique */
  n: string;
}

export async function createLoginOptions(request: Request) {
  const { rpID } = getWebAuthnConfig(request);
  const { token } = signToken<LoginClaims>(
    "webauthn-login",
    { n: randomUUID() },
    PASSKEY_CHALLENGE_TTL_MS
  );
  return generateAuthenticationOptions({
    rpID,
    challenge: token,
    timeout: PASSKEY_CHALLENGE_TTL_MS,
    userVerification: "required",
  });
}

export type PasskeyLoginResult =
  | { ok: true; userId: string }
  | {
      ok: false;
      code:
        | "CHALLENGE_INVALID"
        | "CHALLENGE_EXPIRED"
        | "PASSKEY_NOT_FOUND"
        | "PASSKEY_PENDING"
        | "PASSKEY_VERIFICATION_FAILED";
    };

export async function verifyPasskeyLogin(
  request: Request,
  response: AuthenticationResponseJSON
): Promise<PasskeyLoginResult> {
  if (!response || typeof response.id !== "string") {
    return { ok: false, code: "PASSKEY_NOT_FOUND" };
  }
  const recovered = challengeTokenFrom(response?.response?.clientDataJSON);
  if (!recovered) return { ok: false, code: "CHALLENGE_INVALID" };
  const v = verifyToken<LoginClaims>("webauthn-login", recovered.token);
  if (!v.ok) {
    return {
      ok: false,
      code: v.error === "TOKEN_EXPIRED" ? "CHALLENGE_EXPIRED" : "CHALLENGE_INVALID",
    };
  }

  const [cred] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, response.id))
    .limit(1);
  if (!cred) return { ok: false, code: "PASSKEY_NOT_FOUND" };
  if (!cred.activatedAt) return { ok: false, code: "PASSKEY_PENDING" };

  const newCounter = await checkAssertionSignature(
    request,
    cred,
    response,
    recovered.challenge
  );
  if (newCounter === null) return { ok: false, code: "PASSKEY_VERIFICATION_FAILED" };

  const issuedAt = new Date(v.claims.iat);
  const updated = await db
    .update(webauthnCredentials)
    .set({ counter: newCounter, lastUsedAt: new Date() })
    .where(
      and(
        eq(webauthnCredentials.id, cred.id),
        eq(webauthnCredentials.counter, cred.counter),
        isNotNull(webauthnCredentials.activatedAt),
        or(
          isNull(webauthnCredentials.lastUsedAt),
          lt(webauthnCredentials.lastUsedAt, issuedAt)
        )
      )
    )
    .returning({ userId: webauthnCredentials.userId });
  if (updated.length === 0) return { ok: false, code: "PASSKEY_VERIFICATION_FAILED" };
  return { ok: true, userId: updated[0].userId };
}
