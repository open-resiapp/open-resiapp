import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  getCurrentEntityIdFromCookie,
  setCurrentEntityIdCookie,
  resolveCurrentEntityId,
} from "@/lib/current-entity";
import { listUserRoots } from "@/lib/entity-tree";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const cookieValue = await getCurrentEntityIdFromCookie();
  const resolved = await resolveCurrentEntityId(session.user.id);
  return NextResponse.json({ cookieValue, resolved });
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  const body = await request.json();
  const { entityId } = body ?? {};
  if (typeof entityId !== "string" || entityId.length === 0) {
    return NextResponse.json({ error: "entityId required" }, { status: 400 });
  }
  // Verify the user actually has a membership reaching the requested
  // root — never trust a client-supplied id at face value.
  const roots = await listUserRoots(session.user.id);
  if (!roots.some((r) => r.id === entityId)) {
    return NextResponse.json(
      { error: "no membership at the requested entity" },
      { status: 403 }
    );
  }
  await setCurrentEntityIdCookie(entityId);
  return NextResponse.json({ success: true, entityId });
}
