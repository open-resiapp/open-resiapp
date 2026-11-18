import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";
import { resolveCurrentEntityId } from "@/lib/current-entity";
import { listSubjectCandidates } from "@/lib/documents.server";

// GET /api/documents/subjects — owners (per unit) the board may file a
// document under ("Komu patrí → Vlastník"). BYT-20261118-005. Board only.
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const entityId = await resolveCurrentEntityId(session.user.id);
  if (!entityId) return NextResponse.json({ candidates: [] });
  return NextResponse.json({ candidates: await listSubjectCandidates(entityId) });
}
