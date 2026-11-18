"use client";

import { useOptionalShell } from "@/components/layout/ShellContext";
import { hasPermission } from "@/lib/permissions";

// Client mirror of modules/accounting/src/lib/authz.ts, derived from the
// shell the dashboard layout already resolved (no fetch). UI hint only —
// every API route still enforces the real check server-side (403).
//   read    → readAccounting (admin, accountant, spravca), treasurer, chairman
//   write   → writeAccounting (admin, accountant, spravca), treasurer
//   approve → admin, chairman (never accountant / spravca — separation of duties)
export interface AccountingAccess {
  canRead: boolean;
  canWrite: boolean;
  canApprove: boolean;
}

export function useAccountingAccess(): AccountingAccess {
  const shell = useOptionalShell();
  if (!shell) return { canRead: false, canWrite: false, canApprove: false };
  const role = shell.user.role;
  const admin = role === "admin";
  const roles = shell.user.boardRoles;
  const treasurer = roles.includes("treasurer");
  const chairman = roles.includes("chairman");
  return {
    canRead: hasPermission(role, "readAccounting") || treasurer || chairman,
    canWrite: hasPermission(role, "writeAccounting") || treasurer,
    canApprove: admin || chairman,
  };
}
