// BYT-20261117-002 Phase 6: activate a pending passkey from the e-mailed
// link page. Body: { token, locale? }. No session needed — the link may be
// opened on another device; the signed token is bound to the user and the
// exact credential. Single use: activation only flips a NULL activated_at.
// Only this POST activates; opening the link (GET, mail scanners) never does.
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limiter";
import { ConfirmationUnavailableError } from "@/lib/signed-token.server";
import { activatePasskey } from "@/lib/webauthn.server";
import { sendPasskeyAddedNotice } from "@/lib/webauthn-email.server";

export async function POST(request: NextRequest) {
  if (checkRateLimit(request, { maxRequests: 20, windowMs: 10 * 60 * 1000 }, "passkey-activate")) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  let body: { token?: unknown; locale?: unknown } | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (typeof body?.token !== "string") {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  try {
    const r = await activatePasskey(body.token);
    if (!r.ok) {
      const status =
        r.code === "PASSKEY_ALREADY_ACTIVE" ? 409 : r.code === "PASSKEY_NOT_FOUND" ? 404 : 400;
      return NextResponse.json({ error: r.code }, { status });
    }
    void sendPasskeyAddedNotice({
      userId: r.userId,
      deviceLabel: r.deviceLabel,
      activatedAt: r.activatedAt,
      locale: typeof body.locale === "string" ? body.locale : null,
    });
    return NextResponse.json({ ok: true, activatedAt: r.activatedAt.toISOString() });
  } catch (e) {
    if (e instanceof ConfirmationUnavailableError) {
      return NextResponse.json({ error: "CONFIRMATION_UNAVAILABLE" }, { status: 503 });
    }
    throw e;
  }
}
