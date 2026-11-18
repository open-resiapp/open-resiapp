import "server-only";
// Server-side quorum guard for voting create / edit (BYT-20261117-002).
// The new-voting form only offers getAvailableQuorumTypes(country, type),
// but the API must not trust the client: an item whose quorum type is not
// allowed for the community's country and the voting type is rejected with
// the code QUORUM_NOT_ALLOWED. Read-only; no engine change.
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { votings, votingItems } from "@modules/voting/src/db/schema";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { getAvailableQuorumTypes } from "@modules/voting/src/rules";
import { normalizeItems } from "@modules/voting/src/items";
import type { Country, QuorumType } from "@/types";

export interface QuorumNotAllowed {
  error: "QUORUM_NOT_ALLOWED";
  /** 0-based index of the first offending item */
  itemIdx: number;
  quorumType: QuorumType;
  allowed: QuorumType[];
}

/** First item whose quorum type is not allowed, or null. Pure. */
export function findDisallowedQuorum(
  items: { idx: number; quorumType: QuorumType; repeatOfQuorumType?: QuorumType | null }[],
  country: Country,
  votingType: string
): QuorumNotAllowed | null {
  const allowed = getAvailableQuorumTypes(country, votingType);
  // A §14b ods. 6 repeat is checked on its BASE category; the escalated type
  // (e.g. four_fifths_all) is derived, never chosen directly.
  const bad = items.find((i) => !allowed.includes(i.repeatOfQuorumType ?? i.quorumType));
  return bad
    ? { error: "QUORUM_NOT_ALLOWED", itemIdx: bad.idx, quorumType: bad.quorumType, allowed }
    : null;
}

/**
 * PATCH /api/votings/[id]: validate the items that will exist after the
 * edit (the new `items[]`, or the stored ones when only `votingType`
 * changes) against the effective voting type. Returns null when the body
 * touches neither, or when the voting does not exist (the route answers 404).
 */
export async function checkQuorumForVotingPatch(
  votingId: string,
  body: { items?: unknown; quorumType?: unknown; votingType?: unknown }
): Promise<QuorumNotAllowed | null> {
  const itemsChange = Array.isArray(body.items);
  if (!itemsChange && body.votingType === undefined) return null;

  const [voting] = await db
    .select({ votingType: votings.votingType })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!voting) return null;
  const votingType =
    typeof body.votingType === "string" && body.votingType ? body.votingType : voting.votingType;

  let items: { idx: number; quorumType: QuorumType; repeatOfQuorumType?: QuorumType | null }[];
  if (itemsChange) {
    const normalized = normalizeItems(body, "", null);
    if ("error" in normalized) return null; // the route reports the item error itself
    items = normalized.items;
  } else {
    items = (
      await db
        .select({
          idx: votingItems.idx,
          quorumType: votingItems.quorumType,
          repeatOfQuorumType: votingItems.repeatOfQuorumType,
        })
        .from(votingItems)
        .where(eq(votingItems.votingId, votingId))
    ).map((i) => ({
      idx: i.idx,
      quorumType: i.quorumType as QuorumType,
      repeatOfQuorumType: (i.repeatOfQuorumType as QuorumType | null) ?? null,
    }));
  }

  const root = await getCommunityRoot();
  const country = (root?.country ?? "sk") as Country;
  return findDisallowedQuorum(items, country, votingType);
}
