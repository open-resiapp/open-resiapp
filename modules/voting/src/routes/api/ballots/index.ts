// BYT-20260609-008 Phase 4a: multi-item ballot casting.
//
// One signed ballot per (voting, unit, owner-share) committing to all item
// choices at once. Co-owners of the same unit each submit their own
// ballot — the per-share engine (BYT-20260511-001) resolves the unit.
//
// BYT-20261117-002 Phase 6: electronic ballots require an active
// confirmation (passkey or e-mail link) — ./confirm.server.ts.
import { NextRequest, NextResponse } from "next/server";
import type { Session } from "next-auth";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, entities, memberships } from "@/db/schema";
import {
  ballots,
  ballotItemVotes,
  ballotPhotos,
} from "@modules/voting/src/db/schema";
import { hasPermission } from "@/lib/permissions";
import { getVotingResults } from "@modules/voting/src/results";
import { sessionCanSeeVoting } from "@modules/voting/src/votings";
import { getVotingParticipation } from "@modules/voting/src/participation";
import { principalFromSession } from "@/lib/mcp/principal";
import { canRecordForVotingId } from "@modules/voting/src/counter-authz.server";
import { userPasskeyState } from "@/lib/webauthn.server";
import type { UserRole } from "@/types";
import { deleteBallotAsBoard, recordPaperBallot, validateCast } from "./cast.server";
import {
  buildOverview,
  canStillPass,
  splitByChannel,
  type OverviewInput,
} from "@modules/voting/src/workflow/overview";
import { getCommunityRoot } from "@/lib/legacy-compat";
import type { Country, QuorumType } from "@/types";
import { castConfirmed, withdrawConfirmed } from "./confirm.server";

