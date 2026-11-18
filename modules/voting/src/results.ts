import "server-only";

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";
import { votings, votingItems, ballots, ballotItemVotes, attendance } from "./db/schema";
import { calculateItemResults, computePresence, type PresenceRow } from "./engine";
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
  VotingItemResult,
  Country,
  QuorumType,
} from "@/types";

// Voting results (BYT-20261117-001 §3): ONE implementation of the per-item
// tally, shared by GET /api/ballots (UI results panel), the voting→accounting
// pipeline (`getApprovedFinancialEffects`) and the MCP `get_voting_results`
// tool. Previously duplicated here and in routes/api/ballots/index.ts.
//
// NOTE: `results[].unitBreakdowns` / `memberBreakdowns` may carry voter
// names (VoteWithOwnership.userName). MCP callers MUST strip them — the tool
// contract is per-item tallies only.

export interface VotingResultsItem {
  id: string;
  idx: number;
  title: string;
  description: string | null;
  quorumType: string;
  /** SK §14b ods. 6 repeat: category of the original decision (null = not a repeat). */
  repeatOfQuorumType: string | null;
  financialEffectKind: string | null;
  financialEffectParams: unknown;
}

export interface VotingResultsBundle {
  votingId: string;
  /** The voting's scope entity (null = community-wide). */
  entityId: string | null;
  items: VotingResultsItem[];
  results: VotingItemResult[];
  totalPossibleWeight: number;
}

/**
 * Per-item results for a voting, or null when the voting doesn't exist.
 * No authz — callers gate it (`viewVotingResults` in the route / tool).
 */
