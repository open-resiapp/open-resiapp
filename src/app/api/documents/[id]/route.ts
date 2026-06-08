import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import { getStorage } from "@/lib/storage";
import {
  getViewableDocument,
  getManageableDocument,
  softDeleteDocument,
  logDocumentAccess,
  assignDocumentToProject,
} from "@/lib/documents.server";

// GET /api/documents/[id] — auth-gated proxy download. Visibility resolved via
// canSeeDocPath (audience + entity line); every access is logged. No signed
// URLs — these are private/GDPR docs. BYT-20260512-006.
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

// DELETE /api/documents/[id] — soft delete (retention-preserving). Permitted
// for the uploader OR a user with delete rights on the document's entity.
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

  const doc = await getManageableDocument(id);
  if (!doc) {
    return NextResponse.json({ error: "Dokument nenájdený" }, { status: 404 });
  }

  const canManage =
    doc.uploadedById === userId ||
    hasPermission(session.user.role as UserRole, "deleteDocument");
  if (!canManage) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  await softDeleteDocument(doc.id);
  return new NextResponse(null, { status: 204 });
}

// PATCH /api/documents/[id] — assign/unassign the document to a project.
// Body: { projectId: string | null }. Permitted for uploader OR a user with
// upload rights on the document's entity.
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

  const doc = await getManageableDocument(id);
  if (!doc) {
    return NextResponse.json({ error: "Dokument nenájdený" }, { status: 404 });
  }

  const canManage =
    doc.uploadedById === userId ||
    hasPermission(session.user.role as UserRole, "uploadDocument");
  if (!canManage) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const projectId = body.projectId ? String(body.projectId) : null;
  await assignDocumentToProject(id, projectId);
  return NextResponse.json({ ok: true });
}
