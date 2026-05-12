import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { mergeShellIntoUser, ShellMergeError } from "@/lib/shell-merge";
import type { UserRole } from "@/types";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id: shellId } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    targetUserId?: unknown;
  };
  const targetUserId =
    typeof body.targetUserId === "string" ? body.targetUserId : "";
  if (!targetUserId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const result = await mergeShellIntoUser(
      shellId,
      targetUserId,
      session.user.id
    );
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if (err instanceof ShellMergeError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "merge_failed" }, { status: 500 });
  }
}
