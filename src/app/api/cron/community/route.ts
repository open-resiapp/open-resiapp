import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { communityPosts } from "@/db/schema";
import { and, eq, lt, sql } from "drizzle-orm";

const EVENT_GRACE_DAYS = 7;

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const provided = request.headers.get("x-cron-secret");
  if (provided !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();

  const expiredByTtl = await db
    .update(communityPosts)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(communityPosts.status, "active"),
        lt(communityPosts.expiresAt, now)
      )
    )
    .returning({ id: communityPosts.id });

  const eventCutoff = new Date(
    now.getTime() - EVENT_GRACE_DAYS * 24 * 60 * 60 * 1000
  );
  const expiredEvents = await db
    .update(communityPosts)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(communityPosts.status, "active"),
        eq(communityPosts.type, "event"),
        sql`${communityPosts.eventDate} IS NOT NULL`,
        lt(communityPosts.eventDate, eventCutoff)
      )
    )
    .returning({ id: communityPosts.id });

  return NextResponse.json({
    ok: true,
    ranAt: now.toISOString(),
    expiredByTtl: expiredByTtl.length,
    expiredEvents: expiredEvents.length,
  });
}

export async function GET(request: NextRequest) {
  return POST(request);
}
