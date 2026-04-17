import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { communityPosts, communityResponses, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { sendCommunityResponseNotification } from "@/lib/email";
import type { UserRole } from "@/types";

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

  const body = await request.json();
  const { content } = body;

  if (!content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "Obsah reakcie je povinný" }, { status: 400 });
  }

  const [response] = await db
    .insert(communityResponses)
    .values({
      postId: id,
      authorId: session.user.id,
      content: content.trim(),
    })
    .returning();

  if (post.authorId !== session.user.id) {
    const [author] = await db
      .select({ email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, post.authorId))
      .limit(1);
    const [responder] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);

    if (author?.email && responder?.name) {
      const appUrl =
        process.env.NEXTAUTH_URL?.replace(/\/$/, "") || "http://localhost:3000";
      sendCommunityResponseNotification({
        recipientEmail: author.email,
        recipientName: author.name,
        responderName: responder.name,
        postTitle: post.title,
        postUrl: `${appUrl}/komunita`,
        responseContent: content.trim(),
      }).catch(() => {});
    }
  }

  return NextResponse.json(response, { status: 201 });
}
