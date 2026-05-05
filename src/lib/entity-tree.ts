import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  entities,
  memberships,
  type entityKindEnum,
  type membershipRoleEnum,
} from "@/db/schema";

/**
 * All path / tree mutation logic lives in this file. No other module
 * may parse or construct `entities.path` strings — they MUST go through
 * the helpers exported here. This is the swap point if we ever migrate
 * to Postgres `ltree` (RES-20260501-002 §"Tree representation").
 *
 * Path format: "/<rootId>/<childId>/.../<selfId>/"
 *   - Always starts AND ends with "/"
 *   - Always contains the entity's own id as the last segment
 *   - Always equals parent.path + selfId + "/"
 *   - Root entities have path "/<selfId>/" and depth 0
 */

export type EntityKind = (typeof entityKindEnum.enumValues)[number];
export type MembershipRole = (typeof membershipRoleEnum.enumValues)[number];

const ROLE_RANK: Record<MembershipRole, number> = {
  tenant: 0,
  caretaker: 1,
  vote_counter: 2,
  owner: 3,
  admin: 4,
};

export function buildPath(parentPath: string | null, selfId: string): string {
  if (parentPath === null) return `/${selfId}/`;
  return `${parentPath}${selfId}/`;
}

export function pathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

export function isAncestorPath(maybeAncestor: string, descendant: string): boolean {
  return descendant !== maybeAncestor && descendant.startsWith(maybeAncestor);
}

export class EntityTreeCycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EntityTreeCycleError";
  }
}

export class EntityNotFoundError extends Error {
  constructor(entityId: string) {
    super(`Entity ${entityId} not found`);
    this.name = "EntityNotFoundError";
  }
}

export async function getEntity(entityId: string) {
  const [row] = await db
    .select()
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);
  if (!row) throw new EntityNotFoundError(entityId);
  return row;
}

export async function getAncestors(entityId: string) {
  const entity = await getEntity(entityId);
  const ids = pathSegments(entity.path);
  const ancestorIds = ids.slice(0, -1);
  if (ancestorIds.length === 0) return [];
  const rows = await db
    .select()
    .from(entities)
    .where(sql`${entities.id} = ANY(${ancestorIds}::uuid[])`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ancestorIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => r !== undefined);
}

export async function getDescendants(
  entityId: string,
  opts: { includeArchived?: boolean } = {}
) {
  const entity = await getEntity(entityId);
  const prefix = entity.path;
  const where = opts.includeArchived
    ? sql`${entities.path} LIKE ${prefix + "%"} AND ${entities.id} <> ${entityId}`
    : sql`${entities.path} LIKE ${prefix + "%"} AND ${entities.id} <> ${entityId} AND ${entities.archivedAt} IS NULL`;
  return db.select().from(entities).where(where);
}

export async function getSubtree(entityId: string) {
  const entity = await getEntity(entityId);
  return db
    .select()
    .from(entities)
    .where(
      and(
        sql`${entities.path} LIKE ${entity.path + "%"}`,
        isNull(entities.archivedAt)
      )
    );
}

export async function listSubtreeMemberships(rootEntityId: string) {
  const root = await getEntity(rootEntityId);
  return db
    .select({
      membership: memberships,
      entity: entities,
    })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(
        sql`${entities.path} LIKE ${root.path + "%"}`,
        isNull(entities.archivedAt),
        eq(memberships.status, "active")
      )
    );
}

/**
 * Effective role for (user, entity): nearest-ancestor membership wins.
 * Walks the entity's path upward and picks the strongest role from any
 * matching membership row. Returns null if user has no membership in
 * any ancestor of the entity.
 */
export async function getEffectiveRole(
  userId: string,
  entityId: string
): Promise<MembershipRole | null> {
  const entity = await getEntity(entityId);
  const ancestorIds = pathSegments(entity.path);
  if (ancestorIds.length === 0) return null;
  const rows = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        sql`${memberships.entityId} = ANY(${ancestorIds}::uuid[])`
      )
    );
  if (rows.length === 0) return null;
  const indexById = new Map(ancestorIds.map((id, idx) => [id, idx]));
  // Sort: nearest ancestor first (highest index), tie-break by role rank.
  rows.sort((a, b) => {
    const da = indexById.get(a.entityId) ?? -1;
    const db_ = indexById.get(b.entityId) ?? -1;
    if (da !== db_) return db_ - da;
    return ROLE_RANK[b.role] - ROLE_RANK[a.role];
  });
  return rows[0].role;
}

export function roleSatisfies(actual: MembershipRole, minimum: MembershipRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[minimum];
}

