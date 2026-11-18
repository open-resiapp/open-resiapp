import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, entities } from "@/db/schema";
import { attendance, ballots, mandates, votings } from "@modules/voting/src/db/schema";
import { sessionCanSeeVoting } from "@modules/voting/src/votings";
import { recordVotingEvent } from "@modules/voting/src/events";
import { hasPermission } from "@/lib/permissions";
import { assertBoard } from "@/lib/mcp/authz";
import { isMcpError, mcpErrorStatus } from "@/lib/mcp/errors";
import { principalFromSession } from "@/lib/mcp/principal";
import type { UserRole } from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "createVoting")) {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const votingId = searchParams.get("votingId");

  if (!votingId) {
    return NextResponse.json({ error: "MANDATE_FIELDS_REQUIRED" }, { status: 400 });
  }
  if (!(await sessionCanSeeVoting(session, votingId))) {
    return NextResponse.json({ error: "Hlasovanie nenájdené" }, { status: 404 });
  }

  const fromOwner = alias(users, "fromOwner");
  const toOwner = alias(users, "toOwner");
  const verifiedByAdmin = alias(users, "verifiedByAdmin");

  // Phase 2b: flat_number comes from entities.data jsonb on the unit
  // entity referenced by mandate.fromEntityId.
  const rows = await db
    .select({
      id: mandates.id,
      fromOwnerName: fromOwner.name,
      fromFlatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      // Owner account name, else the external proxy's name (2026-11-18).
      toOwnerName: sql<string | null>`coalesce(${toOwner.name}, ${mandates.proxyName})`,
      isExternalProxy: sql<boolean>`${mandates.toOwnerId} IS NULL`,
      proxyBirthDate: mandates.proxyBirthDate,
      proxyAddress: mandates.proxyAddress,
      proxyNote: mandates.proxyNote,
      paperDocumentConfirmed: mandates.paperDocumentConfirmed,
      verifiedByAdminName: verifiedByAdmin.name,
      verificationDate: mandates.verificationDate,
      verificationNote: mandates.verificationNote,
      isActive: mandates.isActive,
      createdAt: mandates.createdAt,
    })
    .from(mandates)
    .leftJoin(fromOwner, eq(mandates.fromOwnerId, fromOwner.id))
    .leftJoin(toOwner, eq(mandates.toOwnerId, toOwner.id))
    .leftJoin(entities, eq(entities.id, mandates.fromEntityId))
    .leftJoin(verifiedByAdmin, eq(mandates.verifiedByAdminId, verifiedByAdmin.id))
    .where(eq(mandates.votingId, votingId));

  return NextResponse.json(rows);
}

// Errors are stable codes; MandateModal maps them to Mandate.errors.*.
function fail(code: string, status = 400) {
  return NextResponse.json({ error: code }, { status });
}

const trimmed = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", 401);

  if (!hasPermission(session.user.role as UserRole, "grantMandate")) {
    return fail("FORBIDDEN", 403);
  }

  const body = await request.json().catch(() => ({}));
  // Accept either fromEntityId (canonical) or legacy fromFlatId from older
  // clients — both refer to the housing_unit entity id.
  const fromEntityId = body.fromEntityId ?? body.fromFlatId;
  const { votingId, fromOwnerId, paperDocumentConfirmed, verificationNote } = body;

  // §14 ods. 4 zák. 182/1993 Z.z.: the owner may authorise "inú osobu" — an
  // owner account (toOwnerId) OR an external person without an account
  // (proxy.name required; birth date / address / note optional, as written
  // on the paper power of attorney).
  const toOwnerId: string | null =
    typeof body.toOwnerId === "string" && body.toOwnerId ? body.toOwnerId : null;
  const proxy = (body.proxy ?? null) as Record<string, unknown> | null;
  const proxyName = toOwnerId ? null : trimmed(proxy?.name, 255);
  const proxyBirthDateRaw = toOwnerId ? null : trimmed(proxy?.birthDate, 10);
  const proxyAddress = toOwnerId ? null : trimmed(proxy?.address, 500);
  const proxyNote = toOwnerId ? null : trimmed(proxy?.note, 2000);

  if (!votingId || !fromEntityId || !fromOwnerId || (!toOwnerId && !proxyName)) {
    return fail("MANDATE_FIELDS_REQUIRED");
  }
  if (proxyBirthDateRaw && !/^\d{4}-\d{2}-\d{2}$/.test(proxyBirthDateRaw)) {
    return fail("MANDATE_PROXY_INVALID");
  }
  if (toOwnerId && toOwnerId === fromOwnerId) {
    return fail("MANDATE_SELF");
  }

  // §14 ods. 4: paper PoA with an officially verified signature — the
  // verification flag stays mandatory for both proxy kinds.
  if (!paperDocumentConfirmed) {
    return fail("MANDATE_PAPER_REQUIRED");
  }

  const [voting] = await db
    .select()
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);

  if (!voting || voting.status !== "active") {
    return fail("MANDATE_VOTING_NOT_ACTIVE");
  }

  // Check if mandate already exists for this flat in this voting.
  const existing = await db
    .select()
    .from(mandates)
    .where(
      and(
        eq(mandates.votingId, votingId),
        eq(mandates.fromEntityId, fromEntityId),
        eq(mandates.isActive, true)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return fail("MANDATE_EXISTS");
  }

  // Chain check (owner proxies only — an external person has no vote to delegate).
  if (toOwnerId) {
    const chainCheck = await db
      .select()
      .from(mandates)
      .where(
        and(
          eq(mandates.votingId, votingId),
          eq(mandates.fromOwnerId, toOwnerId),
          eq(mandates.isActive, true)
        )
      )
      .limit(1);

    if (chainCheck.length > 0) {
      return fail("MANDATE_CHAIN");
    }
  }

  const [mandate] = await db
    .insert(mandates)
    .values({
      votingId,
      fromOwnerId,
      fromEntityId,
      toOwnerId,
      proxyName,
      proxyBirthDate: proxyBirthDateRaw,
      proxyAddress,
      proxyNote,
      paperDocumentConfirmed: true,
      verifiedByAdminId: session.user.id,
      verificationDate: new Date(),
      verificationNote: verificationNote || null,
    })
    .returning();

  return NextResponse.json(mandate, { status: 201 });
}

