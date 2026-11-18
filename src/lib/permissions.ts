import type { UserRole, UserStatus } from "@/types";

// BYT-20261118-020 (bytové družstvo) roles:
//   member     — člen družstva. Same member-facing rights as `owner`,
//                including `vote` (§240 Obch. zák. 513/1991: each member
//                has one vote unless stanovy say otherwise; CZ §755 ZOK).
//   accountant — účtovník. Accounting read/write only; no board
//                publication (posts), no settings, no users, never votes.
//   spravca    — management company (správca §8a zák. 182/1993 / družstvo
//                as správca). Board-like operational rights; NOT settings,
//                API keys, user/role management or document deletion
//                (those stay with the community's own `admin`).
const permissions = {
  createPost: ["admin", "caretaker", "spravca"],
  viewPosts: ["admin", "owner", "tenant", "vote_counter", "caretaker", "member", "spravca"],
  createVoting: ["admin", "spravca"],
  vote: ["admin", "owner", "member"],
  recordPaperVote: ["admin", "vote_counter", "spravca"],
  viewVotingResults: ["admin", "owner", "caretaker", "member", "spravca"],
  assignVoteCounter: ["admin", "spravca"],
  grantMandate: ["admin"],
  manageUsers: ["admin"],
  viewSettings: ["admin", "caretaker"],
  manageSettings: ["admin"],
  manageApiKeys: ["admin"],
  viewCommunity: ["admin", "owner", "tenant", "member"],
  createCommunityPost: ["admin", "owner", "tenant", "member"],
  respondToCommunityPost: ["admin", "owner", "tenant", "member"],
  resolveOwnCommunityPost: ["admin", "owner", "tenant", "member"],
  deleteOwnCommunityPost: ["admin", "owner", "tenant", "member"],
  moderateCommunityResponse: ["admin"],
  uploadCommunityPhoto: ["admin", "owner", "tenant", "member"],
  changeCrossEntranceVisibility: ["admin"],
  editOwnDirectory: ["admin", "owner", "tenant", "member"],
  viewDirectory: ["admin", "owner", "tenant", "member"],
  // Document library (BYT-20260512-006). Viewing is additionally filtered per
  // document by audience+entity via canSeeDocPath; this gate only governs the
  // management surface + nav visibility.
  viewDocuments: ["admin", "owner", "tenant", "vote_counter", "caretaker", "member", "spravca"],
  uploadDocument: ["admin", "caretaker", "spravca"],
  deleteDocument: ["admin"],
  // Fault reports module (BYT-20261118-004). Board members without flat
  // admin also manage faults via board_members (modules/faults authz).
  // TODO(decision): tenants cannot report yet (spec Decisions 10).
  reportFault: ["admin", "owner", "member"],
  manageFaults: ["admin", "caretaker", "spravca"],
  // Accounting by GLOBAL role (BYT-20261118-020). Board roles (treasurer /
  // chairman) keep their own path in modules/accounting/src/lib/authz.ts;
  // these grant the same rights to staff roles that hold no board seat.
  // Approve (účtovná závierka, expense authorisation) is deliberately NOT
  // granted to accountant / spravca — separation of duties: the statutory
  // body approves, the bookkeeper / manager prepares.
  readAccounting: ["admin", "accountant", "spravca"],
  writeAccounting: ["admin", "accountant", "spravca"],
} as const;

export type Permission = keyof typeof permissions;
export const PERMISSIONS_TABLE = permissions;

// Pure static API — no DB, no server-only deps. Safe to import from
// client components. Entity-aware variants live in
// `src/lib/permissions-entity.ts` and pull the DB.

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return (permissions[permission] as readonly string[]).includes(role);
}

export function getPermissions(role: UserRole): Permission[] {
  return (Object.keys(permissions) as Permission[]).filter((p) =>
    hasPermission(role, p)
  );
}

export function isUserActive(user: { status?: UserStatus } | null | undefined): boolean {
  return user?.status === "active";
}

export function hasPermissionForUser(
  user: { role: UserRole; status: UserStatus } | null | undefined,
  permission: Permission
): boolean {
  if (!user) return false;
  if (user.status !== "active") return false;
  return hasPermission(user.role, permission);
}
