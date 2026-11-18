// Passkey sign-in, step 1: public WebAuthn options whose challenge is a
// stateless signed token (5 min). No user is named — the browser offers the
// passkeys it holds for this site. Step 2 is the "passkey" credentials
// provider in src/lib/auth.ts.
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limiter";
import { ConfirmationUnavailableError } from "@/lib/signed-token.server";
import { createLoginOptions } from "@/lib/webauthn.server";

export async function POST(request: NextRequest) {
  if (checkRateLimit(request, { maxRequests: 30, windowMs: 10 * 60 * 1000 }, "passkey-login")) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  try {
    return NextResponse.json({ options: await createLoginOptions(request) });
  } catch (e) {
    if (e instanceof ConfirmationUnavailableError) {
      return NextResponse.json({ error: "CONFIRMATION_UNAVAILABLE" }, { status: 503 });
    }
    throw e;
  }
}
