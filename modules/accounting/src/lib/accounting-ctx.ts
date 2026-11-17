import "server-only";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import type { CommunityRootRow } from "@/lib/legacy-compat";
import { isMcpError } from "@/lib/mcp/errors";
import {
  loadPrincipalContext,
  principalContextFromSession,
  type Principal,
  type Scope,
} from "@/lib/mcp/principal";

// Principal-based context for accounting routes that serve BOTH owners and
// board roles (karta bytu, meters) — replaces the per-file `baseCtx()`
// copies (BYT-20261117-001 §3). Handlers read `principal.userId` /
// `principal.role` (live users.role) instead of the session, so the same
// handler body works for an MCP principal.

export interface AccountingCtx {
  principal: Principal;
  root: CommunityRootRow;
}

export type SessionAccountingCtx =
  | { error: NextResponse; principal?: never; root?: never }
  | ({ error?: never } & AccountingCtx);

/** UI routes: session → principal + root, or the route's 401 / 404. */
export async function sessionAccountingCtx(): Promise<SessionAccountingCtx> {
  const session = await auth();
  if (!session) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  try {
    return await principalContextFromSession(session);
  } catch (err) {
    if (isMcpError(err) && err.code === "community_missing") {
      return {
        error: NextResponse.json({ error: "no community" }, { status: 404 }),
      };
    }
    if (isMcpError(err) && err.code === "unauthorized") {
      return {
        error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
      };
    }
    throw err;
  }
}

/** MCP tools: token user → principal + root (throws McpError). */
export function accountingCtxForUser(
  userId: string,
  opts: { scopes: readonly Scope[]; clientId: string | null }
): Promise<AccountingCtx> {
  return loadPrincipalContext(userId, opts);
}
