import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { resolveCurrentEntityId } from "@/lib/current-entity";
import { listPendingShellUsers } from "@/lib/invitations";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const rootId = await resolveCurrentEntityId(session.user.id);
  if (!rootId) {
    return NextResponse.json({ shells: [] });
  }

  const shells = await listPendingShellUsers(rootId);
  return NextResponse.json({ shells });
}
