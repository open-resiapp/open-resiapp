import "server-only";

import { aliasedTable, and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  entities,
  housingRootData,
  housingUnitData,
  memberships,
} from "@/db/schema";
import type { membershipRoleEnum } from "@/db/schema";

// Phase 9.2 cutover: legacy `building` / `entrances` / `flats` /
// `user_flats` tables are gone. The helpers below served the dual-run
// period; what remains are convenience wrappers that derive the same
// shapes from entities + housing_*_data + memberships so call sites
// don't have to duplicate joins.

export type MembershipRole = (typeof membershipRoleEnum.enumValues)[number];

/**
 * The single housing root entity (community / block) — drop-in for
 * the previous `db.select().from(building).limit(1)` pattern.
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
        isNull(entities.archivedAt)
      )
    )
    .orderBy(entities.createdAt)
    .limit(1);
  return row ?? null;
}

/** Lists all root entities (housing or otherwise) the operator manages. */
export async function listCommunityRoots() {
  return db
    .select({
      id: entities.id,
      name: entities.name,
      kind: entities.kind,
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
    .leftJoin(housingRootData, eq(housingRootData.entityId, entities.id))
    .where(and(isNull(entities.parentId), isNull(entities.archivedAt)))
    .orderBy(entities.createdAt);
}

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

/**
 * Every housing_unit entity the user holds an active membership at,
 * joined with unit data + parent (entrance) name. Drop-in for the
 * legacy `userFlats → flats → entrances` 3-way join.
 */
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
 * Strongest role the user holds across active memberships. Replaces
 * direct reads of the now-dropped `users.role` column.
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
 * Drop-in replacement for the dropped `users.flat_id` column —
 * returns the user's first active housing_unit membership entity id,
 * or null when none exists.
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
