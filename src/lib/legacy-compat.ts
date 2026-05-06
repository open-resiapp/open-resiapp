import "server-only";

import { aliasedTable, and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  building,
  entities,
  entrances,
  flats,
  housingRootData,
  housingUnitData,
  memberships,
  users,
} from "@/db/schema";
import type { membershipRoleEnum } from "@/db/schema";

// ── Legacy compatibility shims ──────────────────────────────────
// Phase 9.1: progressive migration helpers. Each function returns the
// shape the legacy `building` / `entrances` / `flats` / `userFlats`
// queries returned, but re-derived from entities + extension data.
// Once every call site goes through these helpers, the underlying
// legacy tables can be dropped without touching call sites again
// (Phase 9.2 destructive migration).

export type MembershipRole = (typeof membershipRoleEnum.enumValues)[number];

/**
 * Drop-in replacement for `db.select().from(building).limit(1)`.
 * Returns the shape callers expect: id, name, address, ico,
 * voting_method, country, governance_model, legal_notice,
 * community_cross_entrance_visible, created_at.
 */
export async function getCommunityRoot() {
  const [row] = await db
    .select({
      id: entities.id,
      name: entities.name,
      address: housingRootData.address,
      ico: housingRootData.ico,
      votingMethod: housingRootData.votingMethod,
      country: housingRootData.country,
      governanceModel: housingRootData.governanceModel,
      legalNotice: housingRootData.legalNotice,
      communityCrossEntranceVisible: housingRootData.communityCrossEntranceVisible,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .innerJoin(housingRootData, eq(housingRootData.entityId, entities.id))
    .where(
      and(
        isNull(entities.parentId),
        inArray(entities.kind, ["housing_community", "housing_block"]),
        isNull(entities.archivedAt)
      )
    )
    .orderBy(entities.createdAt)
    .limit(1);
  return row ?? null;
}

/** Backwards-compatible drop-in for `db.select().from(building)`. */
export async function listCommunityRoots() {
  return db
    .select({
      id: entities.id,
      name: entities.name,
      address: housingRootData.address,
      ico: housingRootData.ico,
      votingMethod: housingRootData.votingMethod,
      country: housingRootData.country,
      governanceModel: housingRootData.governanceModel,
      legalNotice: housingRootData.legalNotice,
      communityCrossEntranceVisible: housingRootData.communityCrossEntranceVisible,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .innerJoin(housingRootData, eq(housingRootData.entityId, entities.id))
    .where(
      and(
        inArray(entities.kind, ["housing_community", "housing_block"]),
        isNull(entities.parentId),
        isNull(entities.archivedAt)
      )
    )
    .orderBy(entities.createdAt);
}

/**
 * Drop-in for `db.select().from(entrances).where(eq(entrances.buildingId, X))`.
 * Returns the shape: id, building_id (= root entity id), name,
 * street_number, created_at.
 */
export async function listEntrances(rootEntityId: string) {
  return db
    .select({
      id: entities.id,
      buildingId: entities.parentId,
      name: entities.name,
      streetNumber: housingRootData.address, // entrance street number not stored separately yet — adjust if a per-entrance extension table is added later
      createdAt: entities.createdAt,
    })
    .from(entities)
    .leftJoin(housingRootData, eq(housingRootData.entityId, entities.id))
    .where(
      and(
        eq(entities.parentId, rootEntityId),
        eq(entities.kind, "housing_entrance"),
        isNull(entities.archivedAt)
      )
    );
}

/**
 * Drop-in for `db.select().from(flats).where(eq(flats.id, X))`.
 * Returns: id, entrance_id (= parent entity), flat_number, floor,
 * share_numerator, share_denominator, area, created_at.
 */
export async function getFlatById(flatId: string) {
  const [row] = await db
    .select({
      id: entities.id,
      entranceId: entities.parentId,
      flatNumber: housingUnitData.flatNumber,
      floor: housingUnitData.floor,
      shareNumerator: housingUnitData.shareNumerator,
      shareDenominator: housingUnitData.shareDenominator,
      area: housingUnitData.area,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .innerJoin(housingUnitData, eq(housingUnitData.entityId, entities.id))
    .where(
      and(
        eq(entities.id, flatId),
        eq(entities.kind, "housing_unit"),
        isNull(entities.archivedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Drop-in for `db.select().from(flats).where(eq(flats.entranceId, X))`.
 */
export async function listFlatsForEntrance(entranceEntityId: string) {
  return db
    .select({
      id: entities.id,
      entranceId: entities.parentId,
      flatNumber: housingUnitData.flatNumber,
      floor: housingUnitData.floor,
      shareNumerator: housingUnitData.shareNumerator,
      shareDenominator: housingUnitData.shareDenominator,
      area: housingUnitData.area,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .innerJoin(housingUnitData, eq(housingUnitData.entityId, entities.id))
    .where(
      and(
        eq(entities.parentId, entranceEntityId),
        eq(entities.kind, "housing_unit"),
        isNull(entities.archivedAt)
      )
    );
}

/**
 * Drop-in for the userFlats→flats join: returns every housing_unit
 * the user has an active membership at, joined with unit data.
 */
export interface UserFlatRow {
  flatId: string;
  flatNumber: string;
  floor: number;
  entranceId: string | null;
  entranceName: string | null;
  shareNumerator: number;
  shareDenominator: number;
  area: number | null;
}

export async function listUserFlats(userId: string): Promise<UserFlatRow[]> {
  const entrance = aliasedTable(entities, "entrance");
  return db
    .select({
      flatId: entities.id,
      flatNumber: housingUnitData.flatNumber,
      floor: housingUnitData.floor,
      entranceId: entities.parentId,
      entranceName: entrance.name,
      shareNumerator: housingUnitData.shareNumerator,
      shareDenominator: housingUnitData.shareDenominator,
      area: housingUnitData.area,
    })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .innerJoin(housingUnitData, eq(housingUnitData.entityId, entities.id))
    .leftJoin(entrance, eq(entrance.id, entities.parentId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        eq(entities.kind, "housing_unit"),
        isNull(entities.archivedAt)
      )
    );
}

/**
 * Resolve the "primary" role of a user as the strongest role they
 * hold across any active membership. Replaces direct reads of
 * `users.role`. Falls back to "owner" if the user holds no membership.
 */
export async function getUserPrimaryRole(userId: string): Promise<MembershipRole> {
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.status, "active"))
    );
  if (rows.length === 0) return "owner";
  const rank: Record<MembershipRole, number> = {
    tenant: 0,
    caretaker: 1,
    vote_counter: 2,
    owner: 3,
    admin: 4,
  };
  let best: MembershipRole = "owner";
  for (const r of rows) {
    if (rank[r.role] > rank[best]) best = r.role;
  }
  return best;
}

/**
 * Drop-in for `users.flatId` semantics: returns the user's first
 * active housing_unit membership entity id (or null).
 */
export async function getPrimaryFlatId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ entityId: memberships.entityId })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        eq(entities.kind, "housing_unit"),
        isNull(entities.archivedAt)
      )
    )
    .orderBy(memberships.createdAt)
    .limit(1);
  return row?.entityId ?? null;
}

// ── Module-level guards for static analysis ─────────────────────
// These are intentionally re-exported so that `grep "from \"@/db/schema\""`
// audits can be performed in isolation from `from \"@/lib/legacy-compat\"`.
// Importing from this file = "explicitly using a legacy shim".
// During Phase 9.2 the shim file is the only place that needs to be
// rewritten when the underlying tables flip.
export { building, entrances, flats };
