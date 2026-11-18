// Client-safe. Single typed navigation config for the dashboard shell
// (BYT-20261117-002 Phase 3) and a pure filter that returns the items a
// given user sees. No DB, no server-only imports — the inputs come from
// ShellData resolved by the server layout.

import type { IconName } from "@/components/ui";
import { hasPermission, type Permission } from "@/lib/permissions";
import type { BoardMemberRole, UserRole, UserStatus } from "@/types";

/** Which navigation set a user gets. */
export type NavAudience = "owner" | "board";

/** Keys into ShellData.badges — counts the server resolved for nav badges. */
export type NavBadgeKey = "pendingRegistrations" | "ownerQueue";

/** Keys in the `Nav` i18n namespace. */
export type NavLabelKey =
  | "home"
  | "notices"
  | "voting"
  | "myPayments"
  | "finance"
  | "owners"
  | "documents"
  | "settings"
  | "house"
  | "laws";

export interface NavItem {
  id: string;
  href: string;
  labelKey: NavLabelKey;
  icon: IconName;
  /** Audiences this item appears for. */
  audience: readonly NavAudience[];
  /** Global role permission (src/lib/permissions.ts). */
  permission?: Permission;
  /**
   * Board roles that unlock the item. `admin` always passes (mirrors the
   * operator bypass in modules/accounting/src/lib/authz.ts).
   */
  boardRole?: readonly BoardMemberRole[];
  /**
   * Global-role permission that unlocks the item without a board seat
   * (BYT-20261118-020: accountant / spravca reach Financie by role).
   */
  boardRoleBypass?: Permission;
  /** Hidden unless the named module is enabled (core_modules.status). */
  requiresModule?: string;
  /** Hidden unless the user holds an active membership at a unit. */
  requiresOwnUnit?: boolean;
  badgeKey?: NavBadgeKey;
  /**
   * Reference destination: listed in the sidebar below the main items,
   * never in the owner bottom tab bar (owners reach it from Dom).
   */
  secondary?: boolean;
}

export interface NavUser {
  role: UserRole;
  status: UserStatus;
  boardRoles: readonly BoardMemberRole[];
  unitIds: readonly string[];
}

export interface NavContext {
  enabledModules: readonly string[];
}

// Same board roles that canReadAccounting() accepts
// (modules/accounting/src/lib/authz.ts) — the Financie entry must not
// lead a board member to a 403.
const ACCOUNTING_READ_BOARD_ROLES: readonly BoardMemberRole[] = ["treasurer", "chairman"];

// Order matters: owners see Domov · Hlasovanie · Moje platby · Dom;
// board sees Domov · Oznamy · Hlasovanie · (Moje platby) · Financie ·
// Vlastníci · Dokumenty · Nastavenia.
export const NAV_ITEMS: readonly NavItem[] = [
  { id: "home", href: "/", labelKey: "home", icon: "home", audience: ["owner", "board"] },
  {
    id: "notices",
    href: "/board",
    labelKey: "notices",
    icon: "megaphone",
    audience: ["board"],
    permission: "viewPosts",
  },
  {
    id: "voting",
    href: "/voting",
    labelKey: "voting",
    icon: "vote",
    audience: ["owner", "board"],
    requiresModule: "voting",
  },
  {
    id: "myPayments",
    href: "/moje-platby",
    labelKey: "myPayments",
    icon: "wallet",
    audience: ["owner", "board"],
    requiresModule: "accounting",
    requiresOwnUnit: true,
  },
  {
    id: "finance",
    href: "/accounting",
    labelKey: "finance",
    icon: "wallet",
    audience: ["board"],
    requiresModule: "accounting",
    boardRole: ACCOUNTING_READ_BOARD_ROLES,
    boardRoleBypass: "readAccounting",
  },
  {
    id: "owners",
    href: "/owners",
    labelKey: "owners",
    icon: "users",
    audience: ["board"],
    permission: "manageUsers",
    // BYT-20261118-003: open "Na riešenie" items (registrations included).
    badgeKey: "ownerQueue",
  },
  {
    id: "documents",
    href: "/documents",
    labelKey: "documents",
    icon: "file",
    audience: ["board"],
    permission: "viewDocuments",
  },
  {
    id: "settings",
    href: "/settings",
    labelKey: "settings",
    icon: "settings",
    audience: ["board"],
    permission: "viewSettings",
  },
  { id: "house", href: "/dom", labelKey: "house", icon: "building", audience: ["owner"] },
  // Laws library — read-only reference for every active member.
  {
    id: "laws",
    href: "/zakony",
    labelKey: "laws",
    icon: "file",
    audience: ["owner", "board"],
    secondary: true,
  },
];

/**
 * Board nav for the operator role (admin), staff roles that manage the
 * community (caretaker — `viewSettings`; spravca, accountant), and anyone who sits on a board
 * (board_members). Everyone else — owners, tenants, vote counters — gets
 * the 4-item owner nav.
 */
export function getNavAudience(user: Pick<NavUser, "role" | "boardRoles">): NavAudience {
  if (hasPermission(user.role, "viewSettings")) return "board";
  // BYT-20261118-020: management company (createVoting) and accountant
  // (readAccounting) work in the board shell without a board seat.
  if (hasPermission(user.role, "createVoting")) return "board";
  if (hasPermission(user.role, "readAccounting")) return "board";
  if (user.boardRoles.length > 0) return "board";
  return "owner";
}

/** Pure: the nav items `user` sees, in display order. Pending users see none. */
export function getVisibleNavItems(user: NavUser, ctx: NavContext): NavItem[] {
  if (user.status !== "active") return [];
  const audience = getNavAudience(user);
  const enabled = new Set(ctx.enabledModules);
  return NAV_ITEMS.filter((item) => {
    if (!item.audience.includes(audience)) return false;
    if (item.permission && !hasPermission(user.role, item.permission)) return false;
    if (item.boardRole && user.role !== "admin") {
      const byRole = item.boardRoleBypass ? hasPermission(user.role, item.boardRoleBypass) : false;
      if (!byRole && !item.boardRole.some((r) => user.boardRoles.includes(r))) return false;
    }
    if (item.requiresModule && !enabled.has(item.requiresModule)) return false;
    if (item.requiresOwnUnit && user.unitIds.length === 0) return false;
    return true;
  });
}

/** Active-state rule shared by the sidebar and the bottom tab bar. */
export function isNavItemActive(item: Pick<NavItem, "href">, pathname: string): boolean {
  if (item.href === "/") return pathname === "/";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
