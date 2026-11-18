import "server-only";

import type { Session } from "next-auth";

import { getCommunityRoot, type CommunityRootRow } from "@/lib/legacy-compat";
import {
  getUserAuthRow,
  listActiveBoardRoles,
  type BoardRole,
} from "@/lib/user-context";
import type { UserRole, UserStatus } from "@/types";
import { McpError } from "./errors";

// Principal (BYT-20261117-001 §3) — who is acting, independent of how they
// authenticated (NextAuth session for the UI, OAuth bearer token for MCP).
// Lib functions take a Principal (or the `Viewer` subset) instead of reading
// `auth()`, so UI routes and MCP tools share one code path.
//
//   - `role` is the flat users.role read LIVE from the DB (what
//     `hasPermission` uses) — NOT the JWT copy and NOT getUserPrimaryRole.
//   - `entityId` is the community root (single-root v1).
//   - `boardRoles` are the user's ACTIVE board_members roles on that root.
//   - `scopes` only ever narrow; role / board role always decides.

export const MCP_SCOPES = [
  "read",
  "finance:read",
  "finance:write",
  "governance:write",
  "vote",
  // BYT-20261118-012: own community posts, event RSVPs, directory entry.
  "community:write",
] as const;
export type Scope = (typeof MCP_SCOPES)[number];

export interface Principal {
  userId: string;
  role: UserRole;
  status: UserStatus;
  entityId: string;
  boardRoles: BoardRole[];
  scopes: Scope[];
  /** OAuth client id for MCP calls; null for first-party UI sessions. */
  clientId: string | null;
}

/** The minimal identity visibility queries need (posts / votings lists). */
export type Viewer = Pick<Principal, "userId" | "role">;

export interface PrincipalContext {
  principal: Principal;
  root: CommunityRootRow;
}

/**
 * Builds the principal AND returns the community root it resolved, so
 * callers needing root data (country, name, address) don't re-query it.
 * Throws McpError: `unauthorized` (user gone), `community_missing`.
 * Does NOT reject inactive users — that is `assertActive`'s job, so callers
 * can still render a status-specific message.
 */
export async function loadPrincipalContext(
  userId: string,
  opts: { scopes: readonly Scope[]; clientId: string | null }
): Promise<PrincipalContext> {
  const [user, root] = await Promise.all([
    getUserAuthRow(userId),
    getCommunityRoot(),
  ]);
  if (!user) throw new McpError("unauthorized");
  if (!root) throw new McpError("community_missing");
  const boardRoles = await listActiveBoardRoles(userId, root.id);
  return {
    principal: {
      userId: user.id,
      role: user.role,
      status: user.status,
      entityId: root.id,
      boardRoles,
      scopes: [...opts.scopes],
      clientId: opts.clientId,
    },
    root,
  };
}

export async function buildPrincipal(
  userId: string,
  opts: { scopes: readonly Scope[]; clientId: string | null }
): Promise<Principal> {
  return (await loadPrincipalContext(userId, opts)).principal;
}

/** UI path: a NextAuth session acts with every scope (role still decides). */
export async function principalFromSession(
  session: Session
): Promise<Principal> {
  return buildPrincipal(session.user.id, {
    scopes: MCP_SCOPES,
    clientId: null,
  });
}

export async function principalContextFromSession(
  session: Session
): Promise<PrincipalContext> {
  return loadPrincipalContext(session.user.id, {
    scopes: MCP_SCOPES,
    clientId: null,
  });
}

/** Viewer from a session without a DB round-trip (JWT role, as before). */
export function viewerFromSession(session: Session): Viewer {
  return { userId: session.user.id, role: session.user.role as UserRole };
}

export function hasScope(p: Pick<Principal, "scopes">, scope: Scope): boolean {
  return p.scopes.includes(scope);
}
