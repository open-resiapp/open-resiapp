import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";

// Opaque token helpers (BYT-20261117-001 §2). Tokens / codes are random
// base64url strings; the DB only ever sees their SHA-256 hex digest.

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** RFC 7636 §4.1 verifier grammar: 43–128 chars of [A-Za-z0-9-._~]. */
export function isValidCodeVerifier(v: string): boolean {
  return /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
}

/** S256 challenge = base64url(SHA-256(verifier)), 43 chars. */
export function isValidS256Challenge(c: string): boolean {
  return /^[A-Za-z0-9\-_]{43}$/.test(c);
}

/** Constant-time PKCE S256 check. `plain` is never accepted. */
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!isValidCodeVerifier(verifier)) return false;
  const computed = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
