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

export type FinancialEffectKind = "fpuo_rate_change" | "expense_approval";
export const VALID_FINANCIAL_EFFECT: FinancialEffectKind[] = [
  "fpuo_rate_change",
  "expense_approval",
];

export interface IncomingItem {
  title?: unknown;
  description?: unknown;
  quorumType?: unknown;
  financialEffectKind?: unknown;
  financialEffectParams?: unknown;
}

export interface NormalizedItem {
  idx: number;
  title: string;
  description: string | null;
  quorumType: QuorumType;
  financialEffectKind: FinancialEffectKind | null;
  financialEffectParams: Record<string, unknown> | null;
}

/** Validate the params blob for a financial-effect kind; null on invalid. */
function normalizeFinancialEffect(
  kind: unknown,
  params: unknown
): { kind: FinancialEffectKind; params: Record<string, unknown> } | null | "invalid" {
  if (kind === undefined || kind === null || kind === "") return null;
  if (!VALID_FINANCIAL_EFFECT.includes(kind as FinancialEffectKind)) {
    return "invalid";
  }
  const p =
    params && typeof params === "object" ? (params as Record<string, unknown>) : {};
  const posInt = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) && v > 0;
  if (kind === "fpuo_rate_change" && !posInt(p.newRateCents)) return "invalid";
  if (kind === "expense_approval" && !posInt(p.amountCents)) return "invalid";
  return { kind: kind as FinancialEffectKind, params: p };
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
    const fx = normalizeFinancialEffect(
      it.financialEffectKind,
      it.financialEffectParams
    );
    if (fx === "invalid") {
      return { error: `Položka č. ${idx + 1}: neplatný finančný dopad` };
    }
    items.push({
      idx,
      title,
      description,
      quorumType,
      financialEffectKind: fx?.kind ?? null,
      financialEffectParams: fx?.params ?? null,
    });
  }
  return { items };
}
