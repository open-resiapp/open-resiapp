import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  communityPosts,
  communityResponses,
  users,
  entities,
  eventRsvps,
} from "@/db/schema";
import { aliasedTable, and, eq, asc, sql } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { deleteLinksForTarget } from "@/lib/documents.server";
import type { UserRole } from "@/types";

async function getPostById(id: string) {
  const [post] = await db
    .select()
    .from(communityPosts)
    .where(eq(communityPosts.id, id))
    .limit(1);
  return post;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "viewCommunity")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;

  const entrance = aliasedTable(entities, "entrance");
  const [row] = await db
    .select({
      id: communityPosts.id,
      type: communityPosts.type,
      status: communityPosts.status,
      title: communityPosts.title,
      content: communityPosts.content,
      photoUrl: communityPosts.photoUrl,
      responsesAllowed: communityPosts.responsesAllowed,
      eventDate: communityPosts.eventDate,
      eventLocation: communityPosts.eventLocation,
      entityId: communityPosts.entityId,
      entranceName: entrance.name,
      expiresAt: communityPosts.expiresAt,
      createdAt: communityPosts.createdAt,
      updatedAt: communityPosts.updatedAt,
      author: {
        id: users.id,
        name: users.name,
      },
    })
    .from(communityPosts)
    .leftJoin(users, eq(communityPosts.authorId, users.id))
    .leftJoin(entrance, eq(entrance.id, communityPosts.entityId))
    .where(eq(communityPosts.id, id))
    .limit(1);

  if (!row) {
    return NextResponse.json({ error: "Príspevok neexistuje" }, { status: 404 });
  }

  const responses = await db
    .select({
      id: communityResponses.id,
      content: communityResponses.content,
      createdAt: communityResponses.createdAt,
      author: {
        id: users.id,
        name: users.name,
      },
    })
    .from(communityResponses)
    .leftJoin(users, eq(communityResponses.authorId, users.id))
    .where(eq(communityResponses.postId, id))
    .orderBy(asc(communityResponses.createdAt));

  let rsvp: {
    yes: number;
    maybe: number;
    no: number;
    myRsvp: "yes" | "maybe" | "no" | null;
  } | null = null;

  if (row.type === "event") {
    const counts = await db
      .select({
        status: eventRsvps.status,
        count: sql<number>`count(*)::int`,
      })
      .from(eventRsvps)
      .where(eq(eventRsvps.postId, id))
      .groupBy(eventRsvps.status);

    const [mine] = await db
      .select({ status: eventRsvps.status })
      .from(eventRsvps)
      .where(and(eq(eventRsvps.postId, id), eq(eventRsvps.userId, session.user.id)))
      .limit(1);

    rsvp = { yes: 0, maybe: 0, no: 0, myRsvp: mine?.status ?? null };
    for (const row of counts) rsvp[row.status] = row.count;
  }

  return NextResponse.json({ ...row, responses, rsvp });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { id } = await params;
  const post = await getPostById(id);
  if (!post) {
    return NextResponse.json({ error: "Príspevok neexistuje" }, { status: 404 });
  }

  const role = session.user.role as UserRole;
  const isAuthor = post.authorId === session.user.id;
  if (!(role === "admin" || isAuthor)) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json();
  const { status, responsesAllowed } = body;

  const updates: Partial<typeof communityPosts.$inferInsert> = {};

  if (status !== undefined) {
    if (status !== "resolved") {
      return NextResponse.json(
        { error: "Povolený je len prechod na resolved" },
        { status: 400 }
      );
    }
    updates.status = status;
  }

  if (responsesAllowed !== undefined) {
    if (typeof responsesAllowed !== "boolean") {
      return NextResponse.json(
        { error: "responsesAllowed musí byť boolean" },
        { status: 400 }
      );
    }
    updates.responsesAllowed = responsesAllowed;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Žiadna povolená zmena" }, { status: 400 });
  }

  const [updated] = await db
    .update(communityPosts)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(communityPosts.id, id))
    .returning();

  return NextResponse.json(updated);
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
  const post = await getPostById(id);
  if (!post) {
    return NextResponse.json({ error: "Príspevok neexistuje" }, { status: 404 });
  }

  const role = session.user.role as UserRole;
  const isAuthor = post.authorId === session.user.id;
  if (!(role === "admin" || isAuthor)) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  await db.delete(communityPosts).where(eq(communityPosts.id, id));
  await deleteLinksForTarget("community_post", id);
  return NextResponse.json({ ok: true });
}
