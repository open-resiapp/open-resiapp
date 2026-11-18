import "server-only";
// 2026-11-18 review — the voting snapshot taken at CLOSE, so a closed result,
// its attendance list and its exports never move when units, shares or
// memberships change later:
//   votings          frozen_total_weight, frozen_voting_method, frozen_at
//   ballots          unit_share_* / unit_area_m2 (+ the cast-time owner share
//                    for legacy rows that have none)
//   eligibility      mod_voting_eligibility_snapshots — every eligible
//                    (unit, owner), absent owners included
//   attendance       weight + unit_label per row
// Runs inside the close transaction (transitions.server.ts) after the voting
// row is locked FOR UPDATE — the same lock casts take FOR SHARE first, so no
// ballot can change while the snapshot is written. Every statement is scoped
// to ONE voting (a few hundred rows at most). No DDL, no background work.
// Reopen clears the voting / ballot / eligibility part; the next close
// rewrites it.
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships } from "@/db/schema";
import { getCommunityRoot } from "@/lib/legacy-compat";
import {
  computeMemberWeight,
  computeUnitWeight,
  isUnitScoped,
  normalizeVotingMethod,
  type CanonicalVotingMethod,
} from "@/lib/voting-method";
import { attendance, ballots, eligibilitySnapshots, votings } from "./db/schema";
import { loadLiveEligible } from "./participation";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = Tx | typeof db;

/**
 * Total possible weight over a scope subtree: unit-scoped sums unit weights
 * (non-archived units), member-scoped counts / sums the memberships matching
 * `membershipFilter` (live: status = 'active'; results.ts passes its as-of
 * filter for closed votings without a frozen total).
 */
export async function computeTotalPossibleWeight(
  exec: Exec,
  scopeEntityId: string | null,
  votingMethod: CanonicalVotingMethod,
  membershipFilter: SQL = sql`${memberships.status} = 'active'`
): Promise<number> {
  const scope = scopeEntityId
    ? sql`${entities.path} LIKE (SELECT path || '%' FROM ${entities} WHERE id = ${scopeEntityId})`
    : sql`true`;
  let total = 0;
  if (isUnitScoped(votingMethod)) {
    const units = await exec
      .select({
        shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
        shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
        area: sql<number | null>`(${entities.data}->>'area_m2')::float8`,
      })
      .from(entities)
      .where(and(eq(entities.kind, "unit"), isNull(entities.archivedAt), scope));
    for (const u of units) {
      total += computeUnitWeight(
        { shareNumerator: u.shareNumerator, shareDenominator: u.shareDenominator, area: u.area },
        votingMethod
      );
    }
  } else {
    const members = await exec
      .select({ weight: memberships.weight })
      .from(memberships)
      .innerJoin(entities, eq(entities.id, memberships.entityId))
      .where(and(membershipFilter, isNull(entities.archivedAt), scope));
    for (const m of members) {
      total += computeMemberWeight({ membershipWeight: m.weight }, votingMethod);
    }
  }
  return total;
}

