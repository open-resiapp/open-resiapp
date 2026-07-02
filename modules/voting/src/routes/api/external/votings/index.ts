import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  votings,
  votingItems,
  ballots,
  ballotItemVotes,
} from "@modules/voting/src/db/schema";
import { eq, desc } from "drizzle-orm";
import { withExternalAuth } from "@/lib/external-auth";

type Counts = { za: number; proti: number; zdrzal_sa: number };
const zero = (): Counts => ({ za: 0, proti: 0, zdrzal_sa: 0 });

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
      createdById: votings.createdById,
      createdByName: users.name,
      createdAt: votings.createdAt,
    })
    .from(votings)
    .leftJoin(users, eq(votings.createdById, users.id))
    .orderBy(desc(votings.createdAt));

  // BYT-20260609-008: items (resolutions) + per-item counts from ballots.
  const allItems = await db
    .select({
      id: votingItems.id,
      votingId: votingItems.votingId,
      idx: votingItems.idx,
      title: votingItems.title,
      quorumType: votingItems.quorumType,
    })
    .from(votingItems)
    .orderBy(votingItems.idx);

  const itemVotes = await db
    .select({
      itemId: ballotItemVotes.itemId,
      choice: ballotItemVotes.choice,
    })
    .from(ballotItemVotes)
    .innerJoin(ballots, eq(ballots.id, ballotItemVotes.ballotId));

  const countsByItem = new Map<string, Counts>();
  for (const iv of itemVotes) {
    const c = countsByItem.get(iv.itemId) ?? zero();
    c[iv.choice as keyof Counts]++;
    countsByItem.set(iv.itemId, c);
  }

  const itemsByVoting = new Map<
    string,
    { id: string; idx: number; title: string; quorumType: string; voteCounts: Counts }[]
  >();
  for (const it of allItems) {
    const slot = itemsByVoting.get(it.votingId) ?? [];
    slot.push({
      id: it.id,
      idx: it.idx,
      title: it.title,
      quorumType: it.quorumType,
      voteCounts: countsByItem.get(it.id) ?? zero(),
    });
    itemsByVoting.set(it.votingId, slot);
  }

  // Backward-compatible response: top-level `quorumType` + `voteCounts`
  // mirror the FIRST item (identical to the legacy single-question shape for
  // pre-existing single-item votings); `items[]` carries the full per-item
  // detail for multi-item votings.
  const result = allVotings.map((v) => {
    const items = itemsByVoting.get(v.id) ?? [];
    const first = items[0];
    return {
      ...v,
      quorumType: first?.quorumType ?? "simple_all",
      voteCounts: first?.voteCounts ?? zero(),
      items,
    };
  });

  return NextResponse.json(result);
}

export const GET = withExternalAuth(handler, "read");
