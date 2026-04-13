import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { posts, users, userFlats, flats, entrances } from "@/db/schema";
import { desc, eq, inArray, isNull, or } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { sendPushToAll } from "@/lib/push";
import type { UserRole } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const role = session.user.role as UserRole;
  let conditions;

  // Non-admins only see building-wide posts + posts for their entrances
  if (role !== "admin") {
    const userEntrances = await db
      .select({ entranceId: flats.entranceId })
      .from(userFlats)
      .innerJoin(flats, eq(userFlats.flatId, flats.id))
      .where(eq(userFlats.userId, session.user.id));

    const entranceIds = [...new Set(userEntrances.map((e) => e.entranceId))];

    conditions = entranceIds.length > 0
      ? or(isNull(posts.entranceId), inArray(posts.entranceId, entranceIds))
      : isNull(posts.entranceId);
  }

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
      entranceName: entrances.name,
      author: {
        id: users.id,
        name: users.name,
      },
    })
    .from(posts)
    .leftJoin(users, eq(posts.authorId, users.id))
    .leftJoin(entrances, eq(posts.entranceId, entrances.id))
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

  sendPushToAll(
    { title: "Nový príspevok", body: title, url: "/board" },
    "newPost"
  ).catch(() => {});

  return NextResponse.json(post, { status: 201 });
}