export async function getVotingResults(
  votingId: string
): Promise<VotingResultsBundle | null> {
  const root = await getCommunityRoot();
  const votingMethod = normalizeVotingMethod(root?.votingMethod);
  const country = (root?.country ?? "sk") as Country;

  const [voting] = await db
    .select({
      entityId: votings.entityId,
      status: votings.status,
      endsAt: votings.endsAt,
      votingType: votings.votingType,
    })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!voting) return null;

  // BYT-20261118-007: ownership AS OF the voting — a closed voting reads the
  // memberships valid on its end date, so a later sale / removal / new
  // member never moves its result. Open votings read today.
  const asOf =
    voting.status === "closed"
      ? sql`(${voting.endsAt.toISOString()}::timestamptz)::date`
      : sql`CURRENT_DATE`;
  const membershipAsOf = sql`(${memberships.validFrom} <= ${asOf} AND (${memberships.validTo} IS NULL OR ${memberships.validTo} > ${asOf}))`;

  // Ordered ballot items (each with its own quorumType).
  const items = await db
    .select({
      id: votingItems.id,
      idx: votingItems.idx,
      title: votingItems.title,
      description: votingItems.description,
      quorumType: votingItems.quorumType,
      repeatOfQuorumType: votingItems.repeatOfQuorumType,
      financialEffectKind: votingItems.financialEffectKind,
      financialEffectParams: votingItems.financialEffectParams,
    })
    .from(votingItems)
    .where(eq(votingItems.votingId, votingId))
    .orderBy(votingItems.idx);

  // Every item-vote in this voting, with full ownership context so the
  // engine can group by unit and resolve §14 ods. 4 per item.
  const itemVoteRows = await db
    .select({
      itemId: ballotItemVotes.itemId,
      choice: ballotItemVotes.choice,
      ownerId: ballots.ownerId,
      unitEntityId: ballots.entityId,
      ownerName: users.name,
      shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
      area: sql<number | null>`(${entities.data}->>'area_m2')::float8`,
      // Frozen at cast time (legal fix 2026-11-18) — authoritative when set.
      frozenShareNumerator: ballots.ownerUnitShareNumerator,
      frozenShareDenominator: ballots.ownerUnitShareDenominator,
      frozenWeight: ballots.membershipWeight,
      // Current membership: fallback for legacy ballots without a snapshot.
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
        membershipAsOf,
        // A merge leaves the duplicate's ended row on the survivor; it must
        // not double a legacy (unsnapshotted) ballot.
        sql`${memberships.endReason} IS DISTINCT FROM 'merged'`
      )
    )
    .where(eq(ballots.votingId, votingId));

  const votesByItem = new Map<string, VoteWithOwnership[]>();
  for (const r of itemVoteRows) {
    // The snapshot pair is used only when complete; a legacy row (NULL
    // snapshot) falls back to the current active membership, then 1/1.
    const frozenShare =
      r.frozenShareNumerator != null && r.frozenShareDenominator != null;
    const vow: VoteWithOwnership = {
      unitEntityId: r.unitEntityId,
      userId: r.ownerId,
      userName: r.ownerName,
      choice: r.choice as VoteChoice,
      unitShareNumerator: r.shareNumerator,
      unitShareDenominator: r.shareDenominator,
      area: r.area,
      ownerUnitShareNumerator: frozenShare
        ? r.frozenShareNumerator!
        : (r.ownerUnitShareNumerator ?? 1),
      ownerUnitShareDenominator: frozenShare
        ? r.frozenShareDenominator!
        : (r.ownerUnitShareDenominator ?? 1),
      membershipWeight: r.frozenWeight ?? r.membershipWeight ?? 1,
    };
    const slot = votesByItem.get(r.itemId) ?? [];
    slot.push(vow);
    votesByItem.set(r.itemId, slot);
  }

  // Total possible weight over the voting's scope subtree: unit-scoped sums
  // unit weights; member-scoped counts / sums membership weights.
  let totalPossibleWeight = 0;
  if (isUnitScoped(votingMethod)) {
    const flatsForScope = await db
      .select({
        shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
        shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
        area: sql<number | null>`(${entities.data}->>'area_m2')::float8`,
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
          // Not status='active': an ended membership counts for a voting
          // that closed while it was valid (BYT-20261118-007).
          sql`${memberships.status} <> 'pending'`,
          membershipAsOf,
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

  // 2026-11-18 (SK §14b ods. 4, CZ §1206 ods. 2): a meeting voting measures
  // "present" against the prezenčná listina — present + represented owners
  // not marked as left, on the same weight basis and as-of ownership as the
  // tally, united with everyone who cast a ballot. ONE query; an empty list
  // → presence null → engine falls back to cast ballots (ATTENDANCE_MISSING).
  let presence: { weight: number; owners: number } | null = null;
  if (voting.votingType === "meeting") {
    const unitScoped = isUnitScoped(votingMethod);
    const attendanceRows = await db
      .select({
        attendanceId: attendance.id,
        leftAt: attendance.leftAt,
        userId: attendance.ownerId,
        unitEntityId: entities.id,
        unitShareNumerator: sql<number | null>`(${entities.data}->>'share_numerator')::int`,
        unitShareDenominator: sql<number | null>`(${entities.data}->>'share_denominator')::int`,
        area: sql<number | null>`(${entities.data}->>'area_m2')::float8`,
        membershipWeight: memberships.weight,
      })
      .from(attendance)
      .leftJoin(
        memberships,
        and(
          eq(memberships.userId, attendance.ownerId),
          sql`${memberships.status} <> 'pending'`,
          membershipAsOf,
          sql`${memberships.endReason} IS DISTINCT FROM 'merged'`,
          ...(unitScoped ? [eq(memberships.role, "owner")] : [])
        )
      )
      .leftJoin(
        entities,
        and(
          eq(entities.id, memberships.entityId),
          isNull(entities.archivedAt),
          ...(unitScoped ? [eq(entities.kind, "unit")] : []),
          voting.entityId
            ? sql`${entities.path} LIKE (SELECT path || '%' FROM ${entities} WHERE id = ${voting.entityId})`
            : sql`true`
        )
      )
      .where(eq(attendance.votingId, votingId));

    if (attendanceRows.length > 0) {
      const rows: PresenceRow[] = [];
      for (const a of attendanceRows) {
        if (a.leftAt || !a.unitEntityId) continue;
        rows.push({
          unitEntityId: a.unitEntityId,
          userId: a.userId,
          unitShareNumerator: a.unitShareNumerator,
          unitShareDenominator: a.unitShareDenominator,
          area: a.area,
          membershipWeight: a.membershipWeight,
        });
      }
      // A voter is present by definition (also covers a list that missed them).
      for (const r of itemVoteRows) {
        rows.push({
          unitEntityId: r.unitEntityId,
          userId: r.ownerId,
          unitShareNumerator: r.shareNumerator,
          unitShareDenominator: r.shareDenominator,
          area: r.area,
          membershipWeight: r.frozenWeight ?? r.membershipWeight ?? 1,
        });
      }
      presence = computePresence(rows, votingMethod);
    }
  }

  const results = calculateItemResults(
    items.map((i) => ({ id: i.id, quorumType: i.quorumType as QuorumType })),
    votesByItem,
    votingMethod,
    totalPossibleWeight,
    voting.votingType === "meeting"
      ? { country, votingType: "meeting", presence }
      : { country }
  );

  return {
    votingId,
    entityId: voting.entityId,
    items,
    results,
    totalPossibleWeight,
  };
}

// Approved-financial-effects loader for the voting→accounting pipeline
// (BYT-20260512-002 §Voting integration). Returns the passed items of a
// voting that carry a financial effect, so the accounting module can turn
// each into a treasurer-reviewable draft on close.

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
  // Cheap pre-check: nothing to do unless at least one item declares a
  // financial effect — skip the full tally otherwise.
  const [hasEffect] = await db
    .select({ id: votingItems.id })
    .from(votingItems)
    .where(
      and(
        eq(votingItems.votingId, votingId),
        isNotNull(votingItems.financialEffectKind)
      )
    )
    .limit(1);
  if (!hasEffect) return [];

  const bundle = await getVotingResults(votingId);
  if (!bundle) return [];

  const passedById = new Map(bundle.results.map((r) => [r.itemId, r.passed]));

  const effects: ApprovedFinancialEffect[] = [];
  for (const item of bundle.items) {
    if (!item.financialEffectKind) continue;
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
