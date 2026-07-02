// BYT-20260609-008: shared ballot-item helpers used by the voting create
// (POST /api/votings) and edit (PATCH /api/votings/[id]) route handlers.
// Kept out of the route files so those export only HTTP handlers.
import type { QuorumType } from "@/types";

export const VALID_QUORUM: QuorumType[] = [
  "simple_present",
  "simple_all",
  "two_thirds_all",
  "all_unanimous",
];

export interface IncomingItem {
  title?: unknown;
  description?: unknown;
  quorumType?: unknown;
}

export interface NormalizedItem {
  idx: number;
  title: string;
  description: string | null;
  quorumType: QuorumType;
}

/**
 * Normalise the ballot items for a voting. New clients send `items[]`;
 * legacy clients send a single top-level `quorumType`, for which we
 * synthesize ONE item mirroring the voting (idx 0, voting title/description,
 * the voting's quorumType) — identical to the 0046 backfill so every voting
 * always carries ≥1 item. Returns an error string if any item is invalid,
 * else the ordered normalized list.
 */
export function normalizeItems(
  body: { items?: unknown; quorumType?: unknown },
  votingTitle: string,
  votingDescription: string | null
): { items: NormalizedItem[] } | { error: string } {
  const raw: IncomingItem[] = Array.isArray(body.items)
    ? (body.items as IncomingItem[])
    : [
        {
          title: votingTitle,
          description: votingDescription,
          quorumType: body.quorumType,
        },
      ];

  if (raw.length === 0) {
    return { error: "Hlasovanie musí mať aspoň jednu položku" };
  }

  const items: NormalizedItem[] = [];
  for (let idx = 0; idx < raw.length; idx++) {
    const it = raw[idx];
    const title = typeof it.title === "string" ? it.title.trim() : "";
    if (!title) {
      return { error: `Položka č. ${idx + 1}: názov je povinný` };
    }
    const quorumType = VALID_QUORUM.includes(it.quorumType as QuorumType)
      ? (it.quorumType as QuorumType)
      : "simple_all";
    const description =
      typeof it.description === "string" && it.description.trim()
        ? it.description
        : null;
    items.push({ idx, title, description, quorumType });
  }
  return { items };
}
