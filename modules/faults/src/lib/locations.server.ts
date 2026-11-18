import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships } from "@/db/schema";
import { pathSegments } from "@/lib/entity-tree";

import type { LocationKind } from "../engine/transitions";

// Location options of a reporter (BYT-20261118-004 AC "Location options are
// exactly…"): the units of their ACTIVE memberships, every ancestor of those
// (entrance / building) and the community root — nothing else. Anything
// outside this set is rejected with FAULT_LOCATION_NOT_ALLOWED.

export interface LocationOption {
  id: string;
  kind: LocationKind;
  entityKind: string;
  name: string;
  /** unit: flat number from entities.data, else null. */
  unitNumber: string | null;
  /** Scope subtree for `entrance` visibility (unit → its parent). */
  scopeEntityId: string;
  depth: number;
}

export async function listReporterLocations(
  userId: string,
  rootId: string
): Promise<LocationOption[]> {
  const own = await db
    .select({ path: entities.path })
    .from(memberships)
    .innerJoin(entities, eq(entities.id, memberships.entityId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        eq(entities.rootId, rootId),
        isNull(entities.archivedAt)
      )
    );
  if (own.length === 0) return [];
  const ids = new Set<string>();
  for (const r of own) for (const id of pathSegments(r.path)) ids.add(id);
  ids.add(rootId);
  const rows = await db
    .select({
      id: entities.id,
      kind: entities.kind,
      name: entities.name,
      parentId: entities.parentId,
      depth: entities.depth,
      data: entities.data,
    })
    .from(entities)
    .where(and(inArray(entities.id, [...ids]), isNull(entities.archivedAt)));

  return rows
    .map((r): LocationOption => {
      const kind: LocationKind =
        r.id === rootId ? "root" : r.kind === "unit" ? "unit" : "group";
      const data = (r.data ?? {}) as Record<string, unknown>;
      const num = data.flat_number ?? data.unit_number ?? null;
      return {
        id: r.id,
        kind,
        entityKind: r.kind,
        name: r.name,
        unitNumber: kind === "unit" && num != null ? String(num) : null,
        scopeEntityId: kind === "unit" ? (r.parentId ?? rootId) : r.id,
        depth: r.depth,
      };
    })
    .sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name));
}

/** Location of an existing fault, for board-side changes (any entity in the root). */
export async function resolveBoardLocation(
  entityId: string,
  rootId: string
): Promise<LocationOption | null> {
  const [r] = await db
    .select({
      id: entities.id,
      kind: entities.kind,
      name: entities.name,
      parentId: entities.parentId,
      depth: entities.depth,
      rootId: entities.rootId,
    })
    .from(entities)
    .where(and(eq(entities.id, entityId), isNull(entities.archivedAt)))
    .limit(1);
  if (!r || (r.rootId !== rootId && r.id !== rootId)) return null;
  const kind: LocationKind = r.id === rootId ? "root" : r.kind === "unit" ? "unit" : "group";
  return {
    id: r.id,
    kind,
    entityKind: r.kind,
    name: r.name,
    unitNumber: null,
    scopeEntityId: kind === "unit" ? (r.parentId ?? rootId) : r.id,
    depth: r.depth,
  };
}
