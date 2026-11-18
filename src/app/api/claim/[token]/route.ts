import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { and, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  entities,
  invitations,
  memberships,
  users,
} from "@/db/schema";
import { CLAIM_LINK_TTL_MS, mintClaimLinkToken } from "@/lib/claim-link.server";
import { sendClaimLinkAddressInUse, sendClaimLoginLink } from "@/lib/email";
import { recordEntityAudit } from "@/lib/entity-audit";
import { routing } from "@/i18n/routing";
import { checkRateLimit, checkRateLimitKey } from "@/lib/rate-limiter";

interface RouteContext {
  params: Promise<{ token: string }>;
}

async function loadInvitation(token: string) {
  const [row] = await db
    .select({
      id: invitations.id,
      status: invitations.status,
      expiresAt: invitations.expiresAt,
      targetShellUserId: invitations.targetShellUserId,
    })
    .from(invitations)
    .where(eq(invitations.token, token));
  return row;
}

export async function GET(req: NextRequest, ctx: RouteContext) {
  // Token lookups are enumeration targets — per-IP limit (in-process, per replica).
  const limited = checkRateLimit(req, { maxRequests: 30, windowMs: 15 * 60 * 1000 }, "claim-get");
  if (limited) return limited;
  const { token } = await ctx.params;
  const invite = await loadInvitation(token);
  if (!invite || !invite.targetShellUserId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (invite.status !== "pending") {
    return NextResponse.json({ error: "used" }, { status: 410 });
  }
  if (invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  const [shell] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      paperOnly: users.paperOnly,
    })
    .from(users)
    .where(eq(users.id, invite.targetShellUserId));

  if (!shell) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Pick the first unit membership to surface a meaningful identifier
  // on the claim screen. Phase 2b: flat_number from entities.data.
  const [unitRow] = await db
    .select({
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      rootName: entities.name,
      rootId: entities.rootId,
    })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(
        eq(memberships.userId, shell.id),
        eq(memberships.status, "active"),
        eq(entities.kind, "unit")
      )
    )
    .limit(1);

  let communityName: string | null = null;
  if (unitRow?.rootId) {
    const [root] = await db
      .select({ name: entities.name })
      .from(entities)
      .where(eq(entities.id, unitRow.rootId));
    communityName = root?.name ?? null;
  }

  return NextResponse.json({
    shellName: shell.name,
    shellEmail: shell.email,
    paperOnly: shell.paperOnly,
    flatNumber: unitRow?.flatNumber ?? null,
    communityName,
    expiresAt: invite.expiresAt.toISOString(),
  });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const limited = checkRateLimit(req, { maxRequests: 10, windowMs: 15 * 60 * 1000 }, "claim-post");
  if (limited) return limited;
  const { token } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    email?: unknown;
    password?: unknown;
    mode?: unknown;
    locale?: unknown;
  };

  if (body.mode === "link") return requestClaimLink(token, body);

  const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!emailRaw || !password) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  if (!emailRaw.includes("@") || emailRaw.length > 254) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "weak_password" }, { status: 400 });
  }
  const email = emailRaw.toLowerCase();

  const result = await db.transaction(async (tx) => {
    const [invite] = await tx
      .select({
        id: invitations.id,
        status: invitations.status,
        expiresAt: invitations.expiresAt,
        targetShellUserId: invitations.targetShellUserId,
      })
      .from(invitations)
      .where(eq(invitations.token, token));

    if (!invite || !invite.targetShellUserId) {
      return { status: 404 as const, body: { error: "not_found" } };
    }
    if (invite.status !== "pending") {
      return { status: 410 as const, body: { error: "used" } };
    }
    if (invite.expiresAt.getTime() < Date.now()) {
      return { status: 410 as const, body: { error: "expired" } };
    }

    const shellId = invite.targetShellUserId;

    const [conflict] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), ne(users.id, shellId)));
    if (conflict) {
      return { status: 409 as const, body: { error: "email_taken" } };
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await tx
      .update(users)
      .set({
        email,
        passwordHash,
        status: "active",
        emailVerifiedAt: new Date(),
      })
      .where(eq(users.id, shellId));

    await tx
      .update(invitations)
      .set({ status: "used", usedByUserId: shellId })
      .where(eq(invitations.id, invite.id));

    // Burn any other open invitations targeting the same shell so a leaked
    // copy can't be reused.
    await tx
      .update(invitations)
      .set({ status: "superseded" })
      .where(
        and(
          eq(invitations.targetShellUserId, shellId),
          eq(invitations.status, "pending"),
          ne(invitations.id, invite.id)
        )
      );

    return { status: 200 as const, body: { ok: true as const, email } };
  });

  if (result.status === 200 && "ok" in result.body) {
    recordEntityAudit({
      action: "user.claim_shell",
      actorUserId: null,
      entityId: null,
      after: { token, email: result.body.email },
    });
  }

  return NextResponse.json(result.body, { status: result.status });
}


