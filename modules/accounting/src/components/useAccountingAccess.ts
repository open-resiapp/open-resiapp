"use client";

import { useOptionalShell } from "@/components/layout/ShellContext";

// Client mirror of modules/accounting/src/lib/authz.ts, derived from the
// shell the dashboard layout already resolved (no fetch). UI hint only —
// every API route still enforces the real check server-side (403).
//   read    → admin, treasurer, chairman
//   write   → admin, treasurer
//   approve → admin, chairman
export interface AccountingAccess {
  canRead: boolean;
  canWrite: boolean;
  canApprove: boolean;
}

export function useAccountingAccess(): AccountingAccess {
  const shell = useOptionalShell();
  if (!shell) return { canRead: false, canWrite: false, canApprove: false };
  const admin = shell.user.role === "admin";
  const roles = shell.user.boardRoles;
  const treasurer = roles.includes("treasurer");
  const chairman = roles.includes("chairman");
  return {
    canRead: admin || treasurer || chairman,
    canWrite: admin || treasurer,
    canApprove: admin || chairman,
  };
}
