import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import { getStorage } from "@/lib/storage";
import {
  getViewableDocument,
  getDocumentWithPath,
  isBoardForPath,
  isOwnerOnPath,
  softDeleteDocument,
  logDocumentAccess,
  assignDocumentToProject,
  updateDocumentVisibility,
} from "@/lib/documents.server";
import {
  DOCUMENT_AUDIENCES,
  type DocumentAudience,
  type DocumentErrorCode,
} from "@/lib/documents";

function fail(code: DocumentErrorCode, status: number) {
  return NextResponse.json({ error: code, code }, { status });
}

// GET /api/documents/[id] — auth-gated proxy download. Visibility resolved via
// canSeeDocPath (audience + entity line + owner folder); every access is
// logged. No signed URLs — these are private/GDPR docs. BYT-20260512-006,
// BYT-20261118-005.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const doc = await getViewableDocument(userId, id);
  if (!doc) {
    // 404 for both missing and forbidden — don't leak existence.
    return NextResponse.json({ error: "Dokument nenájdený" }, { status: 404 });
  }

  const obj = await getStorage().get(doc.storageKey);
  if (!obj) {
    return NextResponse.json({ error: "Súbor nenájdený" }, { status: 404 });
  }

  await logDocumentAccess(doc.id, userId, doc.entityId);

  const filename = encodeURIComponent(doc.originalName || doc.name);
  // Wrap in a concrete Uint8Array<ArrayBuffer>: @types/node types Buffer as
  // Buffer<ArrayBufferLike>, which is not assignable to BodyInit.
  return new NextResponse(new Uint8Array(obj.body), {
    headers: {
      "Content-Type": doc.mimeType || obj.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "Cache-Control": "private, no-store",
    },
  });
}

// DELETE /api/documents/[id] — soft delete (retention-preserving), audited.
// Board (admin on the doc's line) or a global deleteDocument holder; the
// uploader only while they can still SEE the document (G3: a caretaker who
// filed a doc as "Len výbor" no longer manages it).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const found = await getDocumentWithPath(id);
  if (!found) return fail("document.not_found", 404);
  const { doc, path } = found;

  const isBoard =
    (await isBoardForPath(userId, path)) ||
    hasPermission(session.user.role as UserRole, "deleteDocument");
  if (!isBoard) {
    const canSee = !!(await getViewableDocument(userId, id));
    // Invisible ⇒ 404 (don't confirm existence); visible but not theirs ⇒ 403.
    if (!canSee) return fail("document.not_found", 404);
    if (doc.uploadedById !== userId) return fail("document.forbidden", 403);
  }

  await softDeleteDocument(doc.id, userId);
  return new NextResponse(null, { status: 204 });
}

// PATCH /api/documents/[id]
// Body: { projectId?: string | null, audience?: DocumentAudience,
//         subjectUserId?: string | null }
// - projectId: board, or the uploader while they can still see the doc and
//   hold uploadDocument (unchanged behaviour minus the G3 hole).
// - audience / subjectUserId: BOARD ONLY (admin membership on the doc line);
//   the uploader shortcut never applies. Each change is audited. Widening
//   never notifies anyone (BYT-20261118-005).
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const found = await getDocumentWithPath(id);
  if (!found) return fail("document.not_found", 404);
  const { doc, path } = found;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const isBoard = await isBoardForPath(userId, path);

  // Authorize every requested change before applying any of them.
  if ("projectId" in body && !isBoard) {
    const canAssign =
      (doc.uploadedById === userId ||
        hasPermission(session.user.role as UserRole, "uploadDocument")) &&
      !!(await getViewableDocument(userId, id));
    if (!canAssign) return fail("document.forbidden", 403);
  }

  const touchesVisibility = "audience" in body || "subjectUserId" in body;
  if (touchesVisibility) {
    if (!isBoard) return fail("document.forbidden", 403);

    let audience: DocumentAudience | undefined;
    if ("audience" in body) {
      if (!DOCUMENT_AUDIENCES.includes(body.audience as DocumentAudience)) {
        return fail("document.audience.invalid", 400);
      }
      audience = body.audience as DocumentAudience;
    }

    let subjectUserId: string | null | undefined;
    if ("subjectUserId" in body) {
      subjectUserId = body.subjectUserId ? String(body.subjectUserId) : null;
      if (subjectUserId && !(await isOwnerOnPath(subjectUserId, path))) {
        return fail("document.subject.not_owner", 400);
      }
    }

    await updateDocumentVisibility(doc, userId, { audience, subjectUserId });
  }

  if ("projectId" in body) {
    await assignDocumentToProject(id, body.projectId ? String(body.projectId) : null);
  }

  return NextResponse.json({ ok: true });
}
