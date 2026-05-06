import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, and, eq, isNull, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, entities, housingUnitData, memberships } from "@/db/schema";
import { votes, votings } from "@modules/voting/src/db/schema";
import { hasPermission } from "@/lib/permissions";
import { generateAuditHash, calculateResults } from "@modules/voting/src/engine";
import { sendVoteConfirmation } from "@modules/voting/src/email/vote-confirmation";
import { isElectronicVotingBlocked } from "@modules/voting/src/rules";
import { dispatchHook } from "@/lib/modules/dispatch";
import { getCommunityRoot } from "@/lib/legacy-compat";
import type {
  UserRole,
  VoteChoice,
  VotingMethod,
  VoteWithShare,
  QuorumType,
  Country,
} from "@/types";

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

  // Phase 9.2: read voting method + country from the root entity's
  // housing_root_data via the legacy-compat helper.
  const root = await getCommunityRoot();
  const votingMethod = (root?.votingMethod ?? "per_share") as VotingMethod;
  const country = (root?.country ?? "sk") as Country;

  // Voting scope (entityId points at root / entrance / flat).
  const [voting] = await db
    .select({
      quorumType: votings.quorumType,
      entityId: votings.entityId,
    })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);

  const quorumType = (voting?.quorumType ?? "simple_all") as QuorumType;

  // Vote rows joined with the housing_unit entity + housing_unit_data
  // for share/area data, and the voter's user record.
  type VoteRow = {
    id: string;
    choice: "za" | "proti" | "zdrzal_sa";
    voteType: "electronic" | "paper";
    createdAt: Date;
    ownerId: string;
    flatId: string;
    disputed: boolean;
    auditHash: string;
    paperPhotoUrl: string | null;
    ownerName: string | null;
    flatNumber: string;
    shareNumerator: number;
    shareDenominator: number;
    area: number | null;
  };
  const voteRows: VoteRow[] = await db
    .select({
      id: votes.id,
      choice: votes.choice,
      voteType: votes.voteType,
      createdAt: votes.createdAt,
      ownerId: votes.ownerId,
      flatId: votes.entityId,
      disputed: votes.disputed,
      auditHash: votes.auditHash,
      paperPhotoUrl: votes.paperPhotoUrl,
      ownerName: users.name,
      flatNumber: housingUnitData.flatNumber,
      shareNumerator: housingUnitData.shareNumerator,
      shareDenominator: housingUnitData.shareDenominator,
      area: housingUnitData.area,
    })
    .from(votes)
    .leftJoin(users, eq(votes.ownerId, users.id))
    .innerJoin(housingUnitData, eq(housingUnitData.entityId, votes.entityId))
    .where(eq(votes.votingId, votingId));

  const votesWithShare: VoteWithShare[] = voteRows.map((v) => ({
    choice: v.choice as VoteChoice,
    shareNumerator: v.shareNumerator,
    shareDenominator: v.shareDenominator,
    area: v.area,
  }));

  // Total possible weight: sum housing_unit_data over every housing_unit
  // entity in the voting's subtree (or all if root-scope). The path
  // overlap is computed via the materialized path.
  const flatsForScope = voting?.entityId
    ? await db
        .select({
          shareNumerator: housingUnitData.shareNumerator,
          shareDenominator: housingUnitData.shareDenominator,
          area: housingUnitData.area,
        })
        .from(entities)
        .innerJoin(housingUnitData, eq(housingUnitData.entityId, entities.id))
        .where(
          and(
            eq(entities.kind, "housing_unit"),
            isNull(entities.archivedAt),
            sql`${entities.path} LIKE (
              SELECT path || '%' FROM ${entities} WHERE id = ${voting.entityId}
            )`
          )
        )
    : await db
        .select({
          shareNumerator: housingUnitData.shareNumerator,
          shareDenominator: housingUnitData.shareDenominator,
          area: housingUnitData.area,
        })
        .from(entities)
        .innerJoin(housingUnitData, eq(housingUnitData.entityId, entities.id))
        .where(
          and(eq(entities.kind, "housing_unit"), isNull(entities.archivedAt))
        );

  let totalPossibleWeight = 0;
  for (const f of flatsForScope) {
    switch (votingMethod) {
      case "per_flat":
        totalPossibleWeight += 1;
        break;
      case "per_area":
        totalPossibleWeight += f.area ?? 1;
        break;
      case "per_share":
      default:
        totalPossibleWeight += f.shareNumerator / f.shareDenominator;
        break;
    }
  }

  const results = calculateResults(
    votesWithShare,
    votingMethod,
    quorumType,
    totalPossibleWeight,
    { country }
  );

  const userVotedFlats = voteRows
    .filter((v) => v.ownerId === session.user.id)
    .map((v) => ({ flatId: v.flatId, choice: v.choice }));

  // Current user's flats via memberships at housing_unit entities.
  type UserFlat = { flatId: string; flatNumber: string };
  const currentUserFlats: UserFlat[] = await db
    .select({
      flatId: entities.id,
      flatNumber: housingUnitData.flatNumber,
    })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .innerJoin(housingUnitData, eq(housingUnitData.entityId, entities.id))
    .where(
      and(
        eq(memberships.userId, session.user.id),
        eq(memberships.status, "active"),
        eq(entities.kind, "housing_unit"),
        isNull(entities.archivedAt)
      )
    );

  return NextResponse.json({
    votes: voteRows,
    results,
    userVotedFlats,
    userFlats: currentUserFlats,
    totalVotes: voteRows.length,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const body = await request.json();
  const { votingId, choice, flatId, ownerId, voteType, paperPhotoUrl } = body;

  if (!votingId || !choice || !flatId) {
    return NextResponse.json(
      { error: "votingId, choice a flatId sú povinné" },
      { status: 400 }
    );
  }

  const isPaperVote = voteType === "paper";
  const voterId = isPaperVote ? ownerId : session.user.id;

  if (isPaperVote) {
    if (!hasPermission(session.user.role as UserRole, "recordPaperVote")) {
      return NextResponse.json(
        { error: "Nemáte oprávnenie zapisovať listinné hlasy" },
        { status: 403 }
      );
    }
  } else {
    if (!hasPermission(session.user.role as UserRole, "vote")) {
      return NextResponse.json({ error: "Nemáte oprávnenie hlasovať" }, { status: 403 });
    }
  }

  const [voting] = await db
    .select()
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);

  if (!voting || voting.status !== "active") {
    return NextResponse.json(
      { error: "Hlasovanie nie je aktívne" },
      { status: 400 }
    );
  }

  // Country for rules engine — from root entity's housing_root_data.
  const root = await getCommunityRoot();
  const voteCountry = (root?.country ?? "sk") as Country;

  if (!isPaperVote && isElectronicVotingBlocked(voteCountry, voting.votingType, voting.initiatedBy)) {
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

  // Validate ownership via memberships (housing_unit entity id == flat id
  // because the 0023 backfill reused flat ids).
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
    return NextResponse.json(
      { error: "Vlastník nevlastní tento byt" },
      { status: 400 }
    );
  }

  // Validate flat is within the voting's subtree (path overlap on entities).
  if (voting.entityId) {
    const flatRow = await db
      .select({ flatPath: entities.path })
      .from(entities)
      .where(eq(entities.id, flatId))
      .limit(1);
    const scopeRow = await db
      .select({ scopePath: entities.path })
      .from(entities)
      .where(eq(entities.id, voting.entityId))
      .limit(1);
    if (
      flatRow[0] &&
      scopeRow[0] &&
      !flatRow[0].flatPath.startsWith(scopeRow[0].scopePath)
    ) {
      return NextResponse.json(
        { error: "Tento byt nie je v hlasovanom rozsahu" },
        { status: 403 }
      );
    }
  }

  // Helper: re-fetch flat number for confirmation email.
  async function loadFlatNumber(eid: string): Promise<string | null> {
    const [row] = await db
      .select({ flatNumber: housingUnitData.flatNumber })
      .from(housingUnitData)
      .where(eq(housingUnitData.entityId, eid))
      .limit(1);
    return row?.flatNumber ?? null;
  }

  const _aliasedTableUnused = aliasedTable; // keep import warning quiet
  void _aliasedTableUnused;

  // Existing vote check — by entityId now (was flatId).
  const existingVote = await db
    .select()
    .from(votes)
    .where(and(eq(votes.votingId, votingId), eq(votes.entityId, flatId)))
    .limit(1);

  if (existingVote.length > 0) {
    const existing = existingVote[0];

    if (!isPaperVote && existing.ownerId !== voterId) {
      return NextResponse.json(
        { error: "Za tento byt už hlasoval iný vlastník" },
        { status: 400 }
      );
    }

    if (existing.choice === choice) {
      return NextResponse.json(
        { ...existing, auditHash: existing.auditHash },
        { status: 200 }
      );
    }

    const now = new Date();
    const newAuditHash = generateAuditHash(votingId, voterId, flatId, choice, now);

    const [updated] = await db
      .update(votes)
      .set({
        choice,
        auditHash: newAuditHash,
        ...(isPaperVote
          ? { recordedById: session.user.id, paperPhotoUrl: paperPhotoUrl || null }
          : {}),
      })
      .where(eq(votes.id, existing.id))
      .returning();

    if (!isPaperVote) {
      const [voter] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, voterId))
        .limit(1);
      const flatNumber = await loadFlatNumber(flatId);
      if (voter && flatNumber) {
        sendVoteConfirmation({
          recipientEmail: voter.email,
          voterName: voter.name,
          votingTitle: voting.title,
          flatNumber,
          choice,
          timestamp: now,
          auditHash: newAuditHash,
        }).catch(() => {});
      }
    }

    return NextResponse.json({ ...updated, auditHash: newAuditHash }, { status: 200 });
  }

  const now = new Date();
  const auditHash = generateAuditHash(votingId, voterId, flatId, choice, now);

  const requireEmail = process.env.REQUIRE_VOTE_EMAIL === "true";

  if (requireEmail && !isPaperVote) {
    try {
      const result = await db.transaction(async (tx) => {
        const [vote] = await tx
          .insert(votes)
          .values({
            votingId,
            ownerId: voterId,
            entityId: flatId,
            choice,
            voteType: "electronic",
            auditHash,
          })
          .returning();

        const [voter] = await tx
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, voterId))
          .limit(1);
        const [hud] = await tx
          .select({ flatNumber: housingUnitData.flatNumber })
          .from(housingUnitData)
          .where(eq(housingUnitData.entityId, flatId))
          .limit(1);

        const emailSent = await sendVoteConfirmation({
          recipientEmail: voter.email,
          voterName: voter.name,
          votingTitle: voting.title,
          flatNumber: hud?.flatNumber ?? "",
          choice,
          timestamp: now,
          auditHash,
        });
        if (!emailSent) throw new Error("Email confirmation failed");
        return vote;
      });

      dispatchHook("onVoteCreate", {
        id: result.id,
        votingId: result.votingId,
        memberId: result.ownerId,
        choice: result.choice,
        createdAt: result.createdAt,
      }).catch((err) => console.error("[modules] onVoteCreate failed:", err));

      return NextResponse.json(result, { status: 201 });
    } catch {
      return NextResponse.json(
        { error: "Nepodarilo sa odoslať potvrdzujúci email. Hlas nebol zaznamenaný." },
        { status: 500 }
      );
    }
  } else {
    const [vote] = await db
      .insert(votes)
      .values({
        votingId,
        ownerId: voterId,
        entityId: flatId,
        choice,
        voteType: isPaperVote ? "paper" : "electronic",
        recordedById: isPaperVote ? session.user.id : null,
        paperPhotoUrl: isPaperVote ? (paperPhotoUrl || null) : null,
        auditHash,
      })
      .returning();

    if (!isPaperVote) {
      const [voter] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, voterId))
        .limit(1);
      const flatNumber = await loadFlatNumber(flatId);
      if (voter && flatNumber) {
        sendVoteConfirmation({
          recipientEmail: voter.email,
          voterName: voter.name,
          votingTitle: voting.title,
          flatNumber,
          choice,
          timestamp: now,
          auditHash,
        }).catch(() => {});
      }
    }

    dispatchHook("onVoteCreate", {
      id: vote.id,
      votingId: vote.votingId,
      memberId: vote.ownerId,
      choice: vote.choice,
      createdAt: vote.createdAt,
    }).catch((err) => console.error("[modules] onVoteCreate failed:", err));

    return NextResponse.json({ ...vote, auditHash }, { status: 201 });
  }
}
