import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  getDocumentWithPath,
  getUserNames,
  isBoardForPath,
  listDocumentAudit,
} from "@/lib/documents.server";

// GET /api/documents/[id]/audit — board-only mutation trail of a document
// (upload / visibility / subject / delete / e-mail). BYT-20261118-005.
// Non-board callers get 404 — they must not learn the trail exists.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const found = await getDocumentWithPath(id);
  if (!found || !(await isBoardForPath(session.user.id, found.path))) {
    return NextResponse.json(
      { error: "document.not_found", code: "document.not_found" },
      { status: 404 }
    );
  }

  const entries = await listDocumentAudit(id);
  // Resolve person ids inside before/after (subject, recipient) to names.
  const personIds: string[] = [];
  for (const e of entries) {
    for (const j of [e.before, e.after]) {
      for (const k of ["subjectUserId", "recipientUserId"]) {
        const v = j?.[k];
        if (typeof v === "string") personIds.push(v);
      }
    }
  }
  const names = await getUserNames(personIds);
  const nameOf = (v: unknown) =>
    typeof v === "string" ? names.get(v) ?? null : null;

  return NextResponse.json({
    entries: entries.map((e) => ({
      id: e.id,
      action: e.action,
      actorName: e.actorName,
      createdAt: e.createdAt,
      before: {
        audience: e.before?.audience ?? null,
        subjectName: nameOf(e.before?.subjectUserId),
      },
      after: {
        audience: e.after?.audience ?? null,
        subjectName: nameOf(e.after?.subjectUserId),
        recipientName: nameOf(e.after?.recipientUserId),
        mode: e.after?.mode ?? null,
      },
    })),
  });
}
