import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import {
  getViewableProject,
  setProjectInterest,
  clearProjectInterest,
} from "@/lib/documents.server";

// POST /api/documents/projects/[id]/interest { stance: "up" | "down" | null }
// Casual pre-vote reaction (anketa). Owners only (the `vote` permission). A
// null/absent stance clears the reaction. Advisory — not a legal vote.
// BYT-20260608-001.
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
  // Owners (legal voters) only — matches the §14 voter set.
  if (!hasPermission(session.user.role as UserRole, "vote")) {
    return NextResponse.json({ error: "Iba vlastníci" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const stance = body.stance;
  if (stance === "up" || stance === "down") {
    await setProjectInterest(id, userId, stance);
  } else {
    await clearProjectInterest(id, userId);
  }
  return NextResponse.json({ ok: true });
}
