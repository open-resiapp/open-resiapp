import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import {
  deleteCommunityPost,
  listCommunityResponses,
  updateCommunityPost,
} from "@/lib/community.server";
import { getVisibleCommunityPost } from "@/lib/feed.server";
import { isMcpError, mcpErrorStatus } from "@/lib/mcp/errors";
import type { UserRole } from "@/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const role = session.user.role as UserRole;
  if (!hasPermission(role, "viewCommunity")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;

  // Same visibility as the board feed and the MCP get_community_post
  // (entrance overlap unless cross-entrance visibility; admin all). A post
  // the viewer may not see answers exactly like a missing one — no probing
  // by id (BYT-20261118-012).
  const post = await getVisibleCommunityPost({ id: session.user.id, role }, id);
  if (!post) {
    return NextResponse.json({ error: "Príspevok neexistuje" }, { status: 404 });
  }

  const responses = await listCommunityResponses(id);
  return NextResponse.json({
    id: post.id,
    type: post.type,
    status: post.status,
    title: post.title,
    content: post.content,
    photoUrl: post.photoUrl,
    responsesAllowed: post.responsesAllowed,
    eventDate: post.eventDate,
    eventLocation: post.eventLocation,
    eventKind: post.eventKind,
    entranceName: post.entranceName,
    expiresAt: post.expiresAt,
    createdAt: post.createdAt,
    author: post.author,
    responses,
    rsvp: post.type === "event" ? post.rsvp : null,
  });
}

// PATCH / DELETE: author or admin — rules in src/lib/community.server.ts,
// shared with the MCP resolve / delete actions (BYT-20261118-012).
function libError(err: unknown) {
  if (isMcpError(err)) {
    return NextResponse.json({ error: err.code }, { status: mcpErrorStatus(err.code) });
  }
  throw err;
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
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const updated = await updateCommunityPost(
      { userId: session.user.id, role: session.user.role as UserRole },
      id,
      { status: body.status, responsesAllowed: body.responsesAllowed }
    );
    return NextResponse.json(updated);
  } catch (err) {
    return libError(err);
  }
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
  try {
    await deleteCommunityPost(
      { userId: session.user.id, role: session.user.role as UserRole },
      id
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return libError(err);
  }
}
