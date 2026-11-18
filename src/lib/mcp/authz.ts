import "server-only";

import { auth } from "@/lib/auth";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { McpError } from "./errors";
import { principalFromSession, type Principal, type Scope } from "./principal";

// Core assert helpers (BYT-20261117-001 §3). Each throws McpError — never
// returns a NextResponse — so tools and UI routes share them. Accounting
// asserts (assertReader / assertWriter / assertApprover / assertUnitLedger)
// live in modules/accounting/src/lib/authz-assert.ts so core never imports
// the accounting module.

/** status !== active → forbidden for every tool. */
export function assertActive(p: Principal): void {
  if (p.status !== "active") {
    throw new McpError("forbidden", { reason: "inactive_user" });
  }
}

/** Every listed scope must be granted; reports ALL missing ones at once. */
export function assertScopes(p: Principal, required: readonly Scope[]): void {
  const missing = required.filter((s) => !p.scopes.includes(s));
  if (missing.length > 0) {
    throw new McpError("scope_required", { missing });
  }
}

/**
 * Board authority for governance writes (announcements, voting drafts):
 * flat `admin` OR an active `chairman` board role. `allowCaretaker` keeps the
 * caretaker's existing right to post announcements (spec Notes → Decided 1).
 */
export function isBoard(
  p: Pick<Principal, "role" | "boardRoles">,
  opts: { allowCaretaker?: boolean } = {}
): boolean {
  if (p.role === "admin") return true;
  if (p.boardRoles.includes("chairman")) return true;
  if (opts.allowCaretaker && p.role === "caretaker") return true;
  return false;
}

export function assertBoard(
  p: Principal,
  opts: { allowCaretaker?: boolean } = {}
): void {
  assertActive(p);
  if (!isBoard(p, opts)) throw new McpError("forbidden");
}

/**
 * Who may edit / pin / delete board notices — same authority as creating one
 * (assertBoard with caretaker: admin, active chairman, caretaker). Admins
 * and holders of an active board role manage every notice; a caretaker
 * without a board role only the notices they wrote. Used by
 * PATCH/DELETE /api/posts/[id] and the board page viewer caps.
 */
export function noticeManageScope(
  p: Pick<Principal, "role" | "status" | "boardRoles">
): "all" | "own" | null {
  if (p.status !== "active") return null;
  if (!isBoard(p, { allowCaretaker: true })) return null;
  if (p.role === "admin" || p.boardRoles.length > 0) return "all";
  return "own";
}

export async function assertModuleEnabled(
  name: "accounting" | "voting" | "mcp" | (string & {})
): Promise<void> {
  if (!(await isModuleEnabled(name))) {
    throw new McpError("module_disabled", { module: name });
  }
}

/**
 * Server-component helper for UI gating: does the signed-in user pass
 * `assertBoard`? Lets pages show "new post" / "new voting" to a chairman
 * without flat admin (Decided 1). False when signed out / no community.
 */
export async function sessionIsBoard(
  opts: { allowCaretaker?: boolean } = {}
): Promise<boolean> {
  const session = await auth();
  if (!session) return false;
  try {
    const p = await principalFromSession(session);
    return p.status === "active" && isBoard(p, opts);
  } catch {
    return false;
  }
}
