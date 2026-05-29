import "server-only";

import { aliasedTable, and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships } from "@/db/schema";
import type {
  membershipRoleEnum,
  votingMethodEnum,
  countryEnum,
  governanceModelEnum,
} from "@/db/schema";

// Phase 9.2 cutover: legacy `building` / `entrances` / `flats` /
// `user_flats` tables are gone. The helpers below served the dual-run
// period; what remains are convenience wrappers that derive the same
// shapes from entities + memberships so call sites don't have to
// duplicate joins.
//
// BYT-20260515-001 Phase 2b: reads switched from housing_root_data /
// housing_unit_data to entities.data jsonb. Writes still target the
// legacy tables until Phase 2c. Both tables remain authoritative for
// rollback until Phase 8 drops them.

export type MembershipRole = (typeof membershipRoleEnum.enumValues)[number];
type VotingMethod = (typeof votingMethodEnum.enumValues)[number];
type Country = (typeof countryEnum.enumValues)[number];
type GovernanceModel = (typeof governanceModelEnum.enumValues)[number];

export interface CommunityRootRow {
  id: string;
  name: string;
  kind: string;
  address: string;
  ico: string | null;
  votingMethod: VotingMethod;
  country: Country;
  governanceModel: GovernanceModel;
  legalNotice: string | null;
  communityCrossEntranceVisible: boolean;
  /**
   * BYT-20260515-001 Phase 6: template slug the instance was
   * bootstrapped from (written by bootstrap-community.ts onto
   * entities.data.template_slug). Null on installs predating
   * Phase 5, falls back to "hoa" in callers that need a default.
   */
  templateSlug: string | null;
  createdAt: Date;
}

/**
 * The single housing root entity (community / block) — drop-in for
 * the previous `db.select().from(building).limit(1)` pattern.
 */
export async function getCommunityRoot(): Promise<CommunityRootRow | null> {
  const [row] = await db
    .select({
      id: entities.id,
      name: entities.name,
      kind: entities.kind,
      address: sql<string>`${entities.data}->>'address'`,
      ico: sql<string | null>`${entities.data}->>'ico'`,
      votingMethod: sql<VotingMethod>`${entities.data}->>'voting_method'`,
      country: sql<Country>`${entities.data}->>'country'`,
      governanceModel: sql<GovernanceModel>`${entities.data}->>'governance_model'`,
      legalNotice: sql<string | null>`${entities.data}->>'legal_notice'`,
      communityCrossEntranceVisible: sql<boolean>`coalesce((${entities.data}->>'community_cross_entrance_visible')::boolean, false)`,
      templateSlug: sql<string | null>`${entities.data}->>'template_slug'`,
      createdAt: entities.createdAt,
    })
    .from(entities)
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
export async function listCommunityRoots(): Promise<CommunityRootRow[]> {
  return db
    .select({
      id: entities.id,
      name: entities.name,
      kind: entities.kind,
      address: sql<string>`${entities.data}->>'address'`,
      ico: sql<string | null>`${entities.data}->>'ico'`,
      votingMethod: sql<VotingMethod>`${entities.data}->>'voting_method'`,
      country: sql<Country>`${entities.data}->>'country'`,
      governanceModel: sql<GovernanceModel>`${entities.data}->>'governance_model'`,
      legalNotice: sql<string | null>`${entities.data}->>'legal_notice'`,
      communityCrossEntranceVisible: sql<boolean>`coalesce((${entities.data}->>'community_cross_entrance_visible')::boolean, false)`,
      templateSlug: sql<string | null>`${entities.data}->>'template_slug'`,
      createdAt: entities.createdAt,
    })
    .from(entities)
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
  // Owner's share OF this unit (memberships.owner_unit_share_*) — distinct
  // from shareNumerator/Denominator above, which is the unit's share of the
  // whole community. For a sole owner this is 1/1; for co-owners it splits.
  ownerUnitShareNumerator: number;
  ownerUnitShareDenominator: number;
  area: number | null;
}

/**
 * Every unit entity the user holds an active membership at, joined
 * with unit data + parent (entrance) name. Drop-in for the legacy
 * `userFlats → flats → entrances` 3-way join.
 */
export async function listUserFlats(userId: string): Promise<UserFlatRow[]> {
  const entrance = aliasedTable(entities, "entrance");
  return db
    .select({
      flatId: entities.id,
      flatNumber: sql<string>`${entities.data}->>'flat_number'`,
      floor: sql<number>`coalesce((${entities.data}->>'floor')::int, 0)`,
      entranceId: entities.parentId,
      entranceName: entrance.name,
      shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
      ownerUnitShareNumerator: memberships.ownerUnitShareNumerator,
      ownerUnitShareDenominator: memberships.ownerUnitShareDenominator,
      area: sql<number | null>`(${entities.data}->>'area_m2')::numeric`,
    })
    .from(memberships)
    .innerJoin(entities, eq(memberships.entityId, entities.id))
    .leftJoin(entrance, eq(entrance.id, entities.parentId))
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.status, "active"),
        eq(entities.kind, "unit"),
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
 * returns the user's first active unit membership entity id, or
 * null when none exists.
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
        eq(entities.kind, "unit"),
        isNull(entities.archivedAt)
      )
    )
    .orderBy(memberships.createdAt)
    .limit(1);
  return row?.entityId ?? null;
}
