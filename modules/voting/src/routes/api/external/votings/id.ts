import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { users, entities } from "@/db/schema";
import { votings, votes } from "@modules/voting/src/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import type { ValidatedApiKey } from "@/lib/api-keys";

async function handler(
  _request: NextRequest,
  _apiKey: ValidatedApiKey,
  context?: { params: Promise<Record<string, string>> }
) {
  const { id } = await context!.params;

  const [voting] = await db
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
    .where(eq(votings.id, id))
    .limit(1);

  if (!voting) {
    return NextResponse.json({ error: "Voting not found" }, { status: 404 });
  }

  // Phase 2b: flatNumber comes from entities.data jsonb on the unit
  // entity referenced by votes.entityId.
  const votesData = await db
    .select({
      id: votes.id,
      choice: votes.choice,
      voteType: votes.voteType,
      flatId: votes.entityId,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      ownerId: votes.ownerId,
      ownerName: users.name,
      createdAt: votes.createdAt,
    })
    .from(votes)
    .leftJoin(entities, eq(entities.id, votes.entityId))
    .leftJoin(users, eq(votes.ownerId, users.id))
    .where(eq(votes.votingId, id));

  return NextResponse.json({
    ...voting,
    votes: votesData,
  });
}

export const GET = withExternalAuth(handler, "read");
