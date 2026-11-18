import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";
import { getCommunityRoot } from "@/lib/legacy-compat";
import {
  computeMemberWeight,
  computeUnitWeight,
  isUnitScoped,
  normalizeVotingMethod,
  type CanonicalVotingMethod,
} from "@/lib/voting-method";
import { votings, ballots, eligibilitySnapshots } from "./db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Tx | typeof db;

// Voting participation (BYT-20261117-001 tool 9 `get_voting_participation`):
// who in the voting's scope has NOT cast a ballot yet, per (unit, owner).
//
// Counts only `mod_voting_ballots` — pending / unconfirmed ballots (a
// separate table, spec §6) never count. Scope rules mirror getVotingResults:
//   - unit-scoped methods: active OWNER memberships on non-archived units in
//     the voting's subtree; weight = unit weight × owner's unit share.
//   - member-scoped methods: every active membership on a non-archived
//     entity in the subtree; weight = membership weight.
// No authz — the caller gates it (board only).
//
// 2026-11-18 review: a CLOSED voting reads the eligible set frozen at close
// (mod_voting_eligibility_snapshots, written by freeze.server.ts) — the same
// rows today's memberships produced at that moment — so the attendance list,
// its exports, the management view and the ballot lists never move after a
// sale / new member. Open votings (and closed ones without a snapshot) read live.

export interface ParticipationRow {
  unitId: string;
  unitLabel: string;
  ownerId: string;
  ownerName: string | null;
  /** Owner's voting weight for this voting's method. */
  weight: number;
  unitShareNumerator: number | null;
  unitShareDenominator: number | null;
  ownerUnitShareNumerator: number;
  ownerUnitShareDenominator: number;
  area?: number | null;
  membershipWeight?: number;
}

export interface VotingParticipation {
  votingId: string;
  votingMethod: CanonicalVotingMethod;
  eligibleCount: number;
  votedCount: number;
  eligibleWeight: number;
  votedWeight: number;
  notVoted: ParticipationRow[];
  /** Every eligible (unit, owner), voted or not — board management view (BYT-20261118-002 §5). */
  eligible: ParticipationRow[];
}

export async function getVotingParticipation(
  votingId: string
): Promise<VotingParticipation | null> {
  const [voting] = await db
    .select({
      entityId: votings.entityId,
      status: votings.status,
      frozenVotingMethod: votings.frozenVotingMethod,
    })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!voting) return null;

  let votingMethod: CanonicalVotingMethod;
  let all: ParticipationRow[] = [];
  if (voting.status === "closed") all = await loadEligibilitySnapshot(db, votingId);
  if (all.length > 0) {
    votingMethod = normalizeVotingMethod(voting.frozenVotingMethod);
  } else {
    const root = await getCommunityRoot();
    votingMethod = normalizeVotingMethod(root?.votingMethod);
    all = await loadLiveEligible(db, voting.entityId, votingMethod);
  }

  const voted = await db
    .select({ unitId: ballots.entityId, ownerId: ballots.ownerId })
    .from(ballots)
    .where(eq(ballots.votingId, votingId));
  const votedKeys = new Set(voted.map((b) => `${b.unitId}:${b.ownerId}`));

  let eligibleWeight = 0;
  let votedWeight = 0;
  let votedCount = 0;
  const notVoted: ParticipationRow[] = [];
  for (const row of all) {
    eligibleWeight += row.weight;
    if (votedKeys.has(`${row.unitId}:${row.ownerId}`)) {
      votedCount += 1;
      votedWeight += row.weight;
      continue;
    }
    notVoted.push(row);
  }

  return {
    votingId,
    votingMethod,
    eligibleCount: all.length,
    votedCount,
    eligibleWeight,
    votedWeight,
    notVoted,
    eligible: all,
  };
}

const byLabel = (a: ParticipationRow, b: ParticipationRow) =>
  a.unitLabel.localeCompare(b.unitLabel, undefined, { numeric: true });

