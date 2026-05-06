import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { posts, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { withExternalAuth } from "@/lib/external-auth";

async function handler(_request: NextRequest) {
  const allPosts = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      category: posts.category,
      isPinned: posts.isPinned,
      entityId: posts.entityId,
      authorId: posts.authorId,
      authorName: users.name,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
    })
    .from(posts)
    .leftJoin(users, eq(posts.authorId, users.id))
    .orderBy(desc(posts.isPinned), desc(posts.createdAt));

  return NextResponse.json(allPosts);
}

export const GET = withExternalAuth(handler, "read");
