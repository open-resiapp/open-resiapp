import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { canManageEntity } from "@/lib/permissions-entity";
import type { UserRole } from "@/types";
import {
  linkDocumentToTarget,
  unlinkDocument,
  listTargetDocuments,
  resolveTargetEntityId,
} from "@/lib/documents.server";
import { DOCUMENT_LINK_TARGETS, type DocumentLinkTarget } from "@/lib/documents";

// Generic document↔target attachment API. BYT-20260608-001 Phase B. Targets are
// posts (board or community); a voting links a Project instead (Phase C).

function parseTarget(v: string | null | undefined): DocumentLinkTarget | null {
  return v && (DOCUMENT_LINK_TARGETS as readonly string[]).includes(v)
    ? (v as DocumentLinkTarget)
    : null;
}

function toDTO(d: Awaited<ReturnType<typeof listTargetDocuments>>[number], userId: string) {
  return {
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
  };
}

// GET /api/document-links?targetType=&targetId= — documents attached to a target.
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;
  const { searchParams } = new URL(request.url);
  const targetType = parseTarget(searchParams.get("targetType"));
  const targetId = searchParams.get("targetId");
  if (!targetType || !targetId) {
    return NextResponse.json({ error: "Neplatný cieľ" }, { status: 400 });
  }
  const docs = await listTargetDocuments(userId, targetType, targetId);
  return NextResponse.json({ documents: docs.map((d) => toDTO(d, userId)) });
}

// POST /api/document-links { targetType, targetId, documentId } — attach.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;
  const body = await request.json().catch(() => ({}));
  const targetType = parseTarget(body.targetType);
  const targetId = body.targetId ? String(body.targetId) : null;
  const documentId = body.documentId ? String(body.documentId) : null;
  if (!targetType || !targetId || !documentId) {
    return NextResponse.json({ error: "Neplatné parametre" }, { status: 400 });
  }

  const entityId = await resolveTargetEntityId(targetType, targetId);
  if (!entityId) {
    return NextResponse.json({ error: "Cieľ nenájdený" }, { status: 404 });
  }
  const allowed = await canManageEntity(
    session.user.role as UserRole,
    userId,
    entityId,
    "uploadDocument"
  );
  if (!allowed) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  await linkDocumentToTarget(documentId, targetType, targetId);
  return NextResponse.json({ ok: true }, { status: 201 });
}

// DELETE /api/document-links?targetType=&targetId=&documentId= — detach.
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;
  const { searchParams } = new URL(request.url);
  const targetType = parseTarget(searchParams.get("targetType"));
  const targetId = searchParams.get("targetId");
  const documentId = searchParams.get("documentId");
  if (!targetType || !targetId || !documentId) {
    return NextResponse.json({ error: "Neplatné parametre" }, { status: 400 });
  }

  const entityId = await resolveTargetEntityId(targetType, targetId);
  if (!entityId) {
    return NextResponse.json({ error: "Cieľ nenájdený" }, { status: 404 });
  }
  const allowed = await canManageEntity(
    session.user.role as UserRole,
    userId,
    entityId,
    "uploadDocument"
  );
  if (!allowed) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  await unlinkDocument(documentId, targetType, targetId);
  return new NextResponse(null, { status: 204 });
}