/**
 * Revoke (delete) a power of attorney — the undo path of POST (CLAUDE.md
 * Specs rule). Board only (admin / active chairman, assertBoard). Allowed
 * while the voting is not closed, and only when nothing was done under the
 * mandate yet: a ballot cast or an attendance row recorded by the proxy
 * references it (FK restrict) and must be removed first. The row is deleted
 * (the unique (voting, unit) index would block a re-grant otherwise); the
 * append-only voting event log keeps who revoked what.
 *
 * DELETE /api/mandates?id=<mandateId>
 */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session) return fail("UNAUTHORIZED", 401);
  try {
    assertBoard(await principalFromSession(session));
  } catch (err) {
    if (isMcpError(err)) return fail("FORBIDDEN", mcpErrorStatus(err.code));
    throw err;
  }

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return fail("MANDATE_FIELDS_REQUIRED");

  const result = await db.transaction(async (tx) => {
    const [m] = await tx
      .select({
        id: mandates.id,
        votingId: mandates.votingId,
        fromOwnerId: mandates.fromOwnerId,
        fromEntityId: mandates.fromEntityId,
        toOwnerId: mandates.toOwnerId,
        proxyName: mandates.proxyName,
      })
      .from(mandates)
      .where(eq(mandates.id, id))
      .limit(1)
      .for("update");
    if (!m) return { ok: false, error: "MANDATE_NOT_FOUND", status: 404 } as const;

    // Lock the voting row so a concurrent close cannot slip in between.
    const [v] = await tx
      .select({ status: votings.status })
      .from(votings)
      .where(eq(votings.id, m.votingId))
      .limit(1)
      .for("update");
    if (!v || v.status === "closed") return { ok: false, error: "MANDATE_VOTING_CLOSED", status: 409 } as const;

    const [usedByBallot] = await tx
      .select({ id: ballots.id })
      .from(ballots)
      .where(eq(ballots.mandateId, m.id))
      .limit(1);
    const [usedByAttendance] = await tx
      .select({ id: attendance.id })
      .from(attendance)
      .where(eq(attendance.mandateId, m.id))
      .limit(1);
    if (usedByBallot || usedByAttendance) return { ok: false, error: "MANDATE_IN_USE", status: 409 } as const;

    await tx.delete(mandates).where(eq(mandates.id, m.id));
    await recordVotingEvent(tx, {
      votingId: m.votingId,
      kind: "mandate_revoked",
      actorId: session.user.id,
      payload: {
        mandateId: m.id,
        fromOwnerId: m.fromOwnerId,
        fromEntityId: m.fromEntityId,
        toOwnerId: m.toOwnerId,
        proxyName: m.proxyName,
      },
    });
    return { ok: true } as const;
  });

  if (!result.ok) return fail(result.error, result.status);
  return NextResponse.json({ ok: true });
}
