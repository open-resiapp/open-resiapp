import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, isNull, ne } from "drizzle-orm";

import { db } from "@/db";
import { users, posts, entities } from "@/db/schema";
import { votings } from "@modules/voting/src/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import type { ValidatedApiKey } from "@/lib/api-keys";
import { apiKeyCanSeeDraftVotings } from "@modules/voting/src/votings";

// Phase 9.1b: counts re-derived from entities so the v1 stats shape
// survives the legacy table drop.
async function handler(_request: NextRequest, apiKey: ValidatedApiKey) {
  // Same draft rule as /external/v1/votings: drafts count only for a `full` key.
  const draftFilter = apiKeyCanSeeDraftVotings(apiKey.permissions)
    ? undefined
    : ne(votings.status, "draft");
  const [
    [userCount],
    [flatCount],
    [entranceCount],
    [votingCount],
    [postCount],
    [activeVotings],
  ] = await Promise.all([
    db.select({ count: count() }).from(users).where(eq(users.isActive, true)),
    db
      .select({ count: count() })
      .from(entities)
      .where(
        and(eq(entities.kind, "unit"), isNull(entities.archivedAt))
      ),
    db
      .select({ count: count() })
      .from(entities)
      .where(
        and(eq(entities.kind, "entrance"), isNull(entities.archivedAt))
      ),
    db.select({ count: count() }).from(votings).where(draftFilter),
    db.select({ count: count() }).from(posts),
    db.select({ count: count() }).from(votings).where(eq(votings.status, "active")),
  ]);

  return NextResponse.json({
    users: userCount.count,
    flats: flatCount.count,
    entrances: entranceCount.count,
    votings: {
      total: votingCount.count,
      active: activeVotings.count,
    },
    posts: postCount.count,
  });
}

export const GET = withExternalAuth(handler, "read");