/** Board, or the vote counter of THIS voting (2026-11-18 review). */
async function sessionMayRecord(session: Session, votingId: string): Promise<boolean> {
  try {
    return await canRecordForVotingId(await principalFromSession(session), votingId);
  } catch {
    return false;
  }
}

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
  // Same visibility as GET /api/votings/[id] (scope, board-only drafts):
  // ballots carry owner names and choices. Invisible = 404.
  if (!(await sessionCanSeeVoting(session, votingId))) {
    return NextResponse.json({ error: "Hlasovanie nenájdené" }, { status: 404 });
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
    repeatOfQuorumType: i.repeatOfQuorumType,
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
      confirmationMethod: ballots.confirmationKind,
      confirmedAt: ballots.confirmedAt,
      // Frozen shares (cast time / close) — the overview uses the same data as the engine.
      ownerUnitShareNumerator: ballots.ownerUnitShareNumerator,
      ownerUnitShareDenominator: ballots.ownerUnitShareDenominator,
      membershipWeight: ballots.membershipWeight,
      unitShareNumerator: ballots.unitShareNumerator,
      unitShareDenominator: ballots.unitShareDenominator,
      unitAreaM2: ballots.unitAreaM2,
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

  // Snapshot columns are internal (overview input), not part of the response shape.
  const ballotsList = ballotRows.map(
    ({
      ownerUnitShareNumerator: _on,
      ownerUnitShareDenominator: _od,
      membershipWeight: _mw,
      unitShareNumerator: _un,
      unitShareDenominator: _ud,
      unitAreaM2: _ua,
      ...b
    }) => ({
      ...b,
      choices: choicesByBallot.get(b.id) ?? [],
      photos: photosByBallot.get(b.id) ?? [],
    })
  );
  const snapshotById = new Map(ballotRows.map((b) => [b.id, b]));

  const userBallots = ballotsList
    .filter((b) => b.ownerId === session.user.id)
    .map((b) => ({
      ballotId: b.id,
      flatId: b.entityId,
      voteType: b.voteType,
      recordedAt: b.recordedAt,
      ballotHash: b.ballotHash,
      confirmationMethod: b.confirmationMethod,
      confirmedAt: b.confirmedAt,
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
        // Only an owner membership votes (validateCast) — a tenant gets no cast form.
        eq(memberships.role, "owner"),
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt)
      )
    );

  // Whether the caller has an ACTIVE passkey (and whether one waits for its
  // e-mail activation) — lets the cast UI pick its primary confirmation
  // button without a second request.
  const passkeyState =
    userFlats.length > 0
      ? await userPasskeyState(session.user.id)
      : { active: false, pending: false };

  // Turnout + who has not voted yet: board and THIS voting's counter (the
  // same people who record paper ballots for the missing units).
  const canSeeParticipation = await sessionMayRecord(session, votingId);
  const participation = canSeeParticipation
    ? await getVotingParticipation(votingId)
    : null;

  // BYT-20261118-002 §5: management drill-down, computed here so the page
  // makes ONE request (no second fetch, no polling). Board / counter only.
  let overview: unknown = null;
  if (participation) {
    const root = await getCommunityRoot();
    // Same inputs as the engine: method (frozen at close), total, presence
    // of a meeting voting, and the ballots' frozen shares.
    const presence = results.find((r) => r.presence)?.presence ?? null;
    const ovInput: OverviewInput = {
      country: (root?.country ?? "sk") as Country,
      votingMethod: participation.votingMethod,
      totalPossibleWeight,
      items: bundle.items.map((i) => ({ id: i.id, quorumType: i.quorumType as QuorumType })),
      eligible: participation.eligible,
      ballots: ballotsList.map((b) => {
        const snap = snapshotById.get(b.id);
        return {
          entityId: b.entityId,
          ownerId: b.ownerId,
          ownerName: b.ownerName,
          voteType: b.voteType,
          recordedAt: b.recordedAt.toISOString(),
          choices: b.choices,
          frozen: snap
            ? {
                ownerUnitShareNumerator: snap.ownerUnitShareNumerator,
                ownerUnitShareDenominator: snap.ownerUnitShareDenominator,
                membershipWeight: snap.membershipWeight,
                unitShareNumerator: snap.unitShareNumerator,
                unitShareDenominator: snap.unitShareDenominator,
                area: snap.unitAreaM2,
              }
            : undefined,
        };
      }),
      votingType: presence ? "meeting" : undefined,
      presence: presence && presence.basis === "attendance"
        ? { weight: presence.weight, owners: presence.owners }
        : null,
    };
    const outlook = canStillPass(ovInput);
    // "passed" is the binding engine result (frozen shares), not a re-run.
    for (const r of results) if (r.passed) outlook[r.itemId] = "passed";
    overview = {
      items: buildOverview(ovInput),
      channels: splitByChannel(ovInput),
      outlook,
      generatedAt: new Date().toISOString(),
    };
  }

  return NextResponse.json({
    items,
    results,
    participation: participation
      ? {
          eligibleCount: participation.eligibleCount,
          votedCount: participation.votedCount,
          eligibleWeight: participation.eligibleWeight,
          votedWeight: participation.votedWeight,
          notVoted: participation.notVoted.map((r) => ({
            unitId: r.unitId,
            unitLabel: r.unitLabel,
            ownerId: r.ownerId,
            ownerName: r.ownerName,
          })),
        }
      : null,
    overview,
    ballots: ballotsList,
    userBallots,
    userFlats,
    totalBallots: ballotRows.length,
    totalPossibleWeight,
    hasPasskey: passkeyState.active,
    hasPendingPasskey: passkeyState.pending,
  });
}