// ── mode "link": claim by an e-mailed sign-in link, no password ──────────
//
// The owner types an e-mail; we mail a signed, single-use, 30-minute link
// (src/lib/claim-link.server.ts) — clicking it activates the shell with that
// e-mail and signs in. The response is the same whether or not the address
// already belongs to another account (that address gets a "you already have
// an account" notice instead), so the endpoint cannot be used to probe which
// e-mails are registered. Invitation state (not_found / used / expired) is
// already visible to the token holder via GET, so it is reported as usual.

/** Per invitation / per address: caps how many mails one claim can trigger. */
const LINK_SEND_LIMIT = { maxRequests: 3, windowMs: 60 * 60 * 1000 };

function publicBaseUrl(): string | null {
  // Never from the request Host header (a spoofed Host would put an
  // attacker's domain into the sign-in mail).
  const base = process.env.NEXTAUTH_URL || process.env.APP_URL;
  if (base) return base.replace(/\/$/, "");
  return process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
}

async function requestClaimLink(
  token: string,
  body: { email?: unknown; locale?: unknown }
): Promise<NextResponse> {
  const emailRaw = typeof body.email === "string" ? body.email.trim() : "";
  if (!emailRaw) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  if (!emailRaw.includes("@") || emailRaw.length > 254 || /\s/.test(emailRaw)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const email = emailRaw.toLowerCase();
  const locale =
    typeof body.locale === "string" && (routing.locales as readonly string[]).includes(body.locale)
      ? body.locale
      : routing.defaultLocale;

  const invite = await loadInvitation(token);
  if (!invite || !invite.targetShellUserId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (invite.status !== "pending") return NextResponse.json({ error: "used" }, { status: 410 });
  if (invite.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  // Anti mail-bombing: per invitation and per target address (in-process,
  // per replica — like the per-IP limit above).
  if (
    checkRateLimitKey(invite.id, LINK_SEND_LIMIT, "claim-link-invite") !== null ||
    checkRateLimitKey(email, LINK_SEND_LIMIT, "claim-link-email") !== null
  ) {
    return NextResponse.json({ error: "rateLimited" }, { status: 429 });
  }

  const base = publicBaseUrl();
  if (!base) return NextResponse.json({ error: "email_unavailable" }, { status: 503 });

  const shellId = invite.targetShellUserId;
  const [[shell], [conflict]] = await Promise.all([
    db.select({ name: users.name }).from(users).where(eq(users.id, shellId)).limit(1),
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, email), ne(users.id, shellId)))
      .limit(1),
  ]);
  if (!shell) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let status: Awaited<ReturnType<typeof sendClaimLoginLink>>;
  if (conflict) {
    status = await sendClaimLinkAddressInUse({
      recipientEmail: email,
      loginUrl: `${base}/${locale}/login`,
      locale,
    });
  } else {
    let link: string;
    try {
      const t = mintClaimLinkToken({ invitationId: invite.id, shellUserId: shellId, email });
      link = `${base}/${locale}/claim/${encodeURIComponent(token)}/link?t=${encodeURIComponent(t)}`;
    } catch {
      // ConfirmationUnavailableError: auth secret missing / too short.
      return NextResponse.json({ error: "email_unavailable" }, { status: 503 });
    }
    status = await sendClaimLoginLink({
      recipientEmail: email,
      recipientName: shell.name,
      linkUrl: link,
      expiryMinutes: Math.round(CLAIM_LINK_TTL_MS / 60_000),
      locale,
    });
  }

  // Delivery problems are the same for every address — not an oracle.
  if (status === "not_configured" && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "email_unavailable" }, { status: 503 });
  }
  if (status === "failed") {
    return NextResponse.json({ error: "email_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, mode: "link" });
}
