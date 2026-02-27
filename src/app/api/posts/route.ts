import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { posts, users } from "@/db/schema";
import { desc, eq, isNull, or } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const entranceId = searchParams.get("entranceId");

  const conditions = entranceId
    ? or(isNull(posts.entranceId), eq(posts.entranceId, entranceId))
    : undefined;

  const result = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      category: posts.category,
      isPinned: posts.isPinned,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      entranceId: posts.entranceId,
      author: {
        id: users.id,
        name: users.name,
      },
    })
    .from(posts)
    .leftJoin(users, eq(posts.authorId, users.id))
    .where(conditions)
    .orderBy(desc(posts.isPinned), desc(posts.createdAt));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "createPost")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json();
  const { title, content, category, entranceId, isPinned } = body;

  if (!title || !content) {
    return NextResponse.json(
      { error: "Nadpis a obsah sú povinné" },
      { status: 400 }
    );
  }

  const [post] = await db
    .insert(posts)
    .values({
      title,
      content,
      category: category || "info",
      authorId: session.user.id,
      entranceId: entranceId || null,
      isPinned: isPinned || false,
    })
    .returning();

  return NextResponse.json(post, { status: 201 });
}
