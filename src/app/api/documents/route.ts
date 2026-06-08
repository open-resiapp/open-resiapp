import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

import { auth } from "@/lib/auth";
import { hasEntityPermission } from "@/lib/permissions-entity";
import { resolveCurrentEntityId } from "@/lib/current-entity";
import { getStorage } from "@/lib/storage";
import { createDocument, listVisibleDocuments } from "@/lib/documents.server";
import {
  ALLOWED_DOCUMENT_MIME,
  MAX_DOCUMENT_SIZE,
  DOCUMENT_TYPES,
  DOCUMENT_AUDIENCES,
  type DocumentType,
  type DocumentAudience,
} from "@/lib/documents";

// GET /api/documents — list documents visible to the user within their
// current entity scope, plus their management capabilities. Visibility is
// resolved per-document by audience + entity line (canSeeDocPath).
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;

  const entityId = await resolveCurrentEntityId(userId);
  if (!entityId) {
    return NextResponse.json({
      entityId: null,
      canUpload: false,
      isManager: false,
      documents: [],
    });
  }

  const [docs, canUpload, isManager] = await Promise.all([
    listVisibleDocuments(userId, entityId),
    hasEntityPermission(userId, entityId, "uploadDocument").catch(() => false),
    hasEntityPermission(userId, entityId, "deleteDocument").catch(() => false),
  ]);

  return NextResponse.json({
    entityId,
    canUpload,
    isManager,
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

// POST /api/documents — upload a document to an entity.
// Multipart form: file, entityId, type, audience, name?, retainUntil?.
// Authorization is entity-scoped: the user must hold upload rights ON the
// target entity (effective role via ancestor membership). BYT-20260512-006.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const entityId = ((formData.get("entityId") as string) || "").trim();
  const type = (formData.get("type") as string) || "";
  const audience = (formData.get("audience") as string) || "";
  const nameInput = ((formData.get("name") as string) || "").trim();
  const retainRaw = ((formData.get("retainUntil") as string) || "").trim();
  const retainUntil = /^\d{4}-\d{2}-\d{2}$/.test(retainRaw) ? retainRaw : null;
  const projectId = ((formData.get("projectId") as string) || "").trim() || null;

  if (!entityId) {
    return NextResponse.json({ error: "Chýba entita" }, { status: 400 });
  }
  if (!DOCUMENT_TYPES.includes(type as DocumentType)) {
    return NextResponse.json({ error: "Neplatný typ dokumentu" }, { status: 400 });
  }
  if (!DOCUMENT_AUDIENCES.includes(audience as DocumentAudience)) {
    return NextResponse.json({ error: "Neplatná viditeľnosť" }, { status: 400 });
  }

  let allowed = false;
  try {
    allowed = await hasEntityPermission(userId, entityId, "uploadDocument");
  } catch {
    return NextResponse.json({ error: "Neplatná entita" }, { status: 400 });
  }
  if (!allowed) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  if (!file) {
    return NextResponse.json({ error: "Súbor je povinný" }, { status: 400 });
  }
  const ext = ALLOWED_DOCUMENT_MIME[file.type];
  if (!ext) {
    return NextResponse.json({ error: "Nepovolený typ súboru" }, { status: 400 });
  }
  if (file.size > MAX_DOCUMENT_SIZE) {
    return NextResponse.json(
      { error: "Maximálna veľkosť súboru je 25 MB" },
      { status: 400 }
    );
  }

  const originalName = file.name || `dokument.${ext}`;
  const name = nameInput || originalName;
  const key = `documents/${entityId}/${crypto.randomUUID()}.${ext}`;

  const buffer = Buffer.from(await file.arrayBuffer());
  await getStorage().put(key, buffer, {
    contentType: file.type,
    filename: originalName,
  });

  const doc = await createDocument({
    entityId,
    uploadedById: userId,
    name,
    storageKey: key,
    originalName,
    mimeType: file.type,
    sizeBytes: file.size,
    type: type as DocumentType,
    audience: audience as DocumentAudience,
    retainUntil,
    projectId,
  });

  return NextResponse.json({ document: doc }, { status: 201 });
}
