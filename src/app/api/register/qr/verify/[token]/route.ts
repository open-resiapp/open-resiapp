import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  communityNotificationsSent,
} from "@/db/schema";
import {
  checkRateLimit,
} from "@/lib/rate-limiter";
import { consumeEmailVerification } from "@/lib/registration";
import { sendQrRegistrationPendingAdmin } from "@/lib/email";
import { routing } from "@/i18n/routing";

const VERIFY_RATE_LIMIT = { maxRequests: 20, windowMs: 60 * 60 * 1000 };

async function notifyAdminsOfPending(userId: string) {
  const [pendingUser] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!pendingUser) return;

  const admins = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(inArray(users.role, ["admin"]));

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const queueUrl = `${baseUrl}/${routing.defaultLocale}/owners/pending`;

  for (const admin of admins) {
    if (admin.id === pendingUser.id) continue;

    const [existing] = await db
      .select({ id: communityNotificationsSent.id })
      .from(communityNotificationsSent)
      .where(
        and(
          eq(communityNotificationsSent.subjectUserId, pendingUser.id),
          eq(communityNotificationsSent.recipientId, admin.id),
          eq(
            communityNotificationsSent.kind,
            "pending_registration_admin"
          )
        )
      )
      .limit(1);

    if (existing) continue;

    await db.insert(communityNotificationsSent).values({
      subjectUserId: pendingUser.id,
      recipientId: admin.id,
      kind: "pending_registration_admin",
    });

    if (admin.email) {
      await sendQrRegistrationPendingAdmin({
        recipientEmail: admin.email,
        recipientName: admin.name,
        pendingName: pendingUser.name,
        pendingEmail: pendingUser.email ?? "",
        queueUrl,
      });
    }
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const limited = checkRateLimit(request, VERIFY_RATE_LIMIT, "qr-verify");
  if (limited) return limited;

  const { token } = await params;
  const result = await consumeEmailVerification(token);

  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const loginUrl = `${baseUrl}/${routing.defaultLocale}/login`;

  if (!result.ok) {
    const url = new URL(loginUrl);
    url.searchParams.set("verify", result.reason);
    return NextResponse.redirect(url);
  }

  await notifyAdminsOfPending(result.userId).catch((err) =>
    console.error("[qr-verify] notify admins failed:", err)
  );

  const url = new URL(loginUrl);
  url.searchParams.set("verify", "ok");
  return NextResponse.redirect(url);
}
