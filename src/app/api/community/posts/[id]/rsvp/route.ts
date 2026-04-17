import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { communityPosts, eventRsvps } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

const VALID_STATUSES = ["yes", "no", "maybe"] as const;
type RsvpStatus = (typeof VALID_STATUSES)[number];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "respondToCommunityPost")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;
  const [post] = await db
    .select()
    .from(communityPosts)
    .where(eq(communityPosts.id, id))
    .limit(1);

  if (!post) {
    return NextResponse.json({ error: "Príspevok neexistuje" }, { status: 404 });
  }
  if (post.type !== "event") {
    return NextResponse.json(
      { error: "RSVP je dostupné len pre udalosti" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const status = body.status as RsvpStatus;
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Neplatný RSVP status" }, { status: 400 });
  }

  const [existing] = await db
    .select()
    .from(eventRsvps)
    .where(
      and(eq(eventRsvps.postId, id), eq(eventRsvps.userId, session.user.id))
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(eventRsvps)
      .set({ status, updatedAt: new Date() })
      .where(eq(eventRsvps.id, existing.id))
      .returning();
    return NextResponse.json(updated);
  }

  const [created] = await db
    .insert(eventRsvps)
    .values({
      postId: id,
      userId: session.user.id,
      status,
    })
    .returning();
  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { id } = await params;
  await db
    .delete(eventRsvps)
    .where(
      and(eq(eventRsvps.postId, id), eq(eventRsvps.userId, session.user.id))
    );

  return NextResponse.json({ ok: true });
}
