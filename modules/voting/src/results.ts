import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";
import { votings, votingItems, ballots, ballotItemVotes } from "./db/schema";
import { calculateItemResults } from "./engine";
import {
  computeMemberWeight,
  computeUnitWeight,
  isUnitScoped,
  normalizeVotingMethod,
} from "@/lib/voting-method";
import { getCommunityRoot } from "@/lib/legacy-compat";
import type {
  VoteChoice,
  VoteWithOwnership,
  Country,
  QuorumType,
} from "@/types";

// Approved-financial-effects loader for the voting→accounting pipeline
// (BYT-20260512-002 §Voting integration). Returns the passed items of a
// voting that carry a financial effect, so the accounting module can turn
// each into a treasurer-reviewable draft on close.
//
// NOTE: the results computation below MIRRORS the ballots GET handler
// (routes/api/ballots/index.ts). It is duplicated deliberately for now to
// avoid refactoring the legal results path while it can't be re-verified;
// factor both onto one shared helper once they can.

export interface ApprovedFinancialEffect {
  votingId: string;
  votingItemId: string;
  title: string;
  kind: "fpuo_rate_change" | "expense_approval";
  params: Record<string, unknown>;
}

export async function getApprovedFinancialEffects(
  votingId: string
): Promise<ApprovedFinancialEffect[]> {
  const root = await getCommunityRoot();
  const votingMethod = normalizeVotingMethod(root?.votingMethod);
  const country = (root?.country ?? "sk") as Country;

  const [voting] = await db
    .select({ entityId: votings.entityId })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!voting) return [];

  const items = await db
    .select({
      id: votingItems.id,
      quorumType: votingItems.quorumType,
      title: votingItems.title,
      financialEffectKind: votingItems.financialEffectKind,
      financialEffectParams: votingItems.financialEffectParams,
    })
    .from(votingItems)
    .where(eq(votingItems.votingId, votingId));

  // Nothing to do unless at least one item declares a financial effect.
  const financialItems = items.filter((i) => i.financialEffectKind);
  if (financialItems.length === 0) return [];

  const itemVoteRows = await db
    .select({
      itemId: ballotItemVotes.itemId,
      choice: ballotItemVotes.choice,
      ownerId: ballots.ownerId,
      unitEntityId: ballots.entityId,
      ownerName: users.name,
      shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
      area: sql<number | null>`(${entities.data}->>'area_m2')::int`,
      ownerUnitShareNumerator: memberships.ownerUnitShareNumerator,
      ownerUnitShareDenominator: memberships.ownerUnitShareDenominator,
      membershipWeight: memberships.weight,
    })
    .from(ballotItemVotes)
    .innerJoin(ballots, eq(ballots.id, ballotItemVotes.ballotId))
    .leftJoin(users, eq(ballots.ownerId, users.id))
    .innerJoin(entities, eq(entities.id, ballots.entityId))
    .leftJoin(
      memberships,
      and(
        eq(memberships.entityId, ballots.entityId),
        eq(memberships.userId, ballots.ownerId),
        eq(memberships.status, "active")
      )
    )
    .where(eq(ballots.votingId, votingId));

  const votesByItem = new Map<string, VoteWithOwnership[]>();
  for (const r of itemVoteRows) {
    const vow: VoteWithOwnership = {
      unitEntityId: r.unitEntityId,
      userId: r.ownerId,
      userName: r.ownerName,
      choice: r.choice as VoteChoice,
      unitShareNumerator: r.shareNumerator,
      unitShareDenominator: r.shareDenominator,
      area: r.area,
      ownerUnitShareNumerator: r.ownerUnitShareNumerator ?? 1,
      ownerUnitShareDenominator: r.ownerUnitShareDenominator ?? 1,
      membershipWeight: r.membershipWeight ?? 1,
    };
    const slot = votesByItem.get(r.itemId) ?? [];
    slot.push(vow);
    votesByItem.set(r.itemId, slot);
  }

  let totalPossibleWeight = 0;
  if (isUnitScoped(votingMethod)) {
    const flatsForScope = await db
      .select({
        shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
        shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
        area: sql<number | null>`(${entities.data}->>'area_m2')::int`,
      })
      .from(entities)
      .where(
        and(
          eq(entities.kind, "unit"),
          isNull(entities.archivedAt),
          voting.entityId
            ? sql`${entities.path} LIKE (SELECT path || '%' FROM ${entities} WHERE id = ${voting.entityId})`
            : sql`true`
        )
      );
    for (const f of flatsForScope) {
      totalPossibleWeight += computeUnitWeight(
        {
          shareNumerator: f.shareNumerator,
          shareDenominator: f.shareDenominator,
          area: f.area,
        },
        votingMethod
      );
    }
  } else {
    const scopeMembers = await db
      .select({ weight: memberships.weight })
      .from(memberships)
      .innerJoin(entities, eq(entities.id, memberships.entityId))
      .where(
        and(
          eq(memberships.status, "active"),
          isNull(entities.archivedAt),
          voting.entityId
            ? sql`${entities.path} LIKE (SELECT path || '%' FROM ${entities} WHERE id = ${voting.entityId})`
            : sql`true`
        )
      );
    for (const m of scopeMembers) {
      totalPossibleWeight += computeMemberWeight(
        { membershipWeight: m.weight },
        votingMethod
      );
    }
  }

  const results = calculateItemResults(
    items.map((i) => ({ id: i.id, quorumType: i.quorumType as QuorumType })),
    votesByItem,
    votingMethod,
    totalPossibleWeight,
    { country }
  );
  const passedById = new Map(results.map((r) => [r.itemId, r.passed]));

  const effects: ApprovedFinancialEffect[] = [];
  for (const item of financialItems) {
    if (!passedById.get(item.id)) continue;
    effects.push({
      votingId,
      votingItemId: item.id,
      title: item.title,
      kind: item.financialEffectKind as ApprovedFinancialEffect["kind"],
      params:
        (item.financialEffectParams as Record<string, unknown> | null) ?? {},
    });
  }
  return effects;
}