// ── POST: cast (or supersede) one ballot ─────────────────
// Electronic ballots (BYT-20261117-002 Phase 6) are recorded only with a
// confirmation proof (passkey assertion or e-mail link token) bound to the
// exact ballot content — see ./confirm.server.ts. A session alone is
// rejected with CONFIRMATION_REQUIRED. Paper ballots (counter/admin with a
// photo) keep the pre-Phase-6 behaviour and messages.
export async function POST(request: NextRequest) {
  let body: Record<string, unknown> | null = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  if (body.voteType !== "paper") {
    return castConfirmed(request, body);
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const votingId = typeof body.votingId === "string" ? body.votingId : "";
  const flatId = typeof body.flatId === "string" ? body.flatId : "";
  const ownerId = typeof body.ownerId === "string" ? body.ownerId : "";
  const mandateId = typeof body.mandateId === "string" ? body.mandateId : null;
  const photoUrls: string[] = Array.isArray(body.photoUrls)
    ? body.photoUrls.filter((u: unknown): u is string => typeof u === "string")
    : [];

  if (!votingId || !flatId) {
    return NextResponse.json(
      { error: "votingId a flatId sú povinné" },
      { status: 400 }
    );
  }

  const voterId = ownerId;
  if (!voterId) {
    return NextResponse.json({ error: "ownerId je povinný pre listinný hlas" }, { status: 400 });
  }

  // Permission.
  if (photoUrls.length === 0) {
    return NextResponse.json({ error: "PAPER_PHOTO_REQUIRED" }, { status: 400 });
  }
  // Board, or the vote counter of THIS voting (votings.voteCounterId).
  if (!(await sessionMayRecord(session, votingId))) {
    return NextResponse.json(
      { error: "Nemáte oprávnenie zapisovať listinné hlasy" },
      { status: 403 }
    );
  }

  const v = await validateCast({
    votingId,
    flatId,
    voterId,
    incoming: body.items,
    electronic: false,
  });
  if (!v.ok) {
    return NextResponse.json({ error: v.legacyMessage }, { status: v.status });
  }

  // One transaction with the voting row FOR SHARE (status re-checked) and the
  // ballot row FOR UPDATE — a concurrent close or second recorder cannot interleave.
  const r = await recordPaperBallot({
    votingId,
    flatId,
    voterId,
    actorId: session.user.id,
    mandateId,
    marked: v.marked,
    ballotHash: v.ballotHash,
    photoUrls,
  });
  if (!r.ok) {
    return NextResponse.json({ error: r.code }, { status: r.status });
  }

  return NextResponse.json(
    { ballotId: r.ballotId, ballotHash: v.ballotHash, recordedAt: r.recordedAt, superseded: r.superseded },
    { status: r.superseded ? 200 : 201 }
  );
}

// ── DELETE: withdraw a ballot before close ───────────────
// Owner (no ownerId, or ownerId = self): requires a confirmation bound to
// withdrawing exactly the current ballot — see withdrawConfirmed. A paper
// ballot cannot be withdrawn by its owner (PAPER_BALLOT_LOCKED).
// Board / counter (ownerId of someone else, recordPaperVote permission):
// deletes without owner confirmation, and — like an owner withdrawal —
// invalidates every confirmation token issued before it.
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const votingId = searchParams.get("votingId");
  const flatId = searchParams.get("flatId");
  const ownerParam = searchParams.get("ownerId");

  let body: Record<string, unknown> | null = null;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    body = null;
  }

  // E-mail withdraw link: the signed token names voter, voting and unit; no
  // session needed (the link may be opened on another device).
  const confirmation = body?.confirmation as { method?: unknown } | undefined;
  if (confirmation?.method === "email") {
    return withdrawConfirmed(request, body, { votingId, flatId });
  }

  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  if (!votingId || !flatId) {
    return NextResponse.json(
      { error: "votingId a flatId sú povinné" },
      { status: 400 }
    );
  }

  const targetOwnerId = ownerParam && ownerParam !== session.user.id ? ownerParam : session.user.id;
  if (targetOwnerId === session.user.id) {
    return withdrawConfirmed(request, body, { votingId, flatId });
  }

  // Withdrawing someone else's ballot: board, or the vote counter of THIS voting.
  if (!(await sessionMayRecord(session, votingId))) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  // Status is re-checked inside the transaction on the locked voting row.
  const deleted = await deleteBallotAsBoard({ votingId, flatId, ownerId: targetOwnerId });
  if (!deleted.ok) {
    if (deleted.code === "VOTING_NOT_ACTIVE") {
      return NextResponse.json(
        { error: "Hlas je možné stiahnuť len počas aktívneho hlasovania" },
        { status: 400 }
      );
    }
    if (deleted.code === "BALLOT_NOT_FOUND") {
      return NextResponse.json({ error: "Hlas nenájdený" }, { status: 404 });
    }
    return NextResponse.json({ error: deleted.code }, { status: deleted.status });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
