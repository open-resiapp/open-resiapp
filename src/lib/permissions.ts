import type { UserRole } from "@/types";

const permissions = {
  createPost: ["admin", "caretaker"],
  viewPosts: ["admin", "owner", "tenant", "vote_counter", "caretaker"],
  createVoting: ["admin"],
  vote: ["admin", "owner"],
  recordPaperVote: ["admin", "vote_counter"],
  viewVotingResults: ["admin", "owner", "caretaker"],
  assignVoteCounter: ["admin"],
  grantMandate: ["admin"],
  manageUsers: ["admin"],
  viewSettings: ["admin", "caretaker"],
  manageSettings: ["admin"],
  manageApiKeys: ["admin"],
  viewCommunity: ["admin", "owner", "tenant"],
  createCommunityPost: ["admin", "owner", "tenant"],
  respondToCommunityPost: ["admin", "owner", "tenant"],
  resolveOwnCommunityPost: ["admin", "owner", "tenant"],
  deleteOwnCommunityPost: ["admin", "owner", "tenant"],
  moderateCommunityResponse: ["admin"],
  uploadCommunityPhoto: ["admin", "owner", "tenant"],
  changeCrossEntranceVisibility: ["admin"],
  editOwnDirectory: ["admin", "owner", "tenant"],
  viewDirectory: ["admin", "owner", "tenant"],
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
