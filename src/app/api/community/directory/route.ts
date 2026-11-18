import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import {
  deleteDirectoryEntry,
  listDirectory,
  upsertDirectoryEntry,
} from "@/lib/community.server";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { isMcpError, mcpErrorStatus } from "@/lib/mcp/errors";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

// Directory (adresár). Queries + validation live in src/lib/community.server.ts,
// shared with the MCP directory tools (BYT-20261118-012).

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "viewDirectory")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const root = await getCommunityRoot();
  if (!root) return NextResponse.json([]);
  return NextResponse.json(await listDirectory(root.id));
}

export async function PUT(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const { entry, created } = await upsertDirectoryEntry(
      { userId: session.user.id, role: session.user.role as UserRole },
      {
        sharePhone: body.sharePhone === true,
        shareEmail: body.shareEmail === true,
        note: typeof body.note === "string" ? body.note : null,
        skills: typeof body.skills === "string" ? body.skills : null,
      }
    );
    return NextResponse.json(entry, { status: created ? 201 : 200 });
  } catch (err) {
    if (isMcpError(err)) {
      return NextResponse.json({ error: err.code }, { status: mcpErrorStatus(err.code) });
    }
    throw err;
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  await deleteDirectoryEntry(session.user.id);

  return NextResponse.json({ ok: true });
}
