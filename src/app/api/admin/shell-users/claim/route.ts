import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { createShellClaim } from "@/lib/invitations";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasPermission(session.user.role as UserRole, "manageUsers")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    shellId?: unknown;
    email?: unknown;
    mode?: unknown;
    locale?: unknown;
  };

  const shellId = typeof body.shellId === "string" ? body.shellId : "";
  const mode =
    body.mode === "email" || body.mode === "qr"
      ? (body.mode as "email" | "qr")
      : null;
  const setEmail = typeof body.email === "string" ? body.email : undefined;
  const locale = typeof body.locale === "string" ? body.locale : undefined;

  if (!shellId || !mode) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    const result = await createShellClaim({
      shellUserId: shellId,
      createdById: session.user.id,
      mode,
      setEmail,
      locale,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "claim_failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
