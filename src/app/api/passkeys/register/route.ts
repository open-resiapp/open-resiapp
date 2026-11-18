// BYT-20261117-002 Phase 6: verify a WebAuthn registration and store the
// passkey for the signed-in user — INACTIVE until the e-mailed single-use
// link is clicked (a session alone must not add a voting credential).
//
// Body: { response, locale?, activation?: "vote" }  (a legacy `deviceLabel`
//   field is ignored — the label comes from the User-Agent)
//   activation "vote" → the inline first-vote flow: no separate activation
//   e-mail; the client next asks for the vote confirmation e-mail with
//   `activatePasskeyId`, and that one link records the vote AND activates
//   this passkey.
// Response 201: { id, pending: true, activationEmail?: { sentTo, expiresAt } | { error } }
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limiter";
import { ConfirmationUnavailableError } from "@/lib/signed-token.server";
import { deviceLabelFromUserAgent, verifyRegistration } from "@/lib/webauthn.server";
import { sendPasskeyActivationEmail } from "@/lib/webauthn-email.server";

export async function POST(request: NextRequest) {
  if (checkRateLimit(request, { maxRequests: 10, windowMs: 10 * 60 * 1000 }, "passkey-register-verify")) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  let body: { response?: unknown; locale?: unknown; activation?: unknown } | null =
    null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body?.response || typeof body.response !== "object") {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  // Label is derived server-side only; a body `deviceLabel` is ignored (it is
  // shown in the activation e-mail / page and must not be attacker-chosen).
  const label = deviceLabelFromUserAgent(request.headers.get("user-agent"));
  const locale = typeof body.locale === "string" ? body.locale : null;
  try {
    const result = await verifyRegistration(
      request,
      session.user.id,
      body.response as Parameters<typeof verifyRegistration>[2],
      label
    );
    if (!result.ok) {
      return NextResponse.json(
        { error: result.code },
        { status: result.code === "PASSKEY_ALREADY_REGISTERED" ? 409 : 400 }
      );
    }
    if (body.activation === "vote") {
      return NextResponse.json({ id: result.id, pending: true }, { status: 201 });
    }
    // The passkey is stored either way; a failed e-mail can be re-sent from
    // the profile (POST /api/passkeys/activation-email).
    const mail = await sendPasskeyActivationEmail({
      request,
      userId: session.user.id,
      credential: {
        id: result.id,
        credentialId: result.credentialId,
        deviceLabel: result.deviceLabel,
        createdAt: new Date(),
      },
      locale,
    });
    return NextResponse.json(
      {
        id: result.id,
        pending: true,
        activationEmail: mail.ok
          ? { sentTo: mail.sentTo, expiresAt: mail.expiresAt.toISOString() }
          : { error: mail.code },
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof ConfirmationUnavailableError) {
      return NextResponse.json({ error: "CONFIRMATION_UNAVAILABLE" }, { status: 503 });
    }
    throw e;
  }
}
