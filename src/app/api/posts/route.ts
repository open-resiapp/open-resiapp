import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createPost, listVisiblePosts } from "@/lib/posts";
import { principalFromSession, viewerFromSession } from "@/lib/mcp/principal";
import { toMcpError } from "@/lib/mcp/errors";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const result = await listVisiblePosts(viewerFromSession(session));
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    // BYT-20261117-001 Decided 1: admin OR active chairman (+ caretaker) —
    // the same assertBoard check the MCP create_announcement tool uses.
    const principal = await principalFromSession(session);
    const post = await createPost(principal, {
      title: body.title,
      content: body.content,
      category: body.category,
      entranceId: body.entranceId,
      isPinned: body.isPinned,
      documentIds: Array.isArray(body.documentIds) ? body.documentIds : [],
    });
    return NextResponse.json(post, { status: 201 });
  } catch (err) {
    const e = toMcpError(err);
    if (e.code === "unauthorized") {
      return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
    }
    if (e.code === "forbidden") {
      return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
    }
    if (e.code.startsWith("validation.")) {
      return NextResponse.json(
        { error: "Nadpis a obsah sú povinné" },
        { status: 400 }
      );
    }
    if (e.code === "community_missing") {
      return NextResponse.json({ error: "Žiadne community root nie je nastavené" }, { status: 500 });
    }
    throw err;
  }
}
