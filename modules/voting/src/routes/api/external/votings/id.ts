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

  const votesByItem = new Map<string, typeof itemVotes>();
  for (const iv of itemVotes) {
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
