// BYT-20260609-008 Phase 4a: multi-item ballot casting.
//
// One signed ballot per (voting, unit, owner-share) committing to all item
// choices at once. Supersedes the single-choice mod_voting_votes path (kept
// live until Phase 6). Co-owners of the same unit each submit their own
// ballot — the per-share engine (BYT-20260511-001) resolves the unit.
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, entities, memberships } from "@/db/schema";
import {
  votings,
  ballots,
  ballotItemVotes,
  ballotPhotos,
} from "@modules/voting/src/db/schema";
import { hasPermission } from "@/lib/permissions";
import { getVotingResults } from "@modules/voting/src/results";
import {
  persistConfirmedBallot,
  validateBallotCast,
  type IncomingItemChoice,
  type ValidatedBallot,
} from "@modules/voting/src/ballots";
import { viewerFromSession } from "@/lib/mcp/principal";
import { isMcpError } from "@/lib/mcp/errors";
import type { UserRole } from "@/types";

// ── GET: items + per-item results + caller's ballots ──────
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const votingId = searchParams.get("votingId");
  if (!votingId) {
    return NextResponse.json({ error: "votingId je povinný" }, { status: 400 });
  }
  if (!hasPermission(session.user.role as UserRole, "viewVotingResults")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  // Per-item tallies — the single shared implementation (also used by the
  // accounting pipeline and the MCP get_voting_results tool).
  const bundle = await getVotingResults(votingId);
  if (!bundle) {
    return NextResponse.json({ error: "Hlasovanie nenájdené" }, { status: 404 });
  }
  const items = bundle.items.map((i) => ({
    id: i.id,
    idx: i.idx,
    title: i.title,
    description: i.description,
    quorumType: i.quorumType,
  }));
  const { results, totalPossibleWeight } = bundle;

  // All ballots in this voting (for admin display + paper photos), plus the
  // caller's own ballots (for pre-filling the cast form).
  const ballotRows = await db
    .select({
      id: ballots.id,
      entityId: ballots.entityId,
      ownerId: ballots.ownerId,
      ownerName: users.name,
      flatNumber: sql<string>`${entities.data}->>'flat_number'`,
      voteType: ballots.voteType,
      ballotHash: ballots.ballotHash,
      recordedAt: ballots.recordedAt,
      disputed: ballots.disputed,
    })
    .from(ballots)
    .leftJoin(users, eq(ballots.ownerId, users.id))
    .innerJoin(entities, eq(entities.id, ballots.entityId))
    .where(eq(ballots.votingId, votingId));

  const ballotIds = ballotRows.map((b) => b.id);
  const choiceRows = ballotIds.length
    ? await db
        .select({
          ballotId: ballotItemVotes.ballotId,
          itemId: ballotItemVotes.itemId,
          choice: ballotItemVotes.choice,
          itemAuditHash: ballotItemVotes.itemAuditHash,
        })
        .from(ballotItemVotes)
        .where(inArray(ballotItemVotes.ballotId, ballotIds))
    : [];
  const photoRows = ballotIds.length
    ? await db
        .select({
          ballotId: ballotPhotos.ballotId,
          storageKey: ballotPhotos.storageKey,
          idx: ballotPhotos.idx,
        })
        .from(ballotPhotos)
        .where(inArray(ballotPhotos.ballotId, ballotIds))
        .orderBy(ballotPhotos.idx)
    : [];

  const choicesByBallot = new Map<
    string,
    { itemId: string; choice: string; itemAuditHash: string }[]
  >();
  for (const c of choiceRows) {
    const slot = choicesByBallot.get(c.ballotId) ?? [];
    slot.push({ itemId: c.itemId, choice: c.choice, itemAuditHash: c.itemAuditHash });
    choicesByBallot.set(c.ballotId, slot);
  }
  const photosByBallot = new Map<string, { storageKey: string; idx: number }[]>();
  for (const p of photoRows) {
    const slot = photosByBallot.get(p.ballotId) ?? [];
    slot.push({ storageKey: p.storageKey, idx: p.idx });
    photosByBallot.set(p.ballotId, slot);
  }

  const ballotsList = ballotRows.map((b) => ({
    ...b,
    choices: choicesByBallot.get(b.id) ?? [],
    photos: photosByBallot.get(b.id) ?? [],
  }));

  const userBallots = ballotsList
    .filter((b) => b.ownerId === session.user.id)
    .map((b) => ({
      ballotId: b.id,
      flatId: b.entityId,
      voteType: b.voteType,
      recordedAt: b.recordedAt,
      choices: Object.fromEntries(b.choices.map((c) => [c.itemId, c.choice])),
    }));

  // Current user's flats within the voting scope.
  const userFlats = await db
    .select({
      flatId: entities.id,
      flatNumber: sql<string>`${entities.data}->>'flat_number'`,
    })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(
        eq(memberships.userId, session.user.id),
        eq(memberships.status, "active"),
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt)
      )
    );

  return NextResponse.json({
    items,
    results,
    ballots: ballotsList,
    userBallots,
    userFlats,
    totalBallots: ballotRows.length,
    totalPossibleWeight,
  });
}

