// Enable Banking request JWT (BYT-20261118-001). Node-only (node:crypto),
// no DB / server-only imports so the golden check can verify it. Never
// import from client components.

import { createSign } from "node:crypto";

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
