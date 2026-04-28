import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  communityNotificationsSent,
  communityPosts,
  eventRsvps,
  users,
} from "@/db/schema";
import { and, eq, gt, lt, lte, sql } from "drizzle-orm";
import {
  sendEventReminder,
  sendPostExpiryReminder,
} from "@/lib/email";
import { setLastCronRun } from "@/lib/cron-state";

const EVENT_GRACE_DAYS = 7;
const EXPIRY_REMINDER_DAYS = 3;

function appUrl(): string {
  return (
    process.env.NEXTAUTH_URL?.replace(/\/$/, "") || "http://localhost:3000"
  );
}

async function runCron() {
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

  // Expiry reminders: 3 days before expiresAt, once per post
  const expiryWindowEnd = new Date(
    now.getTime() + EXPIRY_REMINDER_DAYS * 24 * 60 * 60 * 1000
  );

  const expiringSoon = await db
    .select({
      id: communityPosts.id,
      title: communityPosts.title,
      authorId: communityPosts.authorId,
      expiresAt: communityPosts.expiresAt,
      authorEmail: users.email,
      authorName: users.name,
    })
    .from(communityPosts)
    .innerJoin(users, eq(users.id, communityPosts.authorId))
    .where(
      and(
        eq(communityPosts.status, "active"),
        sql`${communityPosts.expiresAt} IS NOT NULL`,
        gt(communityPosts.expiresAt, now),
        lte(communityPosts.expiresAt, expiryWindowEnd)
      )
    );

  let expiryRemindersSent = 0;
  for (const post of expiringSoon) {
    const [already] = await db
      .select({ id: communityNotificationsSent.id })
      .from(communityNotificationsSent)
      .where(
        and(
          eq(communityNotificationsSent.postId, post.id),
          eq(communityNotificationsSent.recipientId, post.authorId),
          eq(communityNotificationsSent.kind, "expiry_reminder")
        )
      )
      .limit(1);

    if (already || !post.authorEmail || !post.expiresAt) continue;

    await db.insert(communityNotificationsSent).values({
      postId: post.id,
      recipientId: post.authorId,
      kind: "expiry_reminder",
    });

    const ok = await sendPostExpiryReminder({
      recipientEmail: post.authorEmail,
      recipientName: post.authorName,
      postTitle: post.title,
      postUrl: `${appUrl()}/komunita`,
      expiresAt: post.expiresAt,
    });
    if (ok) expiryRemindersSent++;
  }

  // Event reminders: 1 day before eventDate, once per recipient
  const eventWindowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const upcomingEvents = await db
    .select({
      id: communityPosts.id,
      title: communityPosts.title,
      eventDate: communityPosts.eventDate,
      eventLocation: communityPosts.eventLocation,
    })
    .from(communityPosts)
    .where(
      and(
        eq(communityPosts.status, "active"),
        eq(communityPosts.type, "event"),
        sql`${communityPosts.eventDate} IS NOT NULL`,
        gt(communityPosts.eventDate, now),
        lte(communityPosts.eventDate, eventWindowEnd)
      )
    );

  let eventRemindersSent = 0;
  for (const post of upcomingEvents) {
    if (!post.eventDate) continue;

    const attendees = await db
      .select({
        userId: users.id,
        email: users.email,
        name: users.name,
      })
      .from(eventRsvps)
      .innerJoin(users, eq(users.id, eventRsvps.userId))
      .where(
        and(eq(eventRsvps.postId, post.id), eq(eventRsvps.status, "yes"))
      );

    for (const att of attendees) {
      if (!att.email) continue;

      const [already] = await db
        .select({ id: communityNotificationsSent.id })
        .from(communityNotificationsSent)
        .where(
          and(
            eq(communityNotificationsSent.postId, post.id),
            eq(communityNotificationsSent.recipientId, att.userId),
            eq(communityNotificationsSent.kind, "event_reminder")
          )
        )
        .limit(1);

      if (already) continue;

      await db.insert(communityNotificationsSent).values({
        postId: post.id,
        recipientId: att.userId,
        kind: "event_reminder",
      });

      const ok = await sendEventReminder({
        recipientEmail: att.email,
        recipientName: att.name,
        eventTitle: post.title,
        eventDate: post.eventDate,
        eventLocation: post.eventLocation,
        postUrl: `${appUrl()}/komunita`,
      });
      if (ok) eventRemindersSent++;
    }
  }

  return {
    ranAt: now.toISOString(),
    expiredByTtl: expiredByTtl.length,
    expiredEvents: expiredEvents.length,
    expiryRemindersSent,
    eventRemindersSent,
  };
}

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

  try {
    const result = await runCron();
    setLastCronRun({ ...result, ok: true });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/community] failed:", error);
    setLastCronRun({
      ranAt: new Date().toISOString(),
      ok: false,
      error: message,
      expiredByTtl: 0,
      expiredEvents: 0,
      expiryRemindersSent: 0,
      eventRemindersSent: 0,
    });
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
