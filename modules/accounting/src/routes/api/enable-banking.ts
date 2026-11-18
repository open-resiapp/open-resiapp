import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  ENABLE_BANKING_CALLBACK_PATH,
  completeEnableBankingAuth,
  deleteEnableBankingCredentials,
  disconnectEnableBanking,
  enableBankingRedirectUrl,
  getEnableBankingConnection,
  listEnableBankingAspsps,
  saveEnableBankingCredentials,
  selectEnableBankingAccount,
  startEnableBankingAuth,
  syncEnableBanking,
} from "@modules/accounting/src/lib/enable-banking";
import {
  EnableBankingError,
  type EnableBankingErrorCode,
} from "@modules/accounting/src/lib/enable-banking-format";
import { routing } from "@/i18n/routing";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

// Enable Banking connector API (BYT-20261118-001) — treasurer/admin only.
// Errors are returned as { error: <EB_* code> }; the UI translates them.

const STATE_COOKIE = "eb_auth_state";
const STATE_TTL_SECONDS = 600;
const CALLBACK_PATH = ENABLE_BANKING_CALLBACK_PATH;
/** Where the bank flow lands — the bank connection settings page. */
const SETTINGS_PATH = "/settings/advanced/bank";

interface StateCookie {
  state: string;
  locale: string;
  aspspName: string;
  aspspCountry: string;
}

function errorResponse(err: unknown, status = 400): NextResponse {
  if (err instanceof EnableBankingError) {
    return NextResponse.json({ error: err.code }, { status });
  }
  console.error("[enable-banking]", err);
  return NextResponse.json(
    { error: "EB_API_ERROR" satisfies EnableBankingErrorCode },
    { status: 500 }
  );
}

/**
 * Public origin for the bank redirect. Never derived from the Host header
 * in production — a forged host would send the authorization code to an
 * attacker. Must match the redirect URL registered in Enable Banking.
 */
function publicOrigin(req: NextRequest): string {
  const configured = enableBankingRedirectUrl();
  if (configured) return new URL(configured).origin;
  if (process.env.NODE_ENV === "production") {
    throw new EnableBankingError("EB_NOT_CONFIGURED", "public url");
  }
  return req.nextUrl.origin;
}

function safeLocale(value: unknown): string {
  return typeof value === "string" &&
    (routing.locales as readonly string[]).includes(value)
    ? value
    : routing.defaultLocale;
}

// ── handlers ───────────────────────────────────────────

export async function handleGet(): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  return NextResponse.json(await getEnableBankingConnection(ctx.root.id));
}

