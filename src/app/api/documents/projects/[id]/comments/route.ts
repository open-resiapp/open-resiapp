import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import {
  getViewableProject,
  createProjectComment,
  getProjectComment,
  deleteProjectComment,
} from "@/lib/documents.server";

// POST /api/documents/projects/[id]/comments { content } — add to the project's
// discussion thread. Anyone who can view the project may comment.
// BYT-20260608-001 (project workspace).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const project = await getViewableProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Projekt nenájdený" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const content = (typeof body.content === "string" ? body.content : "").trim();
  if (!content) {
    return NextResponse.json({ error: "Prázdny komentár" }, { status: 400 });
  }

  await createProjectComment(id, userId, content.slice(0, 5000));
  return NextResponse.json({ ok: true }, { status: 201 });
}

// DELETE /api/documents/projects/[id]/comments?commentId= — author or admin.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;
  await params; // route scope; the comment is identified by commentId

  const { searchParams } = new URL(request.url);
  const commentId = searchParams.get("commentId");
  if (!commentId) {
    return NextResponse.json({ error: "Chýba komentár" }, { status: 400 });
  }

  const comment = await getProjectComment(commentId);
  if (!comment) {
    return NextResponse.json({ error: "Komentár nenájdený" }, { status: 404 });
  }

  const canDelete =
    comment.authorId === userId ||
    hasPermission(session.user.role as UserRole, "deleteDocument");
  if (!canDelete) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  await deleteProjectComment(commentId);
  return new NextResponse(null, { status: 204 });
}
