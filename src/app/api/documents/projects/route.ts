import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import { resolveCurrentEntityId } from "@/lib/current-entity";
import { createProject, listVisibleProjects } from "@/lib/documents.server";
import {
  DOCUMENT_AUDIENCES,
  DOCUMENT_PROJECT_STATUSES,
  type DocumentAudience,
  type DocumentProjectStatus,
} from "@/lib/documents";

// GET /api/documents/projects — projects visible in the current entity scope,
// with document counts + the caller's management capability. BYT-20260608-001.
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;

  const entityId = await resolveCurrentEntityId(userId);
  if (!entityId) {
    return NextResponse.json({ entityId: null, canManage: false, projects: [] });
  }

  const projects = await listVisibleProjects(userId, entityId);
  const canManage = hasPermission(session.user.role as UserRole, "uploadDocument");
  return NextResponse.json({ entityId, canManage, projects });
}

// POST /api/documents/projects — create a project in the current entity.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const userId = session.user.id;

  const entityId = await resolveCurrentEntityId(userId);
  if (!entityId) {
    return NextResponse.json({ error: "Chýba entita" }, { status: 400 });
  }
  if (!hasPermission(session.user.role as UserRole, "uploadDocument")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const title = (typeof body.title === "string" ? body.title : "").trim();
  if (!title) {
    return NextResponse.json({ error: "Názov je povinný" }, { status: 400 });
  }
  const audience: DocumentAudience = (
    DOCUMENT_AUDIENCES as readonly string[]
  ).includes(body.audience)
    ? (body.audience as DocumentAudience)
    : "owner";
  const status: DocumentProjectStatus = (
    DOCUMENT_PROJECT_STATUSES as readonly string[]
  ).includes(body.status)
    ? (body.status as DocumentProjectStatus)
    : "active";
  const description =
    (typeof body.description === "string" ? body.description : "").trim() || null;
  const ec = Number(body.estimatedCost);
  const estimatedCost = Number.isFinite(ec) && ec > 0 ? Math.round(ec) : null;
  const fundingNote =
    (typeof body.fundingNote === "string" ? body.fundingNote : "").trim() || null;

  const project = await createProject({
    entityId,
    title,
    description,
    audience,
    status,
    estimatedCost,
    fundingNote,
  });
  return NextResponse.json({ project }, { status: 201 });
}
