import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { votings, votes } from "@modules/voting/src/db/schema";
import { eq, desc } from "drizzle-orm";
import { withExternalAuth } from "@/lib/external-auth";

async function handler(_request: NextRequest) {
  const allVotings = await db
    .select({
      id: votings.id,
      title: votings.title,
      description: votings.description,
      status: votings.status,
      startsAt: votings.startsAt,
      endsAt: votings.endsAt,
      votingType: votings.votingType,
      initiatedBy: votings.initiatedBy,
      quorumType: votings.quorumType,
      createdById: votings.createdById,
      createdByName: users.name,
      createdAt: votings.createdAt,
    })
    .from(votings)
    .leftJoin(users, eq(votings.createdById, users.id))
    .orderBy(desc(votings.createdAt));

  // Get vote counts per voting
  const voteCounts = await db
    .select({
      votingId: votes.votingId,
      choice: votes.choice,
    })
    .from(votes);

  const countsByVoting = new Map<string, { za: number; proti: number; zdrzal_sa: number }>();
  for (const v of voteCounts) {
    const counts = countsByVoting.get(v.votingId) || { za: 0, proti: 0, zdrzal_sa: 0 };
    counts[v.choice as keyof typeof counts]++;
    countsByVoting.set(v.votingId, counts);
  }

  const result = allVotings.map((v) => ({
    ...v,
    voteCounts: countsByVoting.get(v.id) || { za: 0, proti: 0, zdrzal_sa: 0 },
  }));

  return NextResponse.json(result);
}

export const GET = withExternalAuth(handler, "read");
