import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { votes, votings, users, flats, building, userFlats } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { generateAuditHash, calculateResults } from "@/lib/voting";
import { sendVoteConfirmation } from "@/lib/email";
import { isElectronicVotingBlocked } from "@/lib/voting-rules";
import type { UserRole, VoteChoice, VotingMethod, VoteWithShare, QuorumType, Country } from "@/types";

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

  // Fetch building voting method and country
  const [bld] = await db.select().from(building).limit(1);
  const votingMethod = (bld?.votingMethod ?? "per_share") as VotingMethod;
  const country = (bld?.country ?? "sk") as Country;

  // Fetch voting details for quorum type and entrance scope
  const [voting] = await db
    .select({
      quorumType: votings.quorumType,
      entranceId: votings.entranceId,
    })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);

  const quorumType = (voting?.quorumType ?? "simple_all") as QuorumType;

  // Get votes joined with flat data directly (per-flat voting)
  const voteRows = await db
    .select({
      id: votes.id,
      choice: votes.choice,
      voteType: votes.voteType,
      createdAt: votes.createdAt,
      ownerId: votes.ownerId,
      flatId: votes.flatId,
      disputed: votes.disputed,
      auditHash: votes.auditHash,
      paperPhotoUrl: votes.paperPhotoUrl,
      ownerName: users.name,
      flatNumber: flats.flatNumber,
      shareNumerator: flats.shareNumerator,
      shareDenominator: flats.shareDenominator,
      area: flats.area,
    })
    .from(votes)
    .leftJoin(users, eq(votes.ownerId, users.id))
    .innerJoin(flats, eq(votes.flatId, flats.id))
    .where(eq(votes.votingId, votingId));

  // Build VoteWithShare array — 1:1 with flat
  const votesWithShare: VoteWithShare[] = voteRows.map((v) => ({
    choice: v.choice as VoteChoice,
    shareNumerator: v.shareNumerator,
    shareDenominator: v.shareDenominator,
    area: v.area,
  }));

  // Calculate total possible weight — scoped to entrance if voting is entrance-scoped
  const allFlatsQuery = db
    .select({
      shareNumerator: flats.shareNumerator,
      shareDenominator: flats.shareDenominator,
      area: flats.area,
    })
    .from(flats);

  const allFlats = voting.entranceId
    ? await allFlatsQuery.where(eq(flats.entranceId, voting.entranceId))
    : await allFlatsQuery;

  let totalPossibleWeight = 0;
  for (const f of allFlats) {
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

  const results = calculateResults(votesWithShare, votingMethod, quorumType, totalPossibleWeight, { country });

  // Find which flats the current user has voted for in this voting
  const userVotedFlats = voteRows
    .filter((v) => v.ownerId === session.user.id)
    .map((v) => ({ flatId: v.flatId, choice: v.choice }));

  // Get all flats the current user owns (for flat selector UI)
  const currentUserFlats = await db
    .select({
      flatId: userFlats.flatId,
      flatNumber: flats.flatNumber,
    })
    .from(userFlats)
    .innerJoin(flats, eq(userFlats.flatId, flats.id))
    .where(eq(userFlats.userId, session.user.id));

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

  // Check voting is active and get type info
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

  // Fetch building country for voting rules
  const [voteBld] = await db.select({ country: building.country }).from(building).limit(1);
  const voteCountry = (voteBld?.country ?? "sk") as Country;

  // Block electronic votes based on country-specific rules
  if (!isPaperVote && isElectronicVotingBlocked(voteCountry, voting.votingType, voting.initiatedBy)) {
    return NextResponse.json(
      { error: voting.votingType === "meeting"
          ? "Elektronické hlasovanie nie je povolené pre hlasovanie na schôdzi"
          : "Elektronické hlasovanie nie je povolené pre hlasovanie iniciované štvrtinou vlastníkov"
      },
      { status: 400 }
    );
  }

  // Validate voter owns the flat
  const [ownerFlat] = await db
    .select()
    .from(userFlats)
    .where(
      and(
        eq(userFlats.userId, voterId),
        eq(userFlats.flatId, flatId)
      )
    )
    .limit(1);

  if (!ownerFlat) {
    return NextResponse.json(
      { error: "Vlastník nevlastní tento byt" },
      { status: 400 }
    );
  }

  // Validate flat belongs to the voting's entrance (if entrance-scoped)
  if (voting.entranceId) {
    const [flat] = await db
      .select({ entranceId: flats.entranceId })
      .from(flats)
      .where(eq(flats.id, flatId))
      .limit(1);

    if (flat?.entranceId !== voting.entranceId) {
      return NextResponse.json(
        { error: "Tento byt nie je v hlasovanom vchode" },
        { status: 403 }
      );
    }
  }

  // Check if flat already has a vote in this voting
  const existingVote = await db
    .select()
    .from(votes)
    .where(and(eq(votes.votingId, votingId), eq(votes.flatId, flatId)))
    .limit(1);

  if (existingVote.length > 0) {
    const existing = existingVote[0];

    // For electronic votes, only the original voter can change their vote
    if (!isPaperVote && existing.ownerId !== voterId) {
      return NextResponse.json(
        { error: "Za tento byt už hlasoval iný vlastník" },
        { status: 400 }
      );
    }

    // Same choice — no change needed
    if (existing.choice === choice) {
      return NextResponse.json({ ...existing, auditHash: existing.auditHash }, { status: 200 });
    }

    // Update the vote with the new choice
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

    // Fire-and-forget email for electronic vote changes
    if (!isPaperVote) {
      const [voter] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, voterId))
        .limit(1);

      const [flat] = await db
        .select({ flatNumber: flats.flatNumber })
        .from(flats)
        .where(eq(flats.id, flatId))
        .limit(1);

      if (voter && flat) {
        sendVoteConfirmation({
          recipientEmail: voter.email,
          voterName: voter.name,
          votingTitle: voting.title,
          flatNumber: flat.flatNumber,
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
    // Transaction mode: insert vote, send email, commit or rollback
    try {
      const result = await db.transaction(async (tx) => {
        const [vote] = await tx
          .insert(votes)
          .values({
            votingId,
            ownerId: voterId,
            flatId,
            choice,
            voteType: "electronic",
            auditHash,
          })
          .returning();

        // Get voter email and flat number
        const [voter] = await tx
          .select({ email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, voterId))
          .limit(1);

        const [flat] = await tx
          .select({ flatNumber: flats.flatNumber })
          .from(flats)
          .where(eq(flats.id, flatId))
          .limit(1);

        const emailSent = await sendVoteConfirmation({
          recipientEmail: voter.email,
          voterName: voter.name,
          votingTitle: voting.title,
          flatNumber: flat.flatNumber,
          choice,
          timestamp: now,
          auditHash,
        });

        if (!emailSent) {
          throw new Error("Email confirmation failed");
        }

        return vote;
      });

      return NextResponse.json(result, { status: 201 });
    } catch {
      return NextResponse.json(
        { error: "Nepodarilo sa odoslať potvrdzujúci email. Hlas nebol zaznamenaný." },
        { status: 500 }
      );
    }
  } else {
    // Best-effort mode: insert vote, fire-and-forget email
    const [vote] = await db
      .insert(votes)
      .values({
        votingId,
        ownerId: voterId,
        flatId,
        choice,
        voteType: isPaperVote ? "paper" : "electronic",
        recordedById: isPaperVote ? session.user.id : null,
        paperPhotoUrl: isPaperVote ? (paperPhotoUrl || null) : null,
        auditHash,
      })
      .returning();

    // Fire-and-forget email for electronic votes
    if (!isPaperVote) {
      const [voter] = await db
        .select({ email: users.email, name: users.name })
        .from(users)
        .where(eq(users.id, voterId))
        .limit(1);

      const [flat] = await db
        .select({ flatNumber: flats.flatNumber })
        .from(flats)
        .where(eq(flats.id, flatId))
        .limit(1);

      if (voter && flat) {
        sendVoteConfirmation({
          recipientEmail: voter.email,
          voterName: voter.name,
          votingTitle: voting.title,
          flatNumber: flat.flatNumber,
          choice,
          timestamp: now,
          auditHash,
        }).catch(() => {
          // Silently ignore email failures in best-effort mode
        });
      }
    }

    return NextResponse.json({ ...vote, auditHash }, { status: 201 });
  }
}
