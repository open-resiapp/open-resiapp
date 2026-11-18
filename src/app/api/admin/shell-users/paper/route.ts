import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { setPaperOnly } from "@/lib/invitations";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

// PATCH { userId, paperOnly } — board flag "len papierová komunikácia".
// Explicit set (true / false), so the flag can always be cleared again.
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    userId?: unknown;
    paperOnly?: unknown;
  };
  if (typeof body.userId !== "string" || typeof body.paperOnly !== "boolean") {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const ok = await setPaperOnly(body.userId, body.paperOnly);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, paperOnly: body.paperOnly });
}
