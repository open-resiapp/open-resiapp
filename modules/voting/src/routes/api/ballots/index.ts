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
  votingItems,
  ballots,
  ballotItemVotes,
  ballotPhotos,
} from "@modules/voting/src/db/schema";
import { hasPermission } from "@/lib/permissions";
import {
  calculateItemResults,
  computeBallotHash,
  computeItemAuditHash,
} from "@modules/voting/src/engine";
import { isElectronicVotingBlocked } from "@modules/voting/src/rules";
import { getCommunityRoot } from "@/lib/legacy-compat";
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

const VALID_CHOICES: VoteChoice[] = ["za", "proti", "zdrzal_sa"];

interface IncomingItemChoice {
  itemId?: unknown;
  choice?: unknown;
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

  // Permission.
  if (isPaper) {
    if (photoUrls.length === 0) {
      return NextResponse.json({ error: "PAPER_PHOTO_REQUIRED" }, { status: 400 });
    }
    if (!hasPermission(session.user.role as UserRole, "recordPaperVote")) {
      return NextResponse.json(
        { error: "Nemáte oprávnenie zapisovať listinné hlasy" },
        { status: 403 }
      );
    }
  } else if (!hasPermission(session.user.role as UserRole, "vote")) {
    return NextResponse.json({ error: "Nemáte oprávnenie hlasovať" }, { status: 403 });
  }

  const [voting] = await db
    .select()
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!voting || voting.status !== "active") {
    return NextResponse.json({ error: "Hlasovanie nie je aktívne" }, { status: 400 });
  }

  const root = await getCommunityRoot();
  const country = (root?.country ?? "sk") as Country;
  if (!isPaper && isElectronicVotingBlocked(country, voting.votingType, voting.initiatedBy)) {
    return NextResponse.json(
      {
        error:
          voting.votingType === "meeting"
            ? "Elektronické hlasovanie nie je povolené pre hlasovanie na schôdzi"
            : "Elektronické hlasovanie nie je povolené pre hlasovanie iniciované štvrtinou vlastníkov",
      },
      { status: 400 }
    );
  }

  // Ownership: the voter must hold an active membership on the unit.
  const [ownerFlat] = await db
    .select({ id: memberships.id })
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, voterId),
        eq(memberships.entityId, flatId),
        eq(memberships.status, "active")
      )
    )
    .limit(1);
  if (!ownerFlat) {
    return NextResponse.json({ error: "Vlastník nevlastní tento byt" }, { status: 400 });
  }

  // Scope: the flat must sit within the voting's subtree.
  if (voting.entityId) {
    const [flatRow] = await db
      .select({ flatPath: entities.path })
      .from(entities)
      .where(eq(entities.id, flatId))
      .limit(1);
    const [scopeRow] = await db
      .select({ scopePath: entities.path })
      .from(entities)
      .where(eq(entities.id, voting.entityId))
      .limit(1);
    if (flatRow && scopeRow && !flatRow.flatPath.startsWith(scopeRow.scopePath)) {
      return NextResponse.json(
        { error: "Tento byt nie je v hlasovanom rozsahu" },
        { status: 403 }
      );
    }
  }

  // Validate the submitted item choices against this voting's items. Unmarked
  // items are allowed (silence/abstain per jurisdiction rule) — they simply
  // produce no ballot_item_vote row.
  const items = await db
    .select({ id: votingItems.id })
    .from(votingItems)
    .where(eq(votingItems.votingId, votingId));
  const validItemIds = new Set(items.map((i) => i.id));

  const marked: { itemId: string; choice: VoteChoice }[] = [];
  const seen = new Set<string>();
  for (const it of incoming) {
    const itemId = typeof it.itemId === "string" ? it.itemId : "";
    const choice = it.choice as VoteChoice;
    if (!itemId || !validItemIds.has(itemId)) {
      return NextResponse.json(
        { error: "Neplatná položka hlasovania" },
        { status: 400 }
      );
    }
    if (!VALID_CHOICES.includes(choice)) {
      return NextResponse.json({ error: "Neplatná voľba" }, { status: 400 });
    }
    if (seen.has(itemId)) {
      return NextResponse.json(
        { error: "Duplicitná voľba pre položku" },
        { status: 400 }
      );
    }
    seen.add(itemId);
    marked.push({ itemId, choice });
  }

  const recordedAt = new Date();
  const ballotHash = computeBallotHash(marked);

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

  const ballotId = await db.transaction(async (tx) => {
    let bId: string;
    if (existing) {
      bId = existing.id;
      await tx
        .update(ballots)
        .set({
          voteType: isPaper ? "paper" : "electronic",
          recordedById: isPaper ? session.user.id : null,
          mandateId: mandateId || null,
          ballotHash,
          recordedAt,
        })
        .where(eq(ballots.id, bId));
      await tx.delete(ballotItemVotes).where(eq(ballotItemVotes.ballotId, bId));
      await tx.delete(ballotPhotos).where(eq(ballotPhotos.ballotId, bId));
    } else {
      const [created] = await tx
        .insert(ballots)
        .values({
          votingId,
          entityId: flatId,
          ownerId: voterId,
          voteType: isPaper ? "paper" : "electronic",
          recordedById: isPaper ? session.user.id : null,
          mandateId: mandateId || null,
          ballotHash,
          recordedAt,
        })
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
