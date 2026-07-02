import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { encode } from "next-auth/jwt";
import { routing } from "@/i18n/routing";
import {
  SsoError,
  verifySsoTokenAndUpsertUser,
  type SsoErrorCode,
} from "@/lib/sso.server";

export const dynamic = "force-dynamic";

const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;

function sanitizeLocale(input: string | null): string {
  if (input && (routing.locales as readonly string[]).includes(input)) {
    return input;
  }
  return routing.defaultLocale;
}

function isSecureContext(): boolean {
  const url = process.env.NEXTAUTH_URL ?? "";
  return url.startsWith("https://");
}

function sessionCookieName(): string {
  return isSecureContext()
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

function redirectWithNoReferrer(to: URL): NextResponse {
  const res = NextResponse.redirect(to);
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Cache-Control", "no-store");
  return res;
}

async function issueSessionCookie(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
}): Promise<void> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET / NEXTAUTH_SECRET unset");
  }

  const cookieName = sessionCookieName();
  const sessionToken = await encode({
    token: {
      sub: user.id,
      id: user.id,
      role: user.role,
      status: user.status,
      name: user.name,
      email: user.email,
    },
    secret,
    salt: cookieName,
    maxAge: SESSION_MAX_AGE_SEC,
  });

  const store = await cookies();
  store.set(cookieName, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureContext(),
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

async function fireLoginHook(user: {
  id: string;
  email: string;
}): Promise<void> {
  try {
    const { dispatchHook } = await import("@/lib/modules/dispatch");
    await dispatchHook("onUserLogin", {
      id: user.id,
      email: user.email,
      loggedInAt: new Date(),
    });
  } catch (err) {
    console.error("[sso] onUserLogin failed:", err);
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const locale = sanitizeLocale(url.searchParams.get("locale"));

  // Build redirect targets from the injected public origin, NOT req.url.
  // In the Next standalone server behind Caddy/ALB, req.url reflects the
  // internal bind host (http://0.0.0.0:3000), so redirecting relative to it
  // sends the browser to 0.0.0.0. NEXTAUTH_URL is injected by the cloud
  // control plane as https://{instance.domain}; url.origin is the local-dev
  // fallback. AUTH_TRUST_HOST does not help here — this is a custom route
  // that reads req.url directly and bypasses Auth.js host resolution.
  const publicBase =
    process.env.NEXTAUTH_URL ?? process.env.AUTH_URL ?? url.origin;
  const loginTarget = new URL(`/${locale}/login`, publicBase);
  const dashboardTarget = new URL(`/${locale}/dashboard`, publicBase);

  let user;
  try {
    user = await verifySsoTokenAndUpsertUser(token);
  } catch (err) {
    const code: SsoErrorCode =
      err instanceof SsoError ? err.code : "sso_invalid";
    if (!(err instanceof SsoError)) {
      console.error("[sso] verification crashed:", err);
    }
    loginTarget.searchParams.set("error", code);
    return redirectWithNoReferrer(loginTarget);
  }

  try {
    await issueSessionCookie(user);
  } catch (err) {
    console.error("[sso] session cookie issuance failed:", err);
    loginTarget.searchParams.set("error", "sso_invalid");
    return redirectWithNoReferrer(loginTarget);
  }

  await fireLoginHook(user);
  return redirectWithNoReferrer(dashboardTarget);
}
