// Symmetric encryption for secrets the app must store and later present
// verbatim (BYT-20261118-001: the Enable Banking private key). Node-only
// (node:crypto) and free of DB / next imports so the golden check can run it;
// never import from client components.
//
// AES-256-GCM. The key is derived per purpose from the existing auth secret
// (AUTH_SECRET, falling back to NEXTAUTH_SECRET) — no new env var, and every
// replica derives the same key. The purpose is also bound as AAD, so a value
// sealed for one purpose never opens under another.
//
// Format: "v1." base64url(iv 12B) "." base64url(tag 16B) "." base64url(ct)
//
// Rotating AUTH_SECRET makes stored values unreadable: openSecret() then
// throws SECRET_UNREADABLE and the admin re-enters the secret.

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";

export type SecretPurpose = "enable-banking-private-key";

export type SecretBoxErrorCode = "SECRET_UNAVAILABLE" | "SECRET_UNREADABLE";

export class SecretBoxError extends Error {
  constructor(public readonly code: SecretBoxErrorCode) {
    super(code);
    this.name = "SecretBoxError";
  }
}

const VERSION = "v1";
const MIN_PRODUCTION_SECRET_LENGTH = 32;

function serverSecret(override?: string): string {
  // `||` so an empty AUTH_SECRET="" falls through to NEXTAUTH_SECRET.
  const secret =
    override ?? (process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET);
  if (!secret) throw new SecretBoxError("SECRET_UNAVAILABLE");
  if (
    process.env.NODE_ENV === "production" &&
    secret.length < MIN_PRODUCTION_SECRET_LENGTH
  ) {
    throw new SecretBoxError("SECRET_UNAVAILABLE");
  }
  return secret;
}

function deriveKey(purpose: SecretPurpose, secret?: string): Buffer {
  return createHmac("sha256", serverSecret(secret))
    .update(`open-housing/secret-box/${VERSION}/${purpose}`, "utf8")
    .digest();
}

/** `secret` overrides the env auth secret — tests only. */
export function sealSecret(
  plaintext: string,
  purpose: SecretPurpose,
  secret?: string
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(purpose, secret), iv);
  cipher.setAAD(Buffer.from(purpose, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ct]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function openSecret(
  sealed: string,
  purpose: SecretPurpose,
  secret?: string
): string {
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new SecretBoxError("SECRET_UNREADABLE");
  }
  const key = deriveKey(purpose, secret);
  try {
    const [iv, tag, ct] = parts.slice(1).map((p) => Buffer.from(p, "base64url"));
    if (iv.length !== 12 || tag.length !== 16) throw new Error("shape");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    throw new SecretBoxError("SECRET_UNREADABLE");
  }
}
