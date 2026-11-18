import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { votingItems } from "@modules/voting/src/db/schema";
import { requireReader } from "@modules/accounting/src/lib/api-guard";
import { getVotingImpacts } from "@modules/accounting/src/lib/voting-pipeline";
import { getItemPassedMap } from "@modules/voting/src/results";

// Financial impacts of a voting (AC 515) — the fee-schedule drafts, expense
// authorisations and posted journal entries the voting spawned. Read access:
// treasurer / chairman / admin. Consumed by the voting detail page.

export async function handleVotingImpacts(
  req: NextRequest
): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;

  const votingId = new URL(req.url).searchParams.get("votingId");
  if (!votingId) {
    return NextResponse.json({ error: "votingId required" }, { status: 400 });
  }

  const items = await db
    .select({ id: votingItems.id, title: votingItems.title })
    .from(votingItems)
    .where(eq(votingItems.votingId, votingId));
  const titleById = new Map(items.map((i) => [i.id, i.title]));

  const impacts = await getVotingImpacts(
    ctx.root.id,
    items.map((i) => i.id)
  );
  // Only items that actually produced an accounting artifact are interesting.
  const relevant = impacts.filter(
    (i) =>
      i.feeScheduleDraft || i.expenseAuthorisation || i.journalEntryCount > 0
  );
  // Voting spec §6: an artifact exists only for an item that PASSED at some
  // close; if the current (re-closed) result no longer passes it, flag the
  // row — nothing is deleted or reversed automatically. One tally, only when
  // there is something to flag.
  const passed = relevant.length > 0 ? await getItemPassedMap(votingId) : null;
  const out = relevant.map((i) => ({
    ...i,
    title: titleById.get(i.votingItemId) ?? "",
    notPassedAnymore: passed ? passed.get(i.votingItemId) === false : false,
  }));
  return NextResponse.json({ impacts: out });
}
