import "server-only";
// BYT-20261118-002 §8 loaders for board Domov: e-vote readiness and
// "publish the result by {date}" reminders. Read-only SQL, run once per
// server render of Domov — not live, not polled, no client fetch, no cache.
// TODO(perf): EXPLAIN ANALYZE on the largest demo community before shipping
// (spec §8).
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships, users, webauthnCredentials } from "@/db/schema";
import type { CommunityRootRow } from "@/lib/legacy-compat";
import { normalizeVotingMethod } from "@/lib/voting-method";
import { votings } from "./db/schema";
import { votingVisibilityFilter, type VotingViewer } from "./votings";
import { VOTING_ROLES } from "./voting-roles";
import { computeEVoteReadiness, type ReadinessRow } from "./workflow/readiness";
import { publicationDeadline } from "./workflow/transitions";
import type { Country } from "./rules";

/**
 * Readiness rows for the whole community. "Usable e-vote identity"
 * (TODO(decision): spec Decisions 9 — is a verified e-mail enough?):
 * active user AND (verified e-mail OR an activated passkey).
 */
export async function getEVoteReadiness(root: CommunityRootRow): Promise<ReadinessRow[]> {
  const rows = await db
    .select({
      unitId: memberships.entityId,
      ownerId: memberships.userId,
      hasEVoteIdentity: sql<boolean>`(
        ${users.isActive}
        AND (
          ${users.emailVerifiedAt} IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM ${webauthnCredentials} w
            WHERE w.user_id = ${users.id} AND w.activated_at IS NOT NULL
          )
        )
      )`,
      unitShareNumerator: sql<number>`coalesce((${entities.data}->>'share_numerator')::int, 0)`,
      unitShareDenominator: sql<number>`coalesce((${entities.data}->>'share_denominator')::int, 1)`,
      area: sql<number | null>`(${entities.data}->>'area_m2')::float8`,
      ownerUnitShareNumerator: memberships.ownerUnitShareNumerator,
      ownerUnitShareDenominator: memberships.ownerUnitShareDenominator,
      membershipWeight: memberships.weight,
    })
    .from(memberships)
    .innerJoin(entities, eq(entities.id, memberships.entityId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(memberships.status, "active"),
        inArray(memberships.role, [...VOTING_ROLES]),
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt)
      )
    );

  return computeEVoteReadiness({
    country: root.country as Country,
    votingMethod: normalizeVotingMethod(root.votingMethod),
    owners: rows.map((r) => ({ ...r, hasEVoteIdentity: Boolean(r.hasEVoteIdentity) })),
  });
}

export interface PublicationReminder {
  id: string;
  title: string;
  deadline: string;
  overdue: boolean;
}

/**
 * Closed votings whose result is not yet published (§14a ods. 9: within
 * 7 days after the end). Computed at render — no cron, no stored reminder.
 */
export async function listPublicationReminders(
  viewer: VotingViewer
): Promise<PublicationReminder[]> {
  const rows = await db
    .select({ id: votings.id, title: votings.title, endsAt: votings.endsAt })
    .from(votings)
    .where(
      and(
        votingVisibilityFilter(viewer),
        eq(votings.status, "closed"),
        isNull(votings.resultPublishedAt),
        // Only votings run through the announcement flow; legacy closed
        // votings (no announcedAt) never had a publication step.
        isNotNull(votings.announcedAt)
      )
    )
    .orderBy(votings.endsAt)
    .limit(10);
  const now = Date.now();
  return rows.map((r) => {
    const d = publicationDeadline(r.endsAt);
    return { id: r.id, title: r.title, deadline: d.toISOString(), overdue: d.getTime() < now };
  });
}
