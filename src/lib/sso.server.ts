import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/db";
import { ssoConsumedTokens, users } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

export type SsoErrorCode =
  | "sso_unsupported"
  | "sso_invalid"
  | "sso_expired"
  | "sso_replay"
  | "sso_blocked";

export class SsoError extends Error {
  constructor(public readonly code: SsoErrorCode, message?: string) {
    super(message ?? code);
    this.name = "SsoError";
  }
}

const ALLOWED_ISS = "resiapp.cloud";
const MAX_TOKEN_LIFETIME_SEC = 600;
const CLOCK_SKEW_SEC = 60;

// Cloud role enum: admin_system | admin | viewer (cloud-side `db/models.py:User.role`).
// Mapping confirmed in handoff 2026-05-13-resiapp-cloud-to-byt-app-demo-module-and-identity-import:
//   admin_system → admin   (cloud platform operator)
//   admin        → admin   (HOA chairperson / org owner)
//   viewer       → owner   (portal-read-only persona, but byt-app `owner` is the
//                          regular participating-resident role; tenant is too narrow.)
// Mapping is applied on first-time create only; existing users keep their byt-app role.
const CLOUD_TO_BYT_ROLE: Record<string, "admin" | "owner"> = {
  admin_system: "admin",
  admin: "admin",
  viewer: "owner",
};

type Claims = {
  sub: string;
  name?: string;
  org_id?: string;
  role?: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  jti: string;
};

function base64UrlToBuffer(s: string): Buffer {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(b64, "base64");
}

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function verifyJwt(token: string, secret: string): Claims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new SsoError("sso_invalid", "malformed JWT");
  }
  const [headerB64, payloadB64, sigB64] = parts;

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlToBuffer(headerB64).toString("utf8"));
  } catch {
    throw new SsoError("sso_invalid", "header parse");
  }
  if (header.alg !== "HS256") {
    throw new SsoError("sso_invalid", `unexpected alg ${header.alg}`);
  }

  const expectedSig = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const providedSig = base64UrlToBuffer(sigB64);
  if (!constantTimeEqual(expectedSig, providedSig)) {
    throw new SsoError("sso_invalid", "signature mismatch");
  }

  let claims: Claims;
  try {
    claims = JSON.parse(base64UrlToBuffer(payloadB64).toString("utf8"));
  } catch {
    throw new SsoError("sso_invalid", "payload parse");
  }
  return claims;
}

function getExpectedAudience(): string {
  const url = process.env.NEXTAUTH_URL;
  if (!url) {
    throw new SsoError("sso_invalid", "NEXTAUTH_URL unset");
  }
  return new URL(url).host;
}

function validateClaims(claims: Claims): void {
  if (claims.iss !== ALLOWED_ISS) {
    throw new SsoError("sso_invalid", `bad iss ${claims.iss}`);
  }
  const expectedAud = getExpectedAudience();
  if (claims.aud !== expectedAud) {
    throw new SsoError("sso_invalid", `aud ${claims.aud} != ${expectedAud}`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.iat !== "number" || typeof claims.exp !== "number") {
    throw new SsoError("sso_invalid", "missing iat/exp");
  }
  if (claims.iat > now + CLOCK_SKEW_SEC) {
    throw new SsoError("sso_invalid", "iat in future");
  }
  if (claims.exp <= now) {
    throw new SsoError("sso_expired");
  }
  if (claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SEC) {
    throw new SsoError("sso_invalid", "lifetime too long");
  }
  if (!claims.jti || typeof claims.jti !== "string") {
    throw new SsoError("sso_invalid", "missing jti");
  }
  if (!claims.sub || typeof claims.sub !== "string") {
    throw new SsoError("sso_invalid", "missing sub");
  }
  const instanceOrgId = process.env.INSTANCE_ORG_ID;
  if (instanceOrgId && claims.org_id !== instanceOrgId) {
    throw new SsoError("sso_invalid", "org_id mismatch");
  }
}

async function recordJtiOrReplay(
  jti: string,
  expSeconds: number
): Promise<void> {
  try {
    await db.insert(ssoConsumedTokens).values({
      jti,
      expiresAt: new Date(expSeconds * 1000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate key|unique/i.test(message)) {
      throw new SsoError("sso_replay");
    }
    throw err;
  }
}

type SsoUser = {
  id: string;
  email: string;
  name: string;
  role: "admin" | "owner" | "tenant" | "vote_counter" | "caretaker";
  status: "pending" | "active" | "rejected";
};

async function findOrCreateUser(claims: Claims): Promise<SsoUser> {
  const email = claims.sub.trim().toLowerCase();
  if (!email) {
    throw new SsoError("sso_invalid", "empty sub");
  }

  const [existing] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  if (existing) {
    if (!existing.isActive || existing.status === "rejected") {
      throw new SsoError("sso_blocked");
    }
    return {
      id: existing.id,
      email: existing.email!,
      name: existing.name,
      role: existing.role,
      status: existing.status,
    };
  }

  if (!claims.role || !(claims.role in CLOUD_TO_BYT_ROLE)) {
    throw new SsoError("sso_invalid", `unknown role ${claims.role}`);
  }
  const mappedRole = CLOUD_TO_BYT_ROLE[claims.role];

  const name = (claims.name ?? email).slice(0, 255);
  const [created] = await db
    .insert(users)
    .values({
      email,
      name,
      role: mappedRole,
      status: "active",
      isActive: true,
      passwordHash: null,
    })
    .returning();

  return {
    id: created.id,
    email: created.email!,
    name: created.name,
    role: created.role,
    status: created.status,
  };
}

export async function verifySsoTokenAndUpsertUser(
  token: string | undefined | null
): Promise<SsoUser> {
  const secret = process.env.CLOUD_SSO_SECRET;
  if (!secret) {
    throw new SsoError("sso_unsupported");
  }
  if (!token) {
    throw new SsoError("sso_invalid", "empty token");
  }
  const claims = verifyJwt(token, secret);
  validateClaims(claims);
  await recordJtiOrReplay(claims.jti, claims.exp);
  return await findOrCreateUser(claims);
}