export async function handleAspsps(): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  try {
    const aspsps = await listEnableBankingAspsps(ctx.root.country);
    return NextResponse.json({
      aspsps: aspsps.map((a) => ({
        name: a.name,
        country: a.country,
        logo: a.logo ?? null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleConnect(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: { aspspName?: unknown; locale?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.aspspName !== "string" || body.aspspName.trim() === "") {
    return NextResponse.json(
      { error: "EB_UNKNOWN_BANK" satisfies EnableBankingErrorCode },
      { status: 400 }
    );
  }

  try {
    const state = randomBytes(32).toString("hex");
    const url = await startEnableBankingAuth({
      country: ctx.root.country,
      aspspName: body.aspspName,
      redirectUrl: `${publicOrigin(req)}${CALLBACK_PATH}`,
      state,
    });
    const cookie: StateCookie = {
      state,
      locale: safeLocale(body.locale),
      aspspName: body.aspspName,
      aspspCountry: ctx.root.country.toUpperCase(),
    };
    const res = NextResponse.json({ url });
    res.cookies.set(STATE_COOKIE, JSON.stringify(cookie), {
      httpOnly: true,
      // Lax: the bank redirect back is a top-level GET navigation.
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: CALLBACK_PATH,
      maxAge: STATE_TTL_SECONDS,
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}

/** Bank → app redirect target. Always ends in a redirect to the bank settings page. */
export async function handleCallback(req: NextRequest): Promise<NextResponse> {
  const raw = req.cookies.get(STATE_COOKIE)?.value;
  let cookie: StateCookie | null = null;
  try {
    cookie = raw ? (JSON.parse(raw) as StateCookie) : null;
  } catch {
    cookie = null;
  }
  const locale = safeLocale(cookie?.locale);

  const finish = (outcome: "connected" | EnableBankingErrorCode) => {
    const target = new URL(
      `/${locale}${SETTINGS_PATH}?eb=${outcome}`,
      publicOriginOrRequest(req)
    );
    const res = NextResponse.redirect(target);
    res.cookies.set(STATE_COOKIE, "", { path: CALLBACK_PATH, maxAge: 0 });
    return res;
  };

  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  const params = req.nextUrl.searchParams;
  const state = params.get("state");
  if (!cookie || !state || cookie.state !== state) {
    return finish("EB_STATE_MISMATCH");
  }
  if (params.get("error")) return finish("EB_AUTH_REJECTED");
  const code = params.get("code");
  if (!code) return finish("EB_AUTH_REJECTED");

  try {
    await completeEnableBankingAuth({
      entityId: ctx.root.id,
      actorId: ctx.session.user.id,
      code,
      aspspName: cookie.aspspName,
      aspspCountry: cookie.aspspCountry,
    });
    return finish("connected");
  } catch (err) {
    if (!(err instanceof EnableBankingError)) {
      console.error("[enable-banking] callback", err);
    }
    return finish(err instanceof EnableBankingError ? err.code : "EB_API_ERROR");
  }
}

function publicOriginOrRequest(req: NextRequest): string {
  try {
    return publicOrigin(req);
  } catch {
    return req.nextUrl.origin;
  }
}

export async function handleSelectAccount(
  req: NextRequest
): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  let body: { accountUid?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.accountUid !== "string") {
    return NextResponse.json(
      { error: "EB_UNKNOWN_ACCOUNT" satisfies EnableBankingErrorCode },
      { status: 400 }
    );
  }
  try {
    await selectEnableBankingAccount({
      entityId: ctx.root.id,
      actorId: ctx.session.user.id,
      accountUid: body.accountUid,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleSync(): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  try {
    const summary = await syncEnableBanking({
      entityId: ctx.root.id,
      country: ctx.root.country,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json(summary);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleDisconnect(): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  try {
    await disconnectEnableBanking({
      entityId: ctx.root.id,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

// ── app credentials (admin only) ───────────────────────

/**
 * App credentials are an instance secret: accounting writer AND
 * manageSettings (admin). A treasurer connects the bank, but only the admin
 * enters / replaces / removes the Enable Banking application key.
 */
async function requireCredentialAdmin() {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx;
  if (!hasPermission(ctx.session.user.role as UserRole, "manageSettings")) {
    return {
      ok: false as const,
      error: NextResponse.json(
        { error: "EB_FORBIDDEN" satisfies EnableBankingErrorCode },
        { status: 403 }
      ),
    };
  }
  return ctx;
}

const MAX_KEY_CHARS = 16_384;

export async function handleSaveCredentials(
  req: NextRequest
): Promise<NextResponse> {
  const ctx = await requireCredentialAdmin();
  if (!ctx.ok) return ctx.error;
  let body: { appId?: unknown; privateKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.appId !== "string" || body.appId.length > 100) {
    return NextResponse.json(
      { error: "EB_INVALID_APP_ID" satisfies EnableBankingErrorCode },
      { status: 400 }
    );
  }
  if (
    typeof body.privateKey !== "string" ||
    body.privateKey.length > MAX_KEY_CHARS
  ) {
    return NextResponse.json(
      { error: "EB_INVALID_KEY" satisfies EnableBankingErrorCode },
      { status: 400 }
    );
  }
  try {
    const check = await saveEnableBankingCredentials({
      entityId: ctx.root.id,
      actorId: ctx.session.user.id,
      appId: body.appId,
      privateKey: body.privateKey,
    });
    return NextResponse.json({ ok: true, check });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function handleDeleteCredentials(): Promise<NextResponse> {
  const ctx = await requireCredentialAdmin();
  if (!ctx.ok) return ctx.error;
  try {
    await deleteEnableBankingCredentials({
      entityId: ctx.root.id,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
