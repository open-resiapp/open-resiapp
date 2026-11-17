import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships, posts } from "@/db/schema";
import { getCommunityRoot, type CommunityRootRow } from "@/lib/legacy-compat";

// RES-20260609-001: single signal consumed by the dashboard onboarding
// banner ("should I nag?") and the /onboarding wizard ("which steps are
// done?"). Everything is derived from data — no stored onboarding state.

export interface OnboardingStatus {
  complete: boolean;
  steps: { community: boolean; units: boolean; owners: boolean; posts: boolean };
  counts: { units: number; owners: number; posts: number };
}

/**
 * Callers that already resolved the community root may pass it to save a
 * query; `undefined` means "look it up".
 */
export async function getOnboardingStatus(
  preloadedRoot?: CommunityRootRow | null
): Promise<OnboardingStatus> {
  const root = preloadedRoot === undefined ? await getCommunityRoot() : preloadedRoot;
  const communityConfigured = !!(root && root.name && root.address);

  const [[{ count: unitCount }], [{ count: ownerCount }], [{ count: postCount }]] =
    await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(entities)
        .where(and(eq(entities.kind, "unit"), isNull(entities.archivedAt))),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(eq(memberships.role, "owner"), eq(memberships.status, "active"))),
      db.select({ count: sql<number>`count(*)::int` }).from(posts),
    ]);

  // "Set up" = the community has units. That single condition gates the
  // banner's vanish; the remaining steps are guidance, not blockers.
  return {
    complete: unitCount > 0,
    steps: {
      community: communityConfigured,
      units: unitCount > 0,
      owners: ownerCount > 0,
      posts: postCount > 0,
    },
    counts: { units: unitCount, owners: ownerCount, posts: postCount },
  };
}
