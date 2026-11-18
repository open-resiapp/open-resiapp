import "server-only";

import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";
import { votings, votingItems, ballots, ballotItemVotes, attendance } from "./db/schema";
import { calculateItemResults, computePresence, type PresenceRow } from "./engine";
import { isUnitScoped, normalizeVotingMethod } from "@/lib/voting-method";
import { computeTotalPossibleWeight } from "./freeze.server";
import { loadEligibilitySnapshot } from "./participation";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { VOTING_ROLES, isVotingRole } from "./voting-roles";
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
  const country = (root?.country ?? "sk") as Country;

  const [voting] = await db
    .select({
      entityId: votings.entityId,
      status: votings.status,
      endsAt: votings.endsAt,
      votingType: votings.votingType,
      frozenTotalWeight: votings.frozenTotalWeight,
      frozenVotingMethod: votings.frozenVotingMethod,
    })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!voting) return null;

  // 2026-11-18 review: a closed voting is computed from the snapshot taken at
  // close (freeze.server.ts) — method, total possible weight, per-ballot unit
  // and owner shares, the eligible set. Closed votings without a snapshot
  // (none after 0087) fall back to the as-of-end-date computation below.
  const closed = voting.status === "closed";
  const frozen = closed && voting.frozenTotalWeight != null;
  const votingMethod = normalizeVotingMethod(
    frozen && voting.frozenVotingMethod ? voting.frozenVotingMethod : root?.votingMethod
  );

  // BYT-20261118-007: ownership AS OF the voting — a closed voting reads the
  // memberships valid on its end date, so a later sale / removal / new
  // member never moves its result. Open votings read today.
  const asOf = closed
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
  // engine can group by unit and resolve §14 ods. 4 per item. No membership
  // join here (a user with two memberships on one unit would duplicate the
  // vote) — the legacy fallback is resolved per (unit, owner) below.
  const rawRows = await db
    .select({
      itemId: ballotItemVotes.itemId,
      choice: ballotItemVotes.choice,
      ownerId: ballots.ownerId,
      unitEntityId: ballots.entityId,
      ownerName: users.name,
      liveShareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
      liveShareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
      liveArea: sql<number | null>`(${entities.data}->>'area_m2')::float8`,
      // Unit share frozen at close — authoritative when set.
      frozenUnitShareNumerator: ballots.unitShareNumerator,
      frozenUnitShareDenominator: ballots.unitShareDenominator,
      frozenArea: ballots.unitAreaM2,
      // Owner share frozen at cast time (legal fix 2026-11-18) — authoritative when set.
      frozenShareNumerator: ballots.ownerUnitShareNumerator,
      frozenShareDenominator: ballots.ownerUnitShareDenominator,
      frozenWeight: ballots.membershipWeight,
    })
    .from(ballotItemVotes)
    .innerJoin(ballots, eq(ballots.id, ballotItemVotes.ballotId))
    .leftJoin(users, eq(ballots.ownerId, users.id))
    .innerJoin(entities, eq(entities.id, ballots.entityId))
    .where(eq(ballots.votingId, votingId));

  // Legacy ballots without an owner snapshot: membership valid on the end
  // date (closed) / today (open); when none is valid then, the CURRENT active
  // membership (what results showed before 0086); then 1/1. Owner role first.
  const fallback = await legacyMembershipFallback(
    rawRows.filter((r) => r.frozenShareNumerator == null || r.frozenShareDenominator == null || r.frozenWeight == null),
    membershipAsOf
  );

  const itemVoteRows = rawRows.map((r) => {
    const unitFrozen =
      closed &&
      (r.frozenUnitShareNumerator != null || r.frozenUnitShareDenominator != null || r.frozenArea != null);
    const fb = fallback.get(`${r.unitEntityId}:${r.ownerId}`);
    const ownerFrozen = r.frozenShareNumerator != null && r.frozenShareDenominator != null;
    return {
      itemId: r.itemId,
      choice: r.choice,
      ownerId: r.ownerId,
      ownerName: r.ownerName,
      unitEntityId: r.unitEntityId,
      shareNumerator: unitFrozen ? r.frozenUnitShareNumerator! : r.liveShareNumerator,
      shareDenominator: unitFrozen ? r.frozenUnitShareDenominator! : r.liveShareDenominator,
      area: unitFrozen ? r.frozenArea : r.liveArea,
      ownerUnitShareNumerator: ownerFrozen ? r.frozenShareNumerator! : (fb?.num ?? 1),
      ownerUnitShareDenominator: ownerFrozen ? r.frozenShareDenominator! : (fb?.den ?? 1),
      membershipWeight: r.frozenWeight ?? fb?.weight ?? 1,
    };
  });

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
      ownerUnitShareNumerator: r.ownerUnitShareNumerator,
      ownerUnitShareDenominator: r.ownerUnitShareDenominator,
      membershipWeight: r.membershipWeight,
    };
    const slot = votesByItem.get(r.itemId) ?? [];
    slot.push(vow);
    votesByItem.set(r.itemId, slot);
  }

  // Total possible weight over the voting's scope subtree: frozen at close,
  // else computed (unit-scoped sums unit weights; member-scoped counts / sums
  // membership weights valid as of the voting — not status='active': an
  // ended membership counts for a voting that closed while it was valid).
  const totalPossibleWeight = frozen
    ? voting.frozenTotalWeight!
    : await computeTotalPossibleWeight(
        db,
        voting.entityId,
        votingMethod,
        sql`(${memberships.status} <> 'pending' AND ${membershipAsOf})`
      );

  // 2026-11-18 (SK §14b ods. 4, CZ §1206 ods. 2): a meeting voting measures
  // "present" against the prezenčná listina — present + represented owners
  // not marked as left, on the same weight basis and as-of ownership as the
  // tally, united with everyone who cast a ballot. An empty list → presence
  // null → engine falls back to cast ballots (ATTENDANCE_MISSING). A closed
  // voting with a snapshot maps attendees onto the eligible set frozen at close.
  let presence: { weight: number; owners: number } | null = null;
  if (voting.votingType === "meeting") {
    const attendees = await db
      .select({ userId: attendance.ownerId, leftAt: attendance.leftAt })
      .from(attendance)
      .where(eq(attendance.votingId, votingId));

    if (attendees.length > 0) {
      const presentIds = new Set(attendees.filter((a) => !a.leftAt).map((a) => a.userId));
      const rows: PresenceRow[] = [];
      const snapshot = frozen ? await loadEligibilitySnapshot(db, votingId) : [];
      if (snapshot.length > 0) {
        for (const e of snapshot) {
          if (!presentIds.has(e.ownerId)) continue;
          rows.push({
            unitEntityId: e.unitId,
            userId: e.ownerId,
            unitShareNumerator: e.unitShareNumerator,
            unitShareDenominator: e.unitShareDenominator,
            area: e.area ?? null,
            membershipWeight: e.membershipWeight ?? 1,
          });
        }
      } else if (presentIds.size > 0) {
        rows.push(...(await livePresenceRows(votingId, voting.entityId, votingMethod, membershipAsOf)));
      }
      // A voter is present by definition (also covers a list that missed them).
      for (const r of itemVoteRows) {
        rows.push({
          unitEntityId: r.unitEntityId,
          userId: r.ownerId,
          unitShareNumerator: r.shareNumerator,
          unitShareDenominator: r.shareDenominator,
          area: r.area,
          membershipWeight: r.membershipWeight,
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

/** Legacy owner-share fallback per (unit, owner): as-of membership, else current active, owner role first. */
async function legacyMembershipFallback(
  rows: { unitEntityId: string; ownerId: string }[],
  membershipAsOf: SQL
): Promise<Map<string, { num: number; den: number; weight: number }>> {
  const out = new Map<string, { num: number; den: number; weight: number }>();
  if (rows.length === 0) return out;
  const unitIds = [...new Set(rows.map((r) => r.unitEntityId))];
  const ownerIds = [...new Set(rows.map((r) => r.ownerId))];
  const ms = await db
    .select({
      entityId: memberships.entityId,
      userId: memberships.userId,
      role: memberships.role,
      status: memberships.status,
      num: memberships.ownerUnitShareNumerator,
      den: memberships.ownerUnitShareDenominator,
      weight: memberships.weight,
      validAsOf: sql<boolean>`${membershipAsOf}`,
    })
    .from(memberships)
    .where(
      and(
        inArray(memberships.entityId, unitIds),
        inArray(memberships.userId, ownerIds),
        // A merge leaves the duplicate's ended row on the survivor; it must
        // not double a legacy (unsnapshotted) ballot.
        sql`${memberships.endReason} IS DISTINCT FROM 'merged'`
      )
    );
  const rank = (m: (typeof ms)[number]) =>
    (m.validAsOf ? 4 : m.status === "active" ? 2 : 0) + (isVotingRole(m.role) ? 1 : 0);
  const best = new Map<string, (typeof ms)[number]>();
  for (const m of ms) {
    if (!m.validAsOf && m.status !== "active") continue;
    const k = `${m.entityId}:${m.userId}`;
    const cur = best.get(k);
    if (!cur || rank(m) > rank(cur)) best.set(k, m);
  }
  for (const [k, m] of best) out.set(k, { num: m.num, den: m.den, weight: m.weight });
  return out;
}

/** Live (unsnapshotted) presence rows of the attendance list, as-of ownership. */
async function livePresenceRows(
  votingId: string,
  scopeEntityId: string | null,
  votingMethod: ReturnType<typeof normalizeVotingMethod>,
  membershipAsOf: SQL
): Promise<PresenceRow[]> {
  const unitScoped = isUnitScoped(votingMethod);
  const attendanceRows = await db
    .select({
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
        // Voting roles only (voting-roles.ts) — for member-scoped methods too:
        // a tenant / accountant membership never carries a vote.
        inArray(memberships.role, [...VOTING_ROLES])
      )
    )
    .leftJoin(
      entities,
      and(
        eq(entities.id, memberships.entityId),
        isNull(entities.archivedAt),
        ...(unitScoped ? [eq(entities.kind, "unit")] : []),
        scopeEntityId
          ? sql`${entities.path} LIKE (SELECT path || '%' FROM ${entities} WHERE id = ${scopeEntityId})`
          : sql`true`
      )
    )
    .where(eq(attendance.votingId, votingId));
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
  return rows;
}

/**
 * Per-item `passed` of the current result (closed votings only; null when
 * the voting is not closed or does not exist). Lets the accounting impacts
 * view flag a draft whose item flipped passed → not passed after a reopen
 * (spec §6) without re-implementing the tally.
 */
export async function getItemPassedMap(votingId: string): Promise<Map<string, boolean> | null> {
  const [v] = await db
    .select({ status: votings.status })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!v || v.status !== "closed") return null;
  const bundle = await getVotingResults(votingId);
  if (!bundle) return null;
  return new Map(bundle.results.map((r) => [r.itemId, r.passed]));
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
