import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, registrationTokens, consentRecords } from "@/db/schema";
import { CURRENT_POLICY_VERSION } from "@/lib/consent";
import { checkRateLimit, getClientIp } from "@/lib/rate-limiter";
import {
  buildVerificationUrl,
  createEmailVerification,
} from "@/lib/registration";
import { sendQrRegistrationVerify } from "@/lib/email";
import { routing } from "@/i18n/routing";

const QR_REGISTER_RATE_LIMIT = { maxRequests: 5, windowMs: 60 * 60 * 1000 };

function pickLocale(input: unknown): string {
  if (typeof input === "string" && (routing.locales as readonly string[]).includes(input)) {
    return input;
  }
  return routing.defaultLocale;
}

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, QR_REGISTER_RATE_LIMIT, "qr-register");
  if (limited) return limited;

  const body = await request.json();
  const { token, name, email, password, phone, consents, locale } = body ?? {};

  if (!token || !name || !email || !password) {
    return NextResponse.json(
      { error: "Meno, email a heslo sú povinné" },
      { status: 400 }
    );
  }

  if (!consents?.data_processing) {
    return NextResponse.json(
      { error: "Súhlas so spracovaním osobných údajov je povinný" },
      { status: 400 }
    );
  }

  const [registrationToken] = await db
    .select()
    .from(registrationTokens)
    .where(eq(registrationTokens.token, token))
    .limit(1);

  if (!registrationToken || !registrationToken.isActive) {
    return NextResponse.json(
      { error: "Tento registračný odkaz už nie je platný" },
      { status: 400 }
    );
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "Tento email je už zaregistrovaný" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const ipAddress = getClientIp(request);
  const userAgent = request.headers.get("user-agent");

  const [newUser] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash,
      phone: phone || null,
      role: "owner",
      status: "pending",
      isActive: true,
    })
    .returning({ id: users.id, email: users.email, name: users.name });

  await db.insert(consentRecords).values([
    {
      userId: newUser.id,
      consentType: "data_processing",
      action: "granted",
      policyVersion: CURRENT_POLICY_VERSION,
      ipAddress: ipAddress === "unknown" ? null : ipAddress,
      userAgent,
    },
    ...(consents.communication
      ? [
          {
            userId: newUser.id,
            consentType: "communication" as const,
            action: "granted" as const,
            policyVersion: CURRENT_POLICY_VERSION,
            ipAddress: ipAddress === "unknown" ? null : ipAddress,
            userAgent,
          },
        ]
      : []),
  ]);

  const verification = await createEmailVerification(newUser.id);
  const resolvedLocale = pickLocale(locale);

  if (newUser.email) {
    await sendQrRegistrationVerify({
      recipientEmail: newUser.email,
      recipientName: newUser.name,
      verifyUrl: buildVerificationUrl(verification.token, resolvedLocale),
      expiryHours: 24,
      locale: resolvedLocale,
    });
  }

  return NextResponse.json(
    {
      success: true,
      message: "Skontrolujte si email a potvrďte registráciu",
    },
    { status: 201 }
  );
}
