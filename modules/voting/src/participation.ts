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
import { votings, ballots } from "./db/schema";

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
}

export interface VotingParticipation {
  votingId: string;
  votingMethod: CanonicalVotingMethod;
  eligibleCount: number;
  votedCount: number;
  eligibleWeight: number;
  votedWeight: number;
  notVoted: ParticipationRow[];
}

export async function getVotingParticipation(
  votingId: string
): Promise<VotingParticipation | null> {
  const [voting] = await db
    .select({ entityId: votings.entityId })
    .from(votings)
    .where(eq(votings.id, votingId))
    .limit(1);
  if (!voting) return null;

  const root = await getCommunityRoot();
  const votingMethod = normalizeVotingMethod(root?.votingMethod);
  const unitScoped = isUnitScoped(votingMethod);

  const scopeFilter = voting.entityId
    ? sql`${entities.path} LIKE (SELECT path || '%' FROM ${entities} WHERE id = ${voting.entityId})`
    : sql`true`;

  const eligible = await db
    .select({
      unitId: entities.id,
      unitName: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
      ownerId: memberships.userId,
      ownerName: users.name,
      shareNumerator: sql<number | null>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number | null>`(${entities.data}->>'share_denominator')::int`,
      area: sql<number | null>`(${entities.data}->>'area_m2')::int`,
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

  const voted = await db
    .select({ unitId: ballots.entityId, ownerId: ballots.ownerId })
    .from(ballots)
    .where(eq(ballots.votingId, votingId));
  const votedKeys = new Set(voted.map((b) => `${b.unitId}:${b.ownerId}`));

  let eligibleWeight = 0;
  let votedWeight = 0;
  let votedCount = 0;
  const notVoted: ParticipationRow[] = [];

  for (const r of eligible) {
    const weight = unitScoped
      ? computeUnitWeight(
          {
            shareNumerator: r.shareNumerator ?? 0,
            shareDenominator: r.shareDenominator || 1,
            area: r.area,
          },
          votingMethod
        ) *
        ((r.ownerUnitShareNumerator ?? 1) / (r.ownerUnitShareDenominator || 1))
      : computeMemberWeight({ membershipWeight: r.membershipWeight }, votingMethod);
    eligibleWeight += weight;

    if (votedKeys.has(`${r.unitId}:${r.ownerId}`)) {
      votedCount += 1;
      votedWeight += weight;
      continue;
    }
    notVoted.push({
      unitId: r.unitId,
      unitLabel: r.flatNumber ?? r.unitName,
      ownerId: r.ownerId,
      ownerName: r.ownerName,
      weight,
      unitShareNumerator: r.shareNumerator,
      unitShareDenominator: r.shareDenominator,
      ownerUnitShareNumerator: r.ownerUnitShareNumerator,
      ownerUnitShareDenominator: r.ownerUnitShareDenominator,
    });
  }

  notVoted.sort((a, b) =>
    a.unitLabel.localeCompare(b.unitLabel, undefined, { numeric: true })
  );

  return {
    votingId,
    votingMethod,
    eligibleCount: eligible.length,
    votedCount,
    eligibleWeight,
    votedWeight,
    notVoted,
  };
}
