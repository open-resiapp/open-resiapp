import "server-only";

import { NextResponse } from "next/server";
import type { Session } from "next-auth";

import { auth } from "@/lib/auth";
import { getCommunityRoot, type CommunityRootRow } from "@/lib/legacy-compat";
import { canReadAccounting, canWriteAccounting } from "./authz";

// Shared API guards for accounting routes. Every route resolves the
// session + community root and runs the board-role check BEFORE any other
// DB read (spec §Permissions) — under-privileged requests get 403.

export type GuardCtx =
  | { ok: false; error: NextResponse }
  | { ok: true; session: Session; root: CommunityRootRow };

async function require(
  check: (
    userId: string,
    userRole: string,
    entityId: string
  ) => Promise<boolean>
): Promise<GuardCtx> {
  const session = await auth();
  if (!session) {
    return {
      ok: false,
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  const root = await getCommunityRoot();
  if (!root) {
    return {
      ok: false,
      error: NextResponse.json({ error: "no community" }, { status: 404 }),
    };
  }
  const allowed = await check(
    session.user.id,
    session.user.role as string,
    root.id
  );
  if (!allowed) {
    return {
      ok: false,
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, session, root };
}

/** Treasurer / admin — full write access to the dom's books. */
export function requireWriter(): Promise<GuardCtx> {
  return require(canWriteAccounting);
}

/** Treasurer / chairman / admin — whole-dom financial read access. */
export function requireReader(): Promise<GuardCtx> {
  return require(canReadAccounting);
}
