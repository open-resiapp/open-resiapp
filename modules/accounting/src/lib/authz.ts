import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { boardMembers } from "@/db/schema";
import { boardRoleInForce } from "@/lib/user-context";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

// Accounting authorization (docs/domain/accounting.md scope rule):
// treasurer/chairman authority comes from the community's BOARD role
// (board_members), not the global user role. `admin` (the operator
// account) keeps full access. Separation of duties:
//   - write (predpis, payments, expenses, opening balance): treasurer, admin
//   - read + approvals (závierka, expense authorisation): + chairman
// Every server action / API route under the module calls one of these
// BEFORE any DB read; under-privileged requests get 403 from the caller.
//
// BYT-20261118-020: staff roles without a board seat get accounting by their
// GLOBAL role (src/lib/permissions.ts `readAccounting` / `writeAccounting`):
// `accountant` (účtovník) and `spravca` (management company) read + write.
// Neither approves — approvals stay with the chairman (statutory body).

type AccountingBoardRole = "treasurer" | "chairman";

// Pure predicates over an already-loaded board-role list (e.g. the MCP
// Principal's `boardRoles`). The async `can*` checks below are the same rule
// with the board roles read from the DB — keep both in lockstep.
const WRITE_ROLES: readonly AccountingBoardRole[] = ["treasurer"];
const READ_ROLES: readonly AccountingBoardRole[] = ["treasurer", "chairman"];
const APPROVE_ROLES: readonly AccountingBoardRole[] = ["chairman"];

function holdsAny(boardRoles: readonly string[], roles: readonly string[]) {
  return boardRoles.some((r) => roles.includes(r));
}

/** Global-role grant (admin / accountant / spravca). Unknown roles → false. */
function roleGrants(userRole: string, permission: "readAccounting" | "writeAccounting"): boolean {
  return hasPermission(userRole as UserRole, permission);
}

export function isAccountingWriter(userRole: string, boardRoles: readonly string[]): boolean {
  return roleGrants(userRole, "writeAccounting") || holdsAny(boardRoles, WRITE_ROLES);
}

export function isAccountingReader(userRole: string, boardRoles: readonly string[]): boolean {
  return roleGrants(userRole, "readAccounting") || holdsAny(boardRoles, READ_ROLES);
}

export function isAccountingApprover(userRole: string, boardRoles: readonly string[]): boolean {
  return userRole === "admin" || holdsAny(boardRoles, APPROVE_ROLES);
}

export async function hasBoardRole(
  userId: string,
  entityId: string,
  roles: AccountingBoardRole[]
): Promise<boolean> {
  const [row] = await db
    .select({ id: boardMembers.id })
    .from(boardMembers)
    .where(
      and(
        eq(boardMembers.userId, userId),
        eq(boardMembers.entityId, entityId),
        // isActive AND term not ended — same rule as the Principal's boardRoles.
        boardRoleInForce(),
        inArray(boardMembers.role, roles)
      )
    )
    .limit(1);
  return !!row;
}

export async function canWriteAccounting(
  userId: string,
  userRole: string,
  entityId: string
): Promise<boolean> {
  if (roleGrants(userRole, "writeAccounting")) return true;
  return hasBoardRole(userId, entityId, [...WRITE_ROLES]);
}

export async function canReadAccounting(
  userId: string,
  userRole: string,
  entityId: string
): Promise<boolean> {
  if (roleGrants(userRole, "readAccounting")) return true;
  return hasBoardRole(userId, entityId, [...READ_ROLES]);
}

/**
 * Approval authority (účtovná závierka §7c ods. 9 / §1208, expense
 * authorisation): the CHAIRMAN (statutory representative), never the
 * treasurer — separation of duties. Approvals record a decision; they never
 * post to the ledger. `admin` (operator) keeps full access.
 */
export async function canApproveAccounting(
  userId: string,
  userRole: string,
  entityId: string
): Promise<boolean> {
  if (userRole === "admin") return true;
  return hasBoardRole(userId, entityId, [...APPROVE_ROLES]);
}
