import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { posts, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Session } from "next-auth";
import { deleteLinksForTarget } from "@/lib/documents.server";
import { noticeManageScope } from "@/lib/mcp/authz";
import { McpError } from "@/lib/mcp/errors";
import { principalFromSession, viewerFromSession } from "@/lib/mcp/principal";
import { getVisiblePost } from "@/lib/posts";

/**
 * Who may edit / pin / delete a board notice — the same authority as
 * creating one (admin, active chairman, caretaker; see noticeManageScope):
 * admins and board members any notice, a caretaker only the notices they
 * wrote. Mirrored in the board page (FeedViewerCaps.canManageAllNotices).
 */
async function checkNoticeAccess(
  session: Session,
  postId: string
): Promise<"ok" | "forbidden" | "not_found"> {
  let scope: "all" | "own" | null;
  try {
    scope = noticeManageScope(await principalFromSession(session));
  } catch (err) {
    if (err instanceof McpError) return "forbidden";
    throw err;
  }
  if (!scope) return "forbidden";
  const [post] = await db
    .select({ authorId: posts.authorId })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  if (!post) return "not_found";
  if (scope === "all" || post.authorId === session.user.id) return "ok";
  return "forbidden";
}

function accessError(result: "forbidden" | "not_found") {
  return result === "not_found"
    ? NextResponse.json({ error: "Príspevok nenájdený" }, { status: 404 })
    : NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { id } = await params;

  // Same visibility as the notice board / MCP get_announcement: a notice
  // scoped to another entrance answers like a missing one (BYT-20261118-012).
  if (!(await getVisiblePost(viewerFromSession(session), id))) {
    return NextResponse.json({ error: "Príspevok nenájdený" }, { status: 404 });
  }

  const [post] = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      category: posts.category,
      isPinned: posts.isPinned,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      entityId: posts.entityId,
      author: {
        id: users.id,
        name: users.name,
      },
    })
    .from(posts)
    .leftJoin(users, eq(posts.authorId, users.id))
    .where(eq(posts.id, id))
    .limit(1);

  if (!post) {
    return NextResponse.json({ error: "Príspevok nenájdený" }, { status: 404 });
  }

  return NextResponse.json(post);
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
  const access = await checkNoticeAccess(session, id);
  if (access !== "ok") return accessError(access);
  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.title !== undefined) updateData.title = body.title;
  if (body.content !== undefined) updateData.content = body.content;
  if (body.category !== undefined) updateData.category = body.category;
  if (body.isPinned !== undefined) updateData.isPinned = body.isPinned;
  updateData.updatedAt = new Date();

  const [updated] = await db
    .update(posts)
    .set(updateData)
    .where(eq(posts.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Príspevok nenájdený" }, { status: 404 });
  }

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
  const access = await checkNoticeAccess(session, id);
  if (access !== "ok") return accessError(access);

  const [deleted] = await db
    .delete(posts)
    .where(eq(posts.id, id))
    .returning({ id: posts.id });

  if (!deleted) {
    return NextResponse.json({ error: "Príspevok nenájdený" }, { status: 404 });
  }

  await deleteLinksForTarget("board_post", id);

  return NextResponse.json({ success: true });
}
