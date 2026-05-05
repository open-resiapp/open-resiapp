import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, flats, posts, entrances } from "@/db/schema";
import { votings } from "@modules/voting/src/db/schema";
import { count, eq } from "drizzle-orm";
import { withExternalAuth } from "@/lib/external-auth";

async function handler(_request: NextRequest) {
  const [[userCount], [flatCount], [entranceCount], [votingCount], [postCount]] =
    await Promise.all([
      db.select({ count: count() }).from(users).where(eq(users.isActive, true)),
      db.select({ count: count() }).from(flats),
      db.select({ count: count() }).from(entrances),
      db.select({ count: count() }).from(votings),
      db.select({ count: count() }).from(posts),
    ]);

  const activeVotings = await db
    .select({ count: count() })
    .from(votings)
    .where(eq(votings.status, "active"));

  return NextResponse.json({
    users: userCount.count,
    flats: flatCount.count,
    entrances: entranceCount.count,
    votings: {
      total: votingCount.count,
      active: activeVotings[0].count,
    },
    posts: postCount.count,
  });
}

export const GET = withExternalAuth(handler, "read");
