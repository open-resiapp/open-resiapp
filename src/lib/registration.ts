import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  registrationTokens,
  emailVerifications,
  users,
} from "@/db/schema";

const VERIFICATION_TOKEN_TTL_HOURS = 24;

export function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function getActiveRegistrationToken() {
  const [row] = await db
    .select()
    .from(registrationTokens)
    .where(eq(registrationTokens.isActive, true))
    .limit(1);
  return row ?? null;
}

export async function generateRegistrationToken(createdById: string) {
  return db.transaction(async (tx) => {
    await tx
      .update(registrationTokens)
      .set({ isActive: false, rotatedAt: new Date() })
      .where(eq(registrationTokens.isActive, true));

    const [row] = await tx
      .insert(registrationTokens)
      .values({
        token: generateOpaqueToken(),
        createdById,
        isActive: true,
      })
      .returning();
    return row;
  });
}

export async function disableRegistrationToken() {
  return db
    .update(registrationTokens)
    .set({ isActive: false, rotatedAt: new Date() })
    .where(eq(registrationTokens.isActive, true));
}

export async function createEmailVerification(userId: string) {
  const expiresAt = new Date(
    Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000
  );
  const [row] = await db
    .insert(emailVerifications)
    .values({
      userId,
      token: generateOpaqueToken(),
      expiresAt,
    })
    .returning();
  return row;
}

export async function consumeEmailVerification(token: string) {
  const [row] = await db
    .select()
    .from(emailVerifications)
    .where(
      and(
        eq(emailVerifications.token, token),
        isNull(emailVerifications.verifiedAt)
      )
    )
    .limit(1);

  if (!row) return { ok: false as const, reason: "not_found" as const };
  if (new Date(row.expiresAt) < new Date()) {
    return { ok: false as const, reason: "expired" as const };
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(emailVerifications)
      .set({ verifiedAt: now })
      .where(eq(emailVerifications.id, row.id));

    await tx
      .update(users)
      .set({ emailVerifiedAt: now })
      .where(eq(users.id, row.userId));
  });

  return { ok: true as const, userId: row.userId };
}

export function buildRegistrationUrl(token: string, locale: string) {
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return `${baseUrl}/${locale}/register/qr/${token}`;
}

export function buildVerificationUrl(token: string, _locale: string) {
  void _locale;
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return `${baseUrl}/api/register/qr/verify/${token}`;
}
