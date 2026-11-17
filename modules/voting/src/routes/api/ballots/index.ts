// BYT-20260609-008 Phase 4a: multi-item ballot casting.
//
// One signed ballot per (voting, unit, owner-share) committing to all item
// choices at once. Co-owners of the same unit each submit their own
// ballot — the per-share engine (BYT-20260511-001) resolves the unit.
//
// BYT-20261117-002 Phase 6: electronic ballots require an active
// confirmation (passkey or e-mail link) — ./confirm.server.ts.
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, entities, memberships } from "@/db/schema";
import {
  votings,
  votingItems,
  ballots,
  ballotItemVotes,
  ballotPhotos,
} from "@modules/voting/src/db/schema";
import { hasPermission } from "@/lib/permissions";
import {
  calculateItemResults,
  computeItemAuditHash,
} from "@modules/voting/src/engine";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { userPasskeyState } from "@/lib/webauthn.server";
import {
  computeMemberWeight,
  computeUnitWeight,
  isUnitScoped,
  normalizeVotingMethod,
} from "@/lib/voting-method";
import type {
  UserRole,
  VoteChoice,
  VoteWithOwnership,
  Country,
  QuorumType,
} from "@/types";
import { deleteBallotAsBoard, validateCast } from "./cast.server";
import { castConfirmed, withdrawConfirmed } from "./confirm.server";

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

  const root = await getCommunityRoot();
  const votingMethod = normalizeVotingMethod(root?.votingMethod);
  const country = (root?.country ?? "sk") as Country;

  const [voting] = await db
    .select({ entityId: votings.entityId })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!voting) {
    return NextResponse.json({ error: "Hlasovanie nenájdené" }, { status: 404 });
  }

  // Ordered ballot items (each with its own quorumType).
  const items = await db
    .select({
      id: votingItems.id,
      idx: votingItems.idx,
      title: votingItems.title,
      description: votingItems.description,
      quorumType: votingItems.quorumType,
    })
    .from(votingItems)
    .where(eq(votingItems.votingId, votingId))
    .orderBy(votingItems.idx);

  // Every item-vote in this voting, with full ownership context so the
  // engine can group by unit and resolve §14 ods. 4 per item. Mirrors the
  // legacy votes GET join, but keyed to (item, ballot).
  const itemVoteRows = await db
    .select({
      itemId: ballotItemVotes.itemId,
      choice: ballotItemVotes.choice,
      ownerId: ballots.ownerId,
      unitEntityId: ballots.entityId,
      ownerName: users.name,
      shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
      area: sql<number | null>`(${entities.data}->>'area_m2')::int`,
      ownerUnitShareNumerator: memberships.ownerUnitShareNumerator,
      ownerUnitShareDenominator: memberships.ownerUnitShareDenominator,
      membershipWeight: memberships.weight,
    })
    .from(ballotItemVotes)
    .innerJoin(ballots, eq(ballots.id, ballotItemVotes.ballotId))
    .leftJoin(users, eq(ballots.ownerId, users.id))
    .innerJoin(entities, eq(entities.id, ballots.entityId))
    .leftJoin(
      memberships,
      and(
        eq(memberships.entityId, ballots.entityId),
        eq(memberships.userId, ballots.ownerId),
        eq(memberships.status, "active")
      )
    )
    .where(eq(ballots.votingId, votingId));

  const votesByItem = new Map<string, VoteWithOwnership[]>();
  for (const r of itemVoteRows) {
    const vow: VoteWithOwnership = {
      unitEntityId: r.unitEntityId,
      userId: r.ownerId,
      userName: r.ownerName,
      choice: r.choice as VoteChoice,
      unitShareNumerator: r.shareNumerator,
      unitShareDenominator: r.shareDenominator,
      area: r.area,
      ownerUnitShareNumerator: r.ownerUnitShareNumerator ?? 1,
      ownerUnitShareDenominator: r.ownerUnitShareDenominator ?? 1,
      membershipWeight: r.membershipWeight ?? 1,
    };
    const slot = votesByItem.get(r.itemId) ?? [];
    slot.push(vow);
    votesByItem.set(r.itemId, slot);
  }

  // Total possible weight over the voting's scope subtree (same rule as the
  // legacy votes GET): unit-scoped sums unit weights; member-scoped counts /
  // sums membership weights.
  let totalPossibleWeight = 0;
  if (isUnitScoped(votingMethod)) {
    const flatsForScope = await db
      .select({
        shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
        shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
        area: sql<number | null>`(${entities.data}->>'area_m2')::int`,
      })
      .from(entities)
      .where(
        and(
          eq(entities.kind, "unit"),
          isNull(entities.archivedAt),
          voting.entityId
            ? sql`${entities.path} LIKE (SELECT path || '%' FROM ${entities} WHERE id = ${voting.entityId})`
            : sql`true`
        )
      );
    for (const f of flatsForScope) {
      totalPossibleWeight += computeUnitWeight(
        {
          shareNumerator: f.shareNumerator,
          shareDenominator: f.shareDenominator,
          area: f.area,
        },
        votingMethod
      );
    }
  } else {
    const scopeMembers = await db
      .select({ weight: memberships.weight })
      .from(memberships)
      .innerJoin(entities, eq(entities.id, memberships.entityId))
      .where(
        and(
          eq(memberships.status, "active"),
          isNull(entities.archivedAt),
          voting.entityId
            ? sql`${entities.path} LIKE (SELECT path || '%' FROM ${entities} WHERE id = ${voting.entityId})`
            : sql`true`
        )
      );
    for (const m of scopeMembers) {
      totalPossibleWeight += computeMemberWeight(
        { membershipWeight: m.weight },
        votingMethod
      );
    }
  }

  const results = calculateItemResults(
    items.map((i) => ({ id: i.id, quorumType: i.quorumType as QuorumType })),
    votesByItem,
    votingMethod,
    totalPossibleWeight,
    { country }
  );

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
      confirmationMethod: ballots.confirmationMethod,
      confirmedAt: ballots.confirmedAt,
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

  return NextResponse.json({
    items,
    results,
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
  if (!hasPermission(session.user.role as UserRole, "recordPaperVote")) {
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
  const { marked, ballotHash } = v;
  const recordedAt = new Date();

  // Upsert: a re-submitted ballot supersedes (not appends) the prior one.
  const [existing] = await db
    .select({ id: ballots.id })
    .from(ballots)
    .where(
      and(
        eq(ballots.votingId, votingId),
        eq(ballots.entityId, flatId),
        eq(ballots.ownerId, voterId)
      )
    )
    .limit(1);

  const paperValues = {
    voteType: "paper" as const,
    recordedById: session.user.id,
    mandateId: mandateId || null,
    ballotHash,
    // A paper ballot replaces any electronic confirmation metadata.
    signature: null,
    confirmationMethod: null,
    confirmedAt: null,
    recordedAt,
  };

  const ballotId = await db.transaction(async (tx) => {
    let bId: string;
    if (existing) {
      bId = existing.id;
      await tx.update(ballots).set(paperValues).where(eq(ballots.id, bId));
      await tx.delete(ballotItemVotes).where(eq(ballotItemVotes.ballotId, bId));
      await tx.delete(ballotPhotos).where(eq(ballotPhotos.ballotId, bId));
    } else {
      const [created] = await tx
        .insert(ballots)
        .values({ votingId, entityId: flatId, ownerId: voterId, ...paperValues })
        .returning({ id: ballots.id });
      bId = created.id;
    }

    if (marked.length > 0) {
      await tx.insert(ballotItemVotes).values(
        marked.map((m) => ({
          ballotId: bId,
          itemId: m.itemId,
          choice: m.choice,
          itemAuditHash: computeItemAuditHash({
            votingId,
            itemId: m.itemId,
            entityId: flatId,
            ownerId: voterId,
            choice: m.choice,
            recordedAt,
          }),
        }))
      );
    }

    if (photoUrls.length > 0) {
      await tx.insert(ballotPhotos).values(
        photoUrls.map((url, idx) => ({ ballotId: bId, storageKey: url, idx }))
      );
    }

    return bId;
  });

  return NextResponse.json(
    { ballotId, ballotHash, recordedAt, superseded: Boolean(existing) },
    { status: existing ? 200 : 201 }
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

  // Withdrawing someone else's ballot requires the paper-recorder permission.
  if (!hasPermission(session.user.role as UserRole, "recordPaperVote")) {
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

  const deleted = await deleteBallotAsBoard({ votingId, flatId, ownerId: targetOwnerId });
  if (!deleted) {
    return NextResponse.json({ error: "Hlas nenájdený" }, { status: 404 });
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