/**
 * Today's eligible (unit, owner) rows of a scope — the live rule set above.
 * Also used by freeze.server.ts inside the close transaction (`exec` = tx).
 */
export async function loadLiveEligible(
  exec: Exec,
  scopeEntityId: string | null,
  votingMethod: CanonicalVotingMethod
): Promise<ParticipationRow[]> {
  const unitScoped = isUnitScoped(votingMethod);
  const scopeFilter = scopeEntityId
    ? sql`${entities.path} LIKE (SELECT path || '%' FROM ${entities} WHERE id = ${scopeEntityId})`
    : sql`true`;

  const eligible = await exec
    .select({
      unitId: entities.id,
      unitName: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      ownerId: memberships.userId,
      ownerName: users.name,
      shareNumerator: sql<number | null>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number | null>`(${entities.data}->>'share_denominator')::int`,
      area: sql<number | null>`(${entities.data}->>'area_m2')::float8`,
      ownerUnitShareNumerator: memberships.ownerUnitShareNumerator,
      ownerUnitShareDenominator: memberships.ownerUnitShareDenominator,
      membershipWeight: memberships.weight,
    })
    .from(memberships)
    .innerJoin(entities, eq(entities.id, memberships.entityId))
    .leftJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.status, "active"),
        isNull(entities.archivedAt),
        scopeFilter,
        ...(unitScoped
          ? [eq(entities.kind, "unit"), inArray(memberships.role, ["owner"])]
          : [])
      )
    );

  const rows: ParticipationRow[] = eligible.map((r) => ({
    unitId: r.unitId,
    unitLabel: r.flatNumber ?? r.unitName,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    weight: unitScoped
      ? computeUnitWeight(
          {
            shareNumerator: r.shareNumerator ?? 0,
            shareDenominator: r.shareDenominator || 1,
            area: r.area,
          },
          votingMethod
        ) *
        ((r.ownerUnitShareNumerator ?? 1) / (r.ownerUnitShareDenominator || 1))
      : computeMemberWeight({ membershipWeight: r.membershipWeight }, votingMethod),
    unitShareNumerator: r.shareNumerator,
    unitShareDenominator: r.shareDenominator,
    ownerUnitShareNumerator: r.ownerUnitShareNumerator,
    ownerUnitShareDenominator: r.ownerUnitShareDenominator,
    area: r.area,
    membershipWeight: r.membershipWeight,
  }));
  rows.sort(byLabel);
  return rows;
}

/** The eligible set frozen at close ([] = no snapshot). Owner names stay live (anonymisation). */
export async function loadEligibilitySnapshot(
  exec: Exec,
  votingId: string
): Promise<ParticipationRow[]> {
  const rows = await exec
    .select({
      unitId: eligibilitySnapshots.unitEntityId,
      unitLabel: eligibilitySnapshots.unitLabel,
      ownerId: eligibilitySnapshots.ownerId,
      ownerName: users.name,
      weight: eligibilitySnapshots.weight,
      unitShareNumerator: eligibilitySnapshots.unitShareNumerator,
      unitShareDenominator: eligibilitySnapshots.unitShareDenominator,
      area: eligibilitySnapshots.unitAreaM2,
      ownerUnitShareNumerator: eligibilitySnapshots.ownerUnitShareNumerator,
      ownerUnitShareDenominator: eligibilitySnapshots.ownerUnitShareDenominator,
      membershipWeight: eligibilitySnapshots.membershipWeight,
    })
    .from(eligibilitySnapshots)
    .leftJoin(users, eq(users.id, eligibilitySnapshots.ownerId))
    .where(eq(eligibilitySnapshots.votingId, votingId));
  rows.sort(byLabel);
  return rows;
}

/**
 * Eligible voters of a voting — one row per (unit, owner), same scope rules
 * as getVotingParticipation (spec §4 "all ballot lists" source). Board only.
 */
export async function listEligibleVoters(votingId: string): Promise<ParticipationRow[]> {
  const p = await getVotingParticipation(votingId);
  return p?.eligible ?? [];
}
