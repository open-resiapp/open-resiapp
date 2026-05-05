import "server-only";

import {
  getEffectiveRole,
  roleSatisfies,
  type MembershipRole,
} from "@/lib/entity-tree";
import {
  PERMISSIONS_TABLE,
  type Permission,
  getPermissions,
} from "@/lib/permissions";

// Entity-aware permission API — RES-20260501-002 §"Permission model
// changes". Pulled into its own file so the static `permissions.ts`
// module can stay client-safe. This file is marked server-only so it
// fails fast if ever imported from a client component (would otherwise
// drag pg/drizzle into the browser bundle).

export class PermissionDeniedError extends Error {
  constructor(
    public readonly userId: string,
    public readonly entityId: string,
    public readonly required: MembershipRole | Permission
  ) {
    super(`User ${userId} lacks ${required} on entity ${entityId}`);
    this.name = "PermissionDeniedError";
  }
}

export async function hasEntityPermission(
  userId: string,
  entityId: string,
  permission: Permission
): Promise<boolean> {
  const role = await getEffectiveRole(userId, entityId);
  if (role === null) return false;
  return (PERMISSIONS_TABLE[permission] as readonly string[]).includes(role);
}

export async function hasMembership(
  userId: string,
  entityId: string,
  minRole: MembershipRole
): Promise<boolean> {
  const role = await getEffectiveRole(userId, entityId);
  if (role === null) return false;
  return roleSatisfies(role, minRole);
}

export async function requireEntityPermission(
  userId: string,
  entityId: string,
  permission: Permission
): Promise<void> {
  const ok = await hasEntityPermission(userId, entityId, permission);
  if (!ok) throw new PermissionDeniedError(userId, entityId, permission);
}

export async function requireMembership(
  userId: string,
  entityId: string,
  minRole: MembershipRole
): Promise<void> {
  const ok = await hasMembership(userId, entityId, minRole);
  if (!ok) throw new PermissionDeniedError(userId, entityId, minRole);
}

export async function listEntityPermissions(
  userId: string,
  entityId: string
): Promise<Permission[]> {
  const role = await getEffectiveRole(userId, entityId);
  if (role === null) return [];
  return getPermissions(role);
}

export {
  getEffectiveRole,
  listSubtreeMemberships as listSubtreeMembers,
} from "@/lib/entity-tree";
