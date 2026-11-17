// BYT-20261117-002 Phase 6: (re)send the single-use activation link for one
// of the signed-in user's pending passkeys. Body: { id, locale? }.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limiter";
import { ConfirmationUnavailableError } from "@/lib/signed-token.server";
import { getPendingPasskey } from "@/lib/webauthn.server";
import { sendPasskeyActivationEmail } from "@/lib/webauthn-email.server";

export async function POST(request: NextRequest) {
  if (checkRateLimit(request, { maxRequests: 5, windowMs: 15 * 60 * 1000 }, "passkey-activation-email")) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  let body: { id?: unknown; locale?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const id = typeof body?.id === "string" ? body.id : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const cred = await getPendingPasskey(session.user.id, id);
  if (!cred) {
    return NextResponse.json({ error: "PASSKEY_NOT_FOUND" }, { status: 404 });
  }
  try {
    const mail = await sendPasskeyActivationEmail({
      request,
      userId: session.user.id,
      credential: cred,
      locale: typeof body?.locale === "string" ? body.locale : null,
    });
    if (!mail.ok) {
      return NextResponse.json(
        { error: mail.code },
        { status: mail.code === "NO_EMAIL" ? 409 : 503 }
      );
    }
    return NextResponse.json({ sentTo: mail.sentTo, expiresAt: mail.expiresAt.toISOString() });
  } catch (e) {
    if (e instanceof ConfirmationUnavailableError) {
      return NextResponse.json({ error: "CONFIRMATION_UNAVAILABLE" }, { status: 503 });
    }
    throw e;
  }
}
