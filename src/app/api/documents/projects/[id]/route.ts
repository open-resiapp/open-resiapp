import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { canManageEntity } from "@/lib/permissions-entity";
import type { UserRole } from "@/types";
import {
  getProject,
  getViewableProject,
  listProjectDocuments,
  updateProject,
  deleteProject,
} from "@/lib/documents.server";
import {
  DOCUMENT_AUDIENCES,
  DOCUMENT_PROJECT_STATUSES,
  type DocumentAudience,
  type DocumentProjectStatus,
} from "@/lib/documents";

// GET /api/documents/projects/[id] — project + its documents visible to the user.
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

  const project = await getViewableProject(userId, id);
  if (!project) {
    return NextResponse.json({ error: "Projekt nenájdený" }, { status: 404 });
  }

  const docs = await listProjectDocuments(userId, id);
  return NextResponse.json({
    project,
    documents: docs.map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      audience: d.audience,
      mimeType: d.mimeType,
      sizeBytes: d.sizeBytes,
      originalName: d.originalName,
      retainUntil: d.retainUntil,
      createdAt: d.createdAt,
      projectId: d.projectId,
      uploaderName: d.uploaderName,
      isUploader: d.uploadedById === userId,
    })),
  });
}

// PATCH /api/documents/projects/[id] — update title/description/audience/status.
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

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Projekt nenájdený" }, { status: 404 });
  }
  const allowed = await canManageEntity(
    session.user.role as UserRole,
    userId,
    project.entityId,
    "uploadDocument"
  );
  if (!allowed) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const patch: {
    title?: string;
    description?: string | null;
    audience?: DocumentAudience;
    status?: DocumentProjectStatus;
  } = {};
  if (typeof body.title === "string" && body.title.trim()) {
    patch.title = body.title.trim();
  }
  if (typeof body.description === "string") {
    patch.description = body.description.trim() || null;
  }
  if ((DOCUMENT_AUDIENCES as readonly string[]).includes(body.audience)) {
    patch.audience = body.audience as DocumentAudience;
  }
  if ((DOCUMENT_PROJECT_STATUSES as readonly string[]).includes(body.status)) {
    patch.status = body.status as DocumentProjectStatus;
  }
  await updateProject(id, patch);
  return NextResponse.json({ ok: true });
}

// DELETE /api/documents/projects/[id] — delete project; its docs revert to
// standalone (project_id set null via FK).
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

  const project = await getProject(id);
  if (!project) {
    return NextResponse.json({ error: "Projekt nenájdený" }, { status: 404 });
  }
  const allowed = await canManageEntity(
    session.user.role as UserRole,
    userId,
    project.entityId,
    "deleteDocument"
  );
  if (!allowed) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  await deleteProject(id);
  return new NextResponse(null, { status: 204 });
}