/** Writes the close snapshot of one voting. Call inside the close transaction. */
export async function freezeVotingAtClose(
  tx: Tx,
  voting: { id: string; entityId: string | null }
): Promise<void> {
  const root = await getCommunityRoot();
  const votingMethod = normalizeVotingMethod(root?.votingMethod);
  const now = new Date();

  // Sequential: one transaction = one connection.
  const totalPossibleWeight = await computeTotalPossibleWeight(tx, voting.entityId, votingMethod);
  const eligible = await loadLiveEligible(tx, voting.entityId, votingMethod);

  await tx
    .update(votings)
    .set({
      frozenTotalWeight: totalPossibleWeight,
      frozenVotingMethod: votingMethod,
      frozenAt: now,
    })
    .where(eq(votings.id, voting.id));

  // Eligible set (absent owners included).
  await tx.delete(eligibilitySnapshots).where(eq(eligibilitySnapshots.votingId, voting.id));
  if (eligible.length > 0) {
    await tx
      .insert(eligibilitySnapshots)
      .values(
        eligible.map((e) => ({
          votingId: voting.id,
          unitEntityId: e.unitId,
          ownerId: e.ownerId,
          unitLabel: e.unitLabel.slice(0, 255),
          weight: e.weight,
          unitShareNumerator: e.unitShareNumerator,
          unitShareDenominator: e.unitShareDenominator,
          unitAreaM2: e.area ?? null,
          ownerUnitShareNumerator: e.ownerUnitShareNumerator,
          ownerUnitShareDenominator: e.ownerUnitShareDenominator,
          membershipWeight: e.membershipWeight ?? 1,
        }))
      )
      .onConflictDoNothing();
  }

  // Unit share / area of every ballot of this voting, as of now.
  await tx.execute(sql`
    UPDATE ${ballots} b
    SET unit_share_numerator = (u.data->>'share_numerator')::int,
        unit_share_denominator = (u.data->>'share_denominator')::int,
        unit_area_m2 = (u.data->>'area_m2')::float8
    FROM ${entities} u
    WHERE b.voting_id = ${voting.id} AND u.id = b.entity_id`);

  // Legacy ballots without a cast-time owner snapshot: current active
  // membership, owner role preferred (same as ballot-snapshot.server.ts).
  await tx.execute(sql`
    UPDATE ${ballots} b
    SET owner_unit_share_numerator = m.owner_unit_share_numerator,
        owner_unit_share_denominator = m.owner_unit_share_denominator,
        membership_weight = m.weight
    FROM (
      SELECT DISTINCT ON (mm.entity_id, mm.user_id)
             mm.entity_id, mm.user_id, mm.owner_unit_share_numerator,
             mm.owner_unit_share_denominator, mm.weight
      FROM ${memberships} mm
      JOIN ${ballots} bb ON bb.entity_id = mm.entity_id AND bb.owner_id = mm.user_id
      WHERE bb.voting_id = ${voting.id} AND mm.status = 'active'
      ORDER BY mm.entity_id, mm.user_id, (mm.role = 'owner') DESC
    ) m
    WHERE b.voting_id = ${voting.id} AND b.owner_unit_share_numerator IS NULL
      AND m.entity_id = b.entity_id AND m.user_id = b.owner_id`);

  // Attendance rows: the owner's frozen weight + unit labels.
  const byOwner = new Map<string, { weight: number; labels: string[] }>();
  for (const e of eligible) {
    const o = byOwner.get(e.ownerId) ?? { weight: 0, labels: [] };
    o.weight += e.weight;
    o.labels.push(e.unitLabel);
    byOwner.set(e.ownerId, o);
  }
  const present = await tx
    .select({ id: attendance.id, ownerId: attendance.ownerId })
    .from(attendance)
    .where(eq(attendance.votingId, voting.id));
  for (const a of present) {
    const o = byOwner.get(a.ownerId);
    await tx
      .update(attendance)
      .set({
        // Not eligible at close (e.g. sold during the meeting): weight 0 —
        // the row stays as evidence but carries no vote.
        weight: o ? o.weight : 0,
        unitLabel: o ? o.labels.join(", ").slice(0, 500) : null,
      })
      .where(eq(attendance.id, a.id));
  }
}

/** Reopen (correction mode): the voting reads live data again until the next close. */
export async function clearVotingFreeze(tx: Tx, votingId: string): Promise<void> {
  await tx
    .update(votings)
    .set({ frozenTotalWeight: null, frozenVotingMethod: null, frozenAt: null })
    .where(eq(votings.id, votingId));
  await tx
    .update(ballots)
    .set({ unitShareNumerator: null, unitShareDenominator: null, unitAreaM2: null })
    .where(eq(ballots.votingId, votingId));
  await tx.delete(eligibilitySnapshots).where(eq(eligibilitySnapshots.votingId, votingId));
}
