import "server-only";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";

import type { StructureVariant } from "./types";

export interface ExportResult {
  structure: StructureVariant;
  community: {
    community_name: string;
    community_address: string;
    community_ico: string;
    country: string;
    voting_method: string;
    supisne_cislo: string;
  };
  rows: Array<Record<string, string | number>>;
}

/**
 * Export the current state of the active community as flat row records
 * matching the Easy Import column schema. Round-trip safe: importing the
 * resulting file into a freshly-wiped instance reproduces the same state.
 *
 * Returns `null` when no housing community exists yet (fresh instance).
 */
export async function exportCommunityAsImportRows(): Promise<ExportResult | null> {
  // Phase 2b: root settings read from entities.data jsonb.
  const [community] = await db
    .select({
      id: entities.id,
      name: entities.name,
      address: sql<string>`${entities.data}->>'address'`,
      ico: sql<string | null>`${entities.data}->>'ico'`,
      country: sql<string>`${entities.data}->>'country'`,
      votingMethod: sql<string>`${entities.data}->>'voting_method'`,
    })
    .from(entities)
    .where(
      and(eq(entities.kind, "community"), isNull(entities.archivedAt))
    )
    .limit(1);

  if (!community) return null;

  const blocks = await db
    .select({ id: entities.id, name: entities.name, parentId: entities.parentId })
    .from(entities)
    .where(
      and(
        eq(entities.kind, "building"),
        eq(entities.rootId, community.id),
        isNull(entities.archivedAt)
      )
    )
    .orderBy(asc(entities.name));

  const entrances = await db
    .select({ id: entities.id, name: entities.name, parentId: entities.parentId })
    .from(entities)
    .where(
      and(
        eq(entities.kind, "entrance"),
        eq(entities.rootId, community.id),
        isNull(entities.archivedAt)
      )
    )
    .orderBy(asc(entities.name));

  // Phase 2b: unit fields from entities.data jsonb. Note legacy column
  // `area` is exposed under the canonical jsonb key `area_m2`.
  const units = await db
    .select({
      id: entities.id,
      name: entities.name,
      parentId: entities.parentId,
      flatNumber: sql<string>`${entities.data}->>'flat_number'`,
      floor: sql<number>`coalesce((${entities.data}->>'floor')::int, 0)`,
      area: sql<number | null>`(${entities.data}->>'area_m2')::numeric`,
      shareNumerator: sql<number>`(${entities.data}->>'share_numerator')::int`,
      shareDenominator: sql<number>`(${entities.data}->>'share_denominator')::int`,
    })
    .from(entities)
    .where(
      and(
        eq(entities.kind, "unit"),
        eq(entities.rootId, community.id),
        isNull(entities.archivedAt)
      )
    )
    .orderBy(asc(entities.name));

  const unitIds = units.map((u) => u.id);
  const ownerLinks = unitIds.length
    ? await db
        .select({
          entityId: memberships.entityId,
          ownerUnitShareNumerator: memberships.ownerUnitShareNumerator,
          ownerUnitShareDenominator: memberships.ownerUnitShareDenominator,
          userName: users.name,
          userEmail: users.email,
          userPhone: users.phone,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            inArray(memberships.entityId, unitIds),
            eq(memberships.role, "owner"),
            eq(memberships.status, "active")
          )
        )
        .orderBy(asc(users.name))
    : [];

  const ownersByUnit = new Map<string, typeof ownerLinks>();
  for (const link of ownerLinks) {
    const slot = ownersByUnit.get(link.entityId) ?? [];
    slot.push(link);
    ownersByUnit.set(link.entityId, slot);
  }

  const entranceById = new Map(entrances.map((e) => [e.id, e]));
  const blockById = new Map(blocks.map((b) => [b.id, b]));

  // Structure detection from the actual tree: if any unit has a block ancestor →
  // community_block_entrance_unit; else if any unit has an entrance parent →
  // community_entrance_unit; else community_unit.
  let structure: StructureVariant = "community_unit";
  for (const u of units) {
    const parent = u.parentId ? entranceById.get(u.parentId) : null;
    if (parent) {
      structure = "community_entrance_unit";
      const grand = parent.parentId ? blockById.get(parent.parentId) : null;
      if (grand) {
        structure = "community_block_entrance_unit";
        break;
      }
    }
  }

  const rows: Array<Record<string, string | number>> = [];
  for (const u of units) {
    const entrance = u.parentId ? entranceById.get(u.parentId) : undefined;
    const block = entrance?.parentId ? blockById.get(entrance.parentId) : undefined;
    const ownersForUnit = ownersByUnit.get(u.id) ?? [];
    if (ownersForUnit.length === 0) {
      rows.push(buildRow(u, entrance?.name, block?.name, null));
      continue;
    }
    for (const owner of ownersForUnit) {
      rows.push(buildRow(u, entrance?.name, block?.name, owner));
    }
  }

  return {
    structure,
    community: {
      community_name: community.name,
      community_address: community.address,
      community_ico: community.ico ?? "",
      country: community.country,
      voting_method: community.votingMethod,
      supisne_cislo: "",
    },
    rows,
  };
}

type UnitRow = {
  id: string;
  flatNumber: string;
  floor: number;
  area: number | null;
  shareNumerator: number;
  shareDenominator: number;
};

type OwnerLink = {
  ownerUnitShareNumerator: number;
  ownerUnitShareDenominator: number;
  userName: string;
  userEmail: string | null;
  userPhone: string | null;
};

function buildRow(
  unit: UnitRow,
  entranceName: string | undefined,
  blockName: string | undefined,
  owner: OwnerLink | null
): Record<string, string | number> {
  const row: Record<string, string | number> = {
    unit_number: unit.flatNumber,
    unit_floor: unit.floor === 0 ? "prízemie" : String(unit.floor),
    unit_area_m2: unit.area ?? "",
    unit_share_numerator: String(unit.shareNumerator),
    unit_share_denominator: String(unit.shareDenominator),
    owner_name: owner?.userName ?? "",
    owner_address: "",
    owner_email: owner?.userEmail ?? "",
    owner_phone: owner?.userPhone ?? "",
    owner_unit_share_numerator: owner ? String(owner.ownerUnitShareNumerator) : "1",
    owner_unit_share_denominator: owner ? String(owner.ownerUnitShareDenominator) : "1",
  };
  if (entranceName) row.entrance_label = entranceName;
  if (blockName) row.block_name = blockName;
  return row;
}

/**
 * Splat community-scope fields onto every row so the resulting file is
 * self-contained — importing it on a fresh instance picks up the community
 * details from row 1 without requiring the operator to re-type them.
 */
export function flattenForExport(result: ExportResult): Array<Record<string, string | number>> {
  return result.rows.map((r) => ({ ...result.community, ...r }));
}
