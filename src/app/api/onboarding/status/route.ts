import { NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { entities, memberships, posts } from "@/db/schema";
import { hasPermission } from "@/lib/permissions";
import { getCommunityRoot } from "@/lib/legacy-compat";
import type { UserRole } from "@/types";

// RES-20260609-001: single signal consumed by both the dashboard
// onboarding banner ("should I nag?") and the /onboarding wizard
// ("which steps are done?"). Everything is derived from data — there
// is no stored onboarding state, so the wizard is resumable for free.
//
// Admin/chairman surface only: the banner and wizard never render for
// owners, so the endpoint mirrors that with a manageSettings gate.
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageSettings")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const root = await getCommunityRoot();
  const communityConfigured = !!(root && root.name && root.address);

  const [{ count: unitCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entities)
    .where(and(eq(entities.kind, "unit"), isNull(entities.archivedAt)));

  const [{ count: ownerCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.role, "owner"), eq(memberships.status, "active")));

  const [{ count: postCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posts);

  const steps = {
    community: communityConfigured,
    units: unitCount > 0,
    owners: ownerCount > 0,
    posts: postCount > 0,
  };

  // "Set up" = the community has units. That single condition gates the
  // banner's vanish; the remaining steps are guidance, not blockers.
  return NextResponse.json({
    complete: unitCount > 0,
    steps,
    counts: { units: unitCount, owners: ownerCount, posts: postCount },
  });
}