interface CreateEntityInput {
  parentId: string | null;
  kind: EntityKind;
  name: string;
}

/**
 * Create a new entity. Computes path / depth / rootId from the parent.
 * Pass parentId = null for a root entity.
 */
export async function createEntity(input: CreateEntityInput) {
  const newId = crypto.randomUUID();
  if (input.parentId === null) {
    const path = buildPath(null, newId);
    const [row] = await db
      .insert(entities)
      .values({
        id: newId,
        parentId: null,
        kind: input.kind,
        name: input.name,
        path,
        depth: 0,
        rootId: newId,
      })
      .returning();
    return row;
  }
  const parent = await getEntity(input.parentId);
  if (parent.archivedAt !== null) {
    throw new Error(`Cannot create child under archived entity ${parent.id}`);
  }
  const path = buildPath(parent.path, newId);
  const [row] = await db
    .insert(entities)
    .values({
      id: newId,
      parentId: parent.id,
      kind: input.kind,
      name: input.name,
      path,
      depth: parent.depth + 1,
      rootId: parent.rootId,
    })
    .returning();
  return row;
}

/**
 * Re-parent an entity. Rejects cycles, recomputes path/depth/rootId for
 * the moved entity AND every descendant in a single transaction.
 */
export async function setParent(
  entityId: string,
  newParentId: string | null
): Promise<void> {
  await db.transaction(async (tx) => {
    const [self] = await tx
      .select()
      .from(entities)
      .where(eq(entities.id, entityId))
      .limit(1);
    if (!self) throw new EntityNotFoundError(entityId);

    let newPath: string;
    let newDepth: number;
    let newRootId: string;

    if (newParentId === null) {
      newPath = buildPath(null, entityId);
      newDepth = 0;
      newRootId = entityId;
    } else {
      const [parent] = await tx
        .select()
        .from(entities)
        .where(eq(entities.id, newParentId))
        .limit(1);
      if (!parent) throw new EntityNotFoundError(newParentId);
      if (parent.archivedAt !== null) {
        throw new Error(`Cannot re-parent under archived entity ${parent.id}`);
      }
      // Cycle check: the new parent must not be self or a descendant of self.
      if (parent.id === entityId || isAncestorPath(self.path, parent.path)) {
        throw new EntityTreeCycleError(
          `Re-parenting ${entityId} under ${newParentId} would create a cycle`
        );
      }
      newPath = buildPath(parent.path, entityId);
      newDepth = parent.depth + 1;
      newRootId = parent.rootId;
    }

    // Update self.
    await tx
      .update(entities)
      .set({
        parentId: newParentId,
        path: newPath,
        depth: newDepth,
        rootId: newRootId,
      })
      .where(eq(entities.id, entityId));

    // Update every descendant: replace the old path prefix with the new one,
    // shift depth by the same delta, set rootId.
    const oldPrefix = self.path;
    const depthDelta = newDepth - self.depth;
    await tx.execute(sql`
      UPDATE ${entities}
      SET
        path = ${newPath} || substring(${entities.path} from ${oldPrefix.length + 1}),
        depth = ${entities.depth} + ${depthDelta},
        root_id = ${newRootId}
      WHERE ${entities.path} LIKE ${oldPrefix + "%"}
        AND ${entities.id} <> ${entityId}
    `);
  });
}

export async function archiveEntity(entityId: string): Promise<void> {
  const subtree = await getSubtree(entityId);
  if (subtree.length === 0) return;
  const ids = subtree.map((e) => e.id);
  await db
    .update(entities)
    .set({ archivedAt: new Date() })
    .where(sql`${entities.id} = ANY(${ids}::uuid[])`);
}

export async function unarchiveEntity(entityId: string): Promise<void> {
  // Only the entity itself, not descendants — operator decides per-level.
  await db
    .update(entities)
    .set({ archivedAt: null })
    .where(eq(entities.id, entityId));
}

/**
 * Lists root entities (parentId IS NULL) the user holds any active
 * membership in (anywhere in the subtree). Used by the header switcher.
 */
export async function listUserRoots(userId: string) {
  const rows = await db
    .select({ rootId: entities.rootId })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(eq(memberships.userId, userId), eq(memberships.status, "active"))
    )
    .groupBy(entities.rootId);
  if (rows.length === 0) return [];
  const rootIds = rows.map((r) => r.rootId);
  return db
    .select()
    .from(entities)
    .where(
      and(
        sql`${entities.id} = ANY(${rootIds}::uuid[])`,
        isNull(entities.archivedAt)
      )
    )
    .orderBy(desc(entities.createdAt));
}
