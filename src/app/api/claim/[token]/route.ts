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
import { recordEntityAudit } from "@/lib/entity-audit";

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

export async function GET(_req: NextRequest, ctx: RouteContext) {
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
    flatNumber: unitRow?.flatNumber ?? null,
    communityName,
    expiresAt: invite.expiresAt.toISOString(),
  });
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { token } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    email?: unknown;
    password?: unknown;
  };

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
