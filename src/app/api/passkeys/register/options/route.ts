// BYT-20261117-002 Phase 6: WebAuthn registration options for the signed-in
// user. The challenge is a stateless signed token (5 min). A new passkey only
// works after an e-mail link is clicked, so an account without a reachable
// e-mail cannot start a registration (NO_EMAIL / EMAIL_UNAVAILABLE).
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { checkRateLimit } from "@/lib/rate-limiter";
import { getTransporter } from "@/lib/email";
import { ConfirmationUnavailableError } from "@/lib/signed-token.server";
import { createRegistrationOptions } from "@/lib/webauthn.server";

export async function POST(request: NextRequest) {
  if (checkRateLimit(request, { maxRequests: 10, windowMs: 10 * 60 * 1000 }, "passkey-register")) {
    return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
  }
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!user) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }
  if (!user.email) {
    return NextResponse.json({ error: "NO_EMAIL" }, { status: 409 });
  }
  if (!getTransporter()) {
    return NextResponse.json({ error: "EMAIL_UNAVAILABLE" }, { status: 503 });
  }
  try {
    return NextResponse.json({ options: await createRegistrationOptions(request, user) });
  } catch (e) {
    if (e instanceof ConfirmationUnavailableError) {
      return NextResponse.json({ error: "CONFIRMATION_UNAVAILABLE" }, { status: 503 });
    }
    throw e;
  }
}