// ── POST: cast (or supersede) one ballot ─────────────────
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const body = await request.json();
  const { votingId, flatId, ownerId, voteType, mandateId } = body;
  const photoUrls: string[] = Array.isArray(body.photoUrls)
    ? body.photoUrls.filter((u: unknown) => typeof u === "string")
    : [];
  const incoming: IncomingItemChoice[] = Array.isArray(body.items) ? body.items : [];

  if (!votingId || !flatId) {
    return NextResponse.json(
      { error: "votingId a flatId sú povinné" },
      { status: 400 }
    );
  }

  const isPaper = voteType === "paper";
  const voterId = isPaper ? ownerId : session.user.id;
  if (isPaper && !voterId) {
    return NextResponse.json({ error: "ownerId je povinný pre listinný hlas" }, { status: 400 });
  }
  if (isPaper && photoUrls.length === 0) {
    return NextResponse.json({ error: "PAPER_PHOTO_REQUIRED" }, { status: 400 });
  }

  // Validate (permission, voting active, electronic allowed, ownership,
  // scope, items) then persist — the same two lib steps the MCP ballot
  // confirmation uses, run back to back here (no confirmation step yet —
  // spec Notes → found gaps).
  let validated: ValidatedBallot;
  try {
    validated = await validateBallotCast(viewerFromSession(session), {
      votingId,
      unitId: flatId,
      items: incoming,
      paper: isPaper ? { ownerId: voterId } : undefined,
    });
  } catch (err) {
    const mapped = ballotErrorResponse(err);
    if (mapped) return mapped;
    throw err;
  }

  const result = await persistConfirmedBallot(validated, {
    recordedById: isPaper ? session.user.id : null,
    mandateId: mandateId || null,
    photoUrls,
  });

  return NextResponse.json(
    {
      ballotId: result.ballotId,
      ballotHash: result.ballotHash,
      recordedAt: result.recordedAt,
      superseded: result.superseded,
    },
    { status: result.superseded ? 200 : 201 }
  );
}

/** Maps validateBallotCast's McpError codes back to the route's messages. */
function ballotErrorResponse(err: unknown): NextResponse | null {
  if (!isMcpError(err)) return null;
  const json = (error: string, status: number) =>
    NextResponse.json({ error }, { status });
  switch (err.code) {
    case "forbidden":
      return err.details?.kind === "paper"
        ? json("Nemáte oprávnenie zapisovať listinné hlasy", 403)
        : json("Nemáte oprávnenie hlasovať", 403);
    case "voting_not_active":
      return json("Hlasovanie nie je aktívne", 400);
    case "electronic_blocked":
      return err.details?.reason === "meeting"
        ? json("Elektronické hlasovanie nie je povolené pre hlasovanie na schôdzi", 400)
        : json("Elektronické hlasovanie nie je povolené pre hlasovanie iniciované štvrtinou vlastníkov", 400);
    case "not_unit_owner":
      return json("Vlastník nevlastní tento byt", 400);
    case "unit_out_of_scope":
      return json("Tento byt nie je v hlasovanom rozsahu", 403);
    case "validation.itemId":
      return json("Neplatná položka hlasovania", 400);
    case "validation.choice":
      return json("Neplatná voľba", 400);
    case "validation.items":
      return json("Duplicitná voľba pre položku", 400);
    default:
      return null;
  }
}

// ── DELETE: withdraw a ballot before close ───────────────
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const votingId = searchParams.get("votingId");
  const flatId = searchParams.get("flatId");
  const ownerParam = searchParams.get("ownerId");
  if (!votingId || !flatId) {
    return NextResponse.json(
      { error: "votingId a flatId sú povinné" },
      { status: 400 }
    );
  }

  // Withdrawing someone else's ballot requires the paper-recorder permission.
  const targetOwnerId = ownerParam && ownerParam !== session.user.id ? ownerParam : session.user.id;
  if (targetOwnerId !== session.user.id) {
    if (!hasPermission(session.user.role as UserRole, "recordPaperVote")) {
      return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
    }
  } else if (!hasPermission(session.user.role as UserRole, "vote")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const [voting] = await db
    .select({ status: votings.status })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!voting || voting.status !== "active") {
    return NextResponse.json(
      { error: "Hlas je možné stiahnuť len počas aktívneho hlasovania" },
      { status: 400 }
    );
  }

  // ballot_item_votes + ballot_photos cascade on ballot delete.
  const deleted = await db
    .delete(ballots)
    .where(
      and(
        eq(ballots.votingId, votingId),
        eq(ballots.entityId, flatId),
        eq(ballots.ownerId, targetOwnerId)
      )
    )
    .returning({ id: ballots.id });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Hlas nenájdený" }, { status: 404 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
