import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import { listOwnerFolderDocuments } from "@/lib/documents.server";

// GET /api/documents/folder[?ownerId=] — owner folder (BYT-20261118-005).
// Without ownerId: the caller's own "Moje dokumenty" (subject = self + docs on
// the units they own), filtered by the resolver — never "Len výbor" docs.
// With ownerId ≠ self: board view of that owner's folder (manageUsers), still
// filtered per document by the caller's own memberships.
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const ownerId = new URL(request.url).searchParams.get("ownerId") || userId;
  const isBoardView = ownerId !== userId;
  if (isBoardView && !hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const docs = await listOwnerFolderDocuments(userId, ownerId);
  return NextResponse.json({
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
      isMine: d.subjectUserId === userId,
      entityId: isBoardView ? d.entityId : null,
      subjectUserId: isBoardView ? d.subjectUserId : null,
      subjectName: isBoardView ? d.subjectName : null,
    })),
  });
}
