import type { UserRole } from "@/types";

const permissions = {
  createPost: ["admin"],
  viewPosts: ["admin", "owner", "tenant", "vote_counter"],
  createVoting: ["admin"],
  vote: ["admin", "owner"],
  recordPaperVote: ["admin", "vote_counter"],
  viewVotingResults: ["admin", "owner"],
  assignVoteCounter: ["admin"],
  grantMandate: ["admin", "owner"],
  manageUsers: ["admin"],
  viewSettings: ["admin"],
} as const;

export type Permission = keyof typeof permissions;

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return (permissions[permission] as readonly string[]).includes(role);
}

export function getPermissions(role: UserRole): Permission[] {
  return (Object.keys(permissions) as Permission[]).filter((p) =>
    hasPermission(role, p)
  );
}
