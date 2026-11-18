import "server-only";

import { auth } from "@/lib/auth";
import { getCommunityRoot, type CommunityRootRow } from "@/lib/legacy-compat";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { hasPermission } from "@/lib/permissions";
import { listActiveBoardRoles } from "@/lib/user-context";
import type { BoardMemberRole, UserRole, UserStatus } from "@/types";

import type { FaultBoardAccess } from "../engine/views";

// Who is calling (BYT-20261118-004 "Permissions"). "Board" for faults =
// flat `admin` + anyone holding an active board_members role → `full`;
// `caretaker` → `caretaker` access (works the task, never sees the internal
// note / invoiced / expense link). Decided 2026-11-18.

export const FAULTS_MODULE = "faults";

export interface FaultActor {
  userId: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  root: CommunityRootRow;
  boardRoles: BoardMemberRole[];
  board: FaultBoardAccess | null;
  canReport: boolean;
}

export function boardAccessFor(
  role: UserRole,
  boardRoles: readonly BoardMemberRole[]
): FaultBoardAccess | null {
  if (role === "admin") return "full";
  if (boardRoles.length > 0) return "full";
  if (hasPermission(role, "manageFaults")) return "caretaker";
  return null;
}

/**
 * Resolve the signed-in actor. Null when signed out, inactive, no
 * community root, or the module is disabled — callers answer 404/401.
 */
export async function getFaultActor(): Promise<FaultActor | null> {
  if (!(await isModuleEnabled(FAULTS_MODULE))) return null;
  const session = await auth();
  const u = session?.user;
  if (!u?.id) return null;
  if (u.status !== "active") return null;
  const root = await getCommunityRoot();
  if (!root) return null;
  const role = u.role as UserRole;
  const boardRoles = (await listActiveBoardRoles(u.id, root.id)) as BoardMemberRole[];
  return {
    userId: u.id,
    name: u.name ?? "",
    role,
    status: u.status as UserStatus,
    root,
    boardRoles,
    board: boardAccessFor(role, boardRoles),
    // TODO(decision): tenants cannot report yet (spec Decisions 10) —
    // `reportFault` lists admin + owner only.
    canReport: hasPermission(role, "reportFault"),
  };
}
