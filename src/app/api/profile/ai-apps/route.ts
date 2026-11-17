import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { isMcpEnabled } from "@/lib/mcp/module-state";
import { listUserGrants, revokeUserGrant } from "@/lib/mcp/oauth/tokens";

// Profile → "Connected AI apps" (BYT-20261117-001 §2). Scoped to the
// session user: lists their OAuth grants (one per token family) and
// revokes one — the next MCP call with that grant gets 401.

export async function GET() {
  if (!(await isMcpEnabled())) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const grants = await listUserGrants(session.user.id);
  return NextResponse.json({ grants });
}

export async function DELETE(request: NextRequest) {
  if (!(await isMcpEnabled())) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "validation.id" }, { status: 400 });
  }
  const ok = await revokeUserGrant(session.user.id, id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
