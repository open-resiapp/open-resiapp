import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { communityPosts, communityResponses, users, entrances } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
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

  const [row] = await db
    .select({
      id: communityPosts.id,
      type: communityPosts.type,
      status: communityPosts.status,
      title: communityPosts.title,
      content: communityPosts.content,
      photoUrl: communityPosts.photoUrl,
      eventDate: communityPosts.eventDate,
      eventLocation: communityPosts.eventLocation,
      entranceId: communityPosts.entranceId,
      entranceName: entrances.name,
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
    .leftJoin(entrances, eq(communityPosts.entranceId, entrances.id))
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

  return NextResponse.json({ ...row, responses });
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
  const { status } = body;

  if (status !== "resolved") {
    return NextResponse.json(
      { error: "Povolený je len prechod na resolved" },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(communityPosts)
    .set({ status, updatedAt: new Date() })
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
  return NextResponse.json({ ok: true });
}
