// Enable Banking request JWT (BYT-20261118-001). Node-only (node:crypto),
// no DB / server-only imports so the golden check can verify it. Never
// import from client components.

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
  type KeyObject,
} from "node:crypto";
import { EnableBankingError } from "./enable-banking-errors";

const JWT_TTL_SECONDS = 3600;

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** RS256 JWT per Enable Banking docs: kid = application id. */
export function signEnableBankingJwt(
  creds: { appId: string; privateKey: string },
  now: Date = new Date()
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: creds.appId };
  const body = {
    iss: "enablebanking.com",
    aud: "api.enablebanking.com",
    iat,
    exp: iat + JWT_TTL_SECONDS,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(
    JSON.stringify(body)
  )}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  return `${signingInput}.${base64url(signer.sign(creds.privateKey))}`;
}

/**
 * Validates and normalizes an admin-supplied private key (paste or .pem
 * upload). Accepts PKCS#8 / PKCS#1 PEM, RSA only (Enable Banking signs
 * RS256). Returns the key re-exported as PKCS#8 PEM plus a short
 * fingerprint of the public half for display. Throws EB_INVALID_KEY.
 */
export function normalizeEnableBankingPrivateKey(input: string): {
  pem: string;
  fingerprint: string;
} {
  const text = input.trim().replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  if (!text.includes("PRIVATE KEY-----") || text.length > 16_384) {
    throw new EnableBankingError("EB_INVALID_KEY");
  }
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: text, format: "pem" });
  } catch {
    throw new EnableBankingError("EB_INVALID_KEY");
  }
  if (key.asymmetricKeyType !== "rsa") throw new EnableBankingError("EB_INVALID_KEY");
  const pem = key.export({ type: "pkcs8", format: "pem" }).toString();
  const spki = createPublicKey(key).export({ type: "spki", format: "der" });
  const fingerprint = createHash("sha256").update(spki).digest("hex").slice(0, 16);
  return { pem, fingerprint };
}

/** Enable Banking application ids are UUIDs; accept any short token-ish id. */
export function isValidEnableBankingAppId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{3,99}$/.test(value);
}
