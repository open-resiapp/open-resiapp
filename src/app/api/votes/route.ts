import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { votes, votings, users, flats, building, userFlats } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { generateAuditHash, calculateResults, aggregateFlatsForVoter } from "@/lib/voting";
import type { UserRole, VoteChoice, VotingMethod, VoteWithShare } from "@/types";

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

  // Fetch building voting method
  const [bld] = await db.select().from(building).limit(1);
  const votingMethod = (bld?.votingMethod ?? "per_share") as VotingMethod;

  // Get votes with owner info (no flat join)
  const voteRows = await db
    .select({
      id: votes.id,
      choice: votes.choice,
      voteType: votes.voteType,
      createdAt: votes.createdAt,
      ownerId: votes.ownerId,
      disputed: votes.disputed,
      ownerName: users.name,
    })
    .from(votes)
    .leftJoin(users, eq(votes.ownerId, users.id))
    .where(eq(votes.votingId, votingId));

  // Check if current user has voted
  const userVote = voteRows.find((v) => v.ownerId === session.user.id);

  // Get all flats for all voters via userFlats
  const voterIds = [...new Set(voteRows.map((v) => v.ownerId))];

  let votesWithShare: VoteWithShare[] = [];

  if (voterIds.length > 0) {
    const voterFlatRows = await db
      .select({
        userId: userFlats.userId,
        shareNumerator: flats.shareNumerator,
        shareDenominator: flats.shareDenominator,
        area: flats.area,
      })
      .from(userFlats)
      .innerJoin(flats, eq(userFlats.flatId, flats.id))
      .where(inArray(userFlats.userId, voterIds));

    // Group by userId
    const voterFlatsMap = new Map<
      string,
      { shareNumerator: number; shareDenominator: number; area: number | null }[]
    >();
    for (const row of voterFlatRows) {
      const list = voterFlatsMap.get(row.userId) || [];
      list.push({
        shareNumerator: row.shareNumerator,
        shareDenominator: row.shareDenominator,
        area: row.area,
      });
      voterFlatsMap.set(row.userId, list);
    }

    // Aggregate per voter
    votesWithShare = voteRows
      .filter((v) => voterFlatsMap.has(v.ownerId))
      .map((v) =>
        aggregateFlatsForVoter(
          v.choice as VoteChoice,
          voterFlatsMap.get(v.ownerId)!
        )
      );
  }

  const results = calculateResults(votesWithShare, votingMethod);

  return NextResponse.json({
    votes: voteRows,
    results,
    userVote: userVote
      ? { id: userVote.id, choice: userVote.choice }
      : null,
    totalVotes: voteRows.length,
  });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const body = await request.json();
  const { votingId, choice, ownerId, voteType } = body;

  if (!votingId || !choice) {
    return NextResponse.json(
      { error: "votingId a choice sú povinné" },
      { status: 400 }
    );
  }

  // Determine if this is a paper vote or electronic
  const isPaperVote = voteType === "paper";
  const voterId = isPaperVote ? ownerId : session.user.id;

  if (isPaperVote) {
    if (!hasPermission(session.user.role as UserRole, "recordPaperVote")) {
      return NextResponse.json({ error: "Nemáte oprávnenie zapisovať listinné hlasy" }, { status: 403 });
    }
  } else {
    if (!hasPermission(session.user.role as UserRole, "vote")) {
      return NextResponse.json({ error: "Nemáte oprávnenie hlasovať" }, { status: 403 });
    }
  }

  // Check voting is active
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

  // Check if already voted
  const existingVote = await db
    .select()
    .from(votes)
    .where(and(eq(votes.votingId, votingId), eq(votes.ownerId, voterId)))
    .limit(1);

  if (existingVote.length > 0) {
    return NextResponse.json(
      { error: "Tento vlastník už hlasoval" },
      { status: 400 }
    );
  }

  const now = new Date();
  const auditHash = generateAuditHash(votingId, voterId, choice, now);

  const [vote] = await db
    .insert(votes)
    .values({
      votingId,
      ownerId: voterId,
      choice,
      voteType: isPaperVote ? "paper" : "electronic",
      recordedById: isPaperVote ? session.user.id : null,
      auditHash,
    })
    .returning();

  return NextResponse.json(vote, { status: 201 });
}
