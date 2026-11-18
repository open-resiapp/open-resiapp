import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { users, entities } from "@/db/schema";
import {
  votings,
  votingItems,
  ballots,
  ballotItemVotes,
} from "@modules/voting/src/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { apiKeyCanSeeDraftVotings } from "@modules/voting/src/votings";
import type { ValidatedApiKey } from "@/lib/api-keys";

async function handler(
  _request: NextRequest,
  apiKey: ValidatedApiKey,
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
      createdById: votings.createdById,
      createdByName: users.name,
      createdAt: votings.createdAt,
    })
    .from(votings)
    .leftJoin(users, eq(votings.createdById, users.id))
    .where(eq(votings.id, id))
    .limit(1);

  // A draft is invisible (404, same as missing) unless the key is `full`.
  if (!voting || (voting.status === "draft" && !apiKeyCanSeeDraftVotings(apiKey.permissions))) {
    return NextResponse.json({ error: "Voting not found" }, { status: 404 });
  }

  // BYT-20260609-008: items (resolutions) + per-item item-votes from ballots.
  const items = await db
    .select({
      id: votingItems.id,
      idx: votingItems.idx,
      title: votingItems.title,
      description: votingItems.description,
      quorumType: votingItems.quorumType,
    })
    .from(votingItems)
    .where(eq(votingItems.votingId, id))
    .orderBy(votingItems.idx);

  const itemVotes = await db
    .select({
      id: ballotItemVotes.id,
      itemId: ballotItemVotes.itemId,
      choice: ballotItemVotes.choice,
      voteType: ballots.voteType,
      flatId: ballots.entityId,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      ownerId: ballots.ownerId,
      ownerName: users.name,
      createdAt: ballots.recordedAt,
    })
    .from(ballotItemVotes)
    .innerJoin(ballots, eq(ballots.id, ballotItemVotes.ballotId))
    .leftJoin(entities, eq(entities.id, ballots.entityId))
    .leftJoin(users, eq(ballots.ownerId, users.id))
    .where(eq(ballots.votingId, id));

  // A `read` key gets per-flat choices only (as printed in the minutes);
  // owner identity (id, name) is personal data reserved for `full` keys.
  const fullKey = apiKeyCanSeeDraftVotings(apiKey.permissions);
  const visibleVotes = fullKey
    ? itemVotes
    : itemVotes.map((iv) => ({ ...iv, ownerId: null, ownerName: null }));

  const votesByItem = new Map<string, typeof visibleVotes>();
  for (const iv of visibleVotes) {
    const slot = votesByItem.get(iv.itemId) ?? [];
    slot.push(iv);
    votesByItem.set(iv.itemId, slot);
  }

  const itemsWithVotes = items.map((it) => ({
    ...it,
    votes: votesByItem.get(it.id) ?? [],
  }));

  // Backward-compatible: top-level `quorumType` + `votes` mirror the FIRST
  // item (identical to the legacy single-question shape for single-item
  // votings); `items[]` carries the full per-item detail.
  return NextResponse.json({
    ...voting,
    quorumType: items[0]?.quorumType ?? "simple_all",
    votes: itemsWithVotes[0]?.votes ?? [],
    items: itemsWithVotes,
  });
}

export const GET = withExternalAuth(handler, "read");
