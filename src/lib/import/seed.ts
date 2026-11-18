import "server-only";

import { and, count, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { db } from "@/db";
import {
  entities,
  entityAuditLog,
  memberships,
  users,
} from "@/db/schema";
import { buildPath } from "@/lib/entity-tree";
import { getTemplate } from "@/lib/templates/loader";
import { routing } from "@/i18n/routing";
import { isUnitType } from "@/lib/unit-type";

import { importUnitLabel, ownerKeysForRows } from "./owner-groups";
import type { ImportRow } from "./types";
import { ownerCommunityShare } from "./validate";

// BYT-20260515-001 Phase 6b: the kind slugs the seeder emits at each
// tree level. Falls back to the HOA chain when the template is missing
// or doesn't declare 4 levels — matches pre-2026-05 behaviour.
export interface KindChain {
  root: string;
  block: string | null;
  entrance: string | null;
  leaf: string;
}

export async function resolveKindChain(templateSlug: string | undefined): Promise<KindChain> {
  const fallback: KindChain = {
    root: "community",
    block: "building",
    entrance: "entrance",
    leaf: "unit",
  };
  if (!templateSlug) return fallback;
  const tpl = await getTemplate(templateSlug);
  if (!tpl) return fallback;
  const levels = tpl.import_levels;
  // Levels are top-down: [root, …branches…, leaf]. We map the trailing
  // two as `block`/`entrance` for 4-level shapes, `entrance`-only for
  // 3-level, and skip both for 2-level. This matches the existing
  // CSV row contract (block_name → 4-level, entrance_label → 3+-level,
  // unit_number → leaf).
  switch (levels.length) {
    case 0:
      return { root: tpl.root_kind, block: null, entrance: null, leaf: fallback.leaf };
    case 1:
      return { root: levels[0], block: null, entrance: null, leaf: fallback.leaf };
    case 2:
      return { root: levels[0], block: null, entrance: null, leaf: levels[1] };
    case 3:
      return { root: levels[0], block: null, entrance: levels[1], leaf: levels[2] };
    case 4:
    default:
      return { root: levels[0], block: levels[1], entrance: levels[2], leaf: levels[3] };
  }
}

/** Roles that hold a unit (owner in an SVB, member in a družstvo). */
const UNIT_HOLDER_ROLES: ("owner" | "member")[] = ["owner", "member"];

/** Template's `member_role` (BYT-20261118-020); `owner` when absent. */
async function resolveHolderRole(
  templateSlug: string | undefined
): Promise<"owner" | "member"> {
  if (!templateSlug) return "owner";
  const tpl = await getTemplate(templateSlug);
  return tpl?.member_role ?? "owner";
}

export class DuplicateCommunityError extends Error {
  constructor(
    public existingId: string,
    public name: string,
    public address: string
  ) {
    super(
      `Community "${name}" at "${address}" already exists (entityId ${existingId})`
    );
    this.name = "DuplicateCommunityError";
  }
}

type UnitNamer = (r: ImportRow) => string;

/**
 * Display name of a seeded leaf, by unit type (HOA `unit` leaves: "Byt 12",
 * "Garáž 3", "Nebytový priestor 4") or by the template's leaf kind for
 * non-HOA templates ("Záhradka / parcela 7"). The LV parser numbers non-flat
 * units "NP 3" so they never collide with byt č. 3 in the same entrance —
 * that number stays in data.flat_number (the re-import key); the display
 * name drops the prefix. Language: the importing admin's locale.
 */
async function unitNamer(leafKind: string, locale: string | undefined): Promise<UnitNamer> {
  const loc = locale ?? routing.defaultLocale;
  const tType = await getTranslations({ locale: loc, namespace: "UnitType" });
  const tKind = await getTranslations({ locale: loc, namespace: "Kinds" });
  return (r) => {
    const num = String(r.unit_number).trim();
    if (leafKind !== "unit") {
      const label = tKind.has(leafKind) ? tKind(leafKind as never) : leafKind;
      return `${label} ${num}`;
    }
    const type = isUnitType(r.unit_type) ? r.unit_type : "flat";
    const shortNum = type === "flat" ? num : num.replace(/^NP\s*/i, "");
    return `${tType(type)} ${shortNum}`;
  };
}

/** Legacy seeded name of every leaf (pre-2026-11): "Byt <N>". */
const legacyLeafName = (unitNumber: string) => `Byt ${unitNumber}`;

/**
 * Lookup any active housing_community with a name OR address matching the
 * given import. Either match counts as a duplicate — the seeder refuses
 * to create a second one without the admin explicitly archiving the
 * existing root first.
 *
 * Returns `null` when nothing matches.
 */
export async function findExistingCommunity(
  name: string,
  address: string
): Promise<{ id: string; name: string; address: string } | null> {
  // Phase 2b: address lives on entities.data jsonb.
  const rows = await db
    .select({
      id: entities.id,
      name: entities.name,
      address: sql<string>`${entities.data}->>'address'`,
    })
    .from(entities)
    .where(
      and(
        eq(entities.kind, "community"),
        isNull(entities.archivedAt),
        sql`(LOWER(${entities.name}) = LOWER(${name}) OR LOWER(${entities.data}->>'address') = LOWER(${address}))`
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

// Project-wide scale for integer memberships.weight.
// See spec BYT-20260508-003 "Approach §4" — pin to a single constant.
const WEIGHT_SCALE = 1_000_000n;

const unitKey = (r: ImportRow) =>
  `${r.block_name ?? ""}|${r.entrance_label ?? ""}|${r.unit_number}`;
/** The seeder's per-unit row key ("block|entrance|unit_number"). */
export const importUnitKey = unitKey;
const entranceKey = (r: ImportRow) =>
  `${r.block_name ?? ""}|${r.entrance_label ?? ""}`;
const blockKey = (r: ImportRow) => r.block_name ?? "";

export interface SeedInput {
  rows: ImportRow[];
  actorUserId: string;
  /**
   * When provided, the seeder skips community creation and attaches all
   * new entities under this existing root. Blocks and entrances are reused
   * by name when they already exist; units are skipped when an entity with
   * the same (block, entrance, unit_number) is already present. This makes
   * re-imports an idempotent append rather than a hard failure.
   */
  existingCommunityId?: string;
  /**
   * BYT-20260515-001 Phase 6: identifier of the community template the
   * import wizard operated under. Today the seeder still writes the HOA
   * kind chain (community → building → entrance → unit) regardless of
   * this value; Phase 6b will fork on the template's `import_levels` to
   * write the correct kinds for garden / garage / street / etc. The
   * field is plumbed now so the API contract stabilizes early.
   */
  templateSlug?: string;
  /**
   * Owner-group keys (owner-groups.ts ownerIdentityKey) the admin split into
   * separate people in the preview. Every other group = ONE user.
   */
  splitOwnerGroups?: string[];
  /** Locale for the seeded unit names ("Byt 12" / "Flat 12"). */
  locale?: string;
}

export interface SeededOwner {
  userId: string;
  name: string;
  /** Unit labels the owner was linked to in this import. */
  units: string[];
}

export interface SeedResult {
  communityEntityId: string;
  unitsCreated: number;
  /** Existing units the import attached owners to (append mode). */
  unitsReused: number;
  ownersCreated: number;
  ownersReused: number;
  membershipsCreated: number;
  /** Owner links skipped because the (user, unit) membership already exists. */
  membershipsSkipped: number;
  /** Users CREATED by this import (shell owners) — for "is this you?". */
  createdOwners: SeededOwner[];
}

/**
 * Atomically seed an entire HOA from a validated row set. All writes happen
 * inside one transaction; throwing rolls everything back.
 *
 * Assumes input has already passed validateImport(). Re-validates only the
 * invariants that depend on DB state (e.g. email-uniqueness) so the caller
 * does not need to round-trip again.
 */
export async function seedImport(input: SeedInput): Promise<SeedResult> {
  if (input.rows.length === 0) {
    throw new Error("seedImport: empty rows");
  }
  const first = input.rows[0];

  // Phase 6b: kind slugs come from the template's `import_levels`.
  // HOA fallback keeps existing imports byte-identical.
  const kinds = await resolveKindChain(input.templateSlug);
  const nameUnit = await unitNamer(kinds.leaf, input.locale);
  // BYT-20261118-020: a unit's holder is `owner` in an SVB but `member`
  // (člen družstva, §240 Obch. zák. / §755 ZOK) in a bytové družstvo.
  const holderRole = await resolveHolderRole(input.templateSlug);

  // Duplicate guard only applies when CREATING a community — skip when the
  // caller is intentionally attaching to an existing one.
  if (!input.existingCommunityId) {
    const existing = await findExistingCommunity(
      first.community_name,
      first.community_address
    );
    if (existing) {
      throw new DuplicateCommunityError(
        existing.id,
        existing.name,
        existing.address
      );
    }
  }

  return db.transaction(async (tx) => {
    // ── 1. Community root ───────────────────────────────
    let communityId: string;
    let communityPath: string;

    if (input.existingCommunityId) {
      // Reuse the existing community root. Look up its path so child
      // entities below get correct path / depth.
      const [existing] = await tx
        .select({ id: entities.id, path: entities.path })
        .from(entities)
        .where(eq(entities.id, input.existingCommunityId))
        .limit(1);
      if (!existing) {
        throw new Error(
          `existingCommunityId ${input.existingCommunityId} not found`
        );
      }
      communityId = existing.id;
      communityPath = existing.path;
    } else {
      communityId = crypto.randomUUID();
      communityPath = buildPath(null, communityId);

      // Phase 2b dual-write: root settings live on entities.data jsonb
      // (read-path truth) AND in housing_root_data (rollback source).
      await tx.insert(entities).values({
        id: communityId,
        parentId: null,
        kind: kinds.root,
        name: first.community_name,
        path: communityPath,
        depth: 0,
        rootId: communityId,
        data: {
          address: first.community_address,
          ico: first.community_ico ?? null,
          dic: first.community_dic?.trim().slice(0, 20) || null,
          voting_method: first.voting_method,
          country: first.country,
          template_slug: input.templateSlug ?? null,
        },
      });

      // Phase 8a: legacy housing_root_data dual-write removed.
      // Root fields live exclusively on entities.data jsonb (already
      // written inline on the insert above).

      await tx.insert(entityAuditLog).values({
        actorUserId: input.actorUserId,
        action: "entity.create",
        entityId: communityId,
        afterJson: JSON.stringify({
          kind: kinds.root,
          name: first.community_name,
        }),
      });
    }

    // Pre-load existing child entities under this community so the seeder
    // can reuse blocks/entrances and skip units that already exist.
    const existingChildren = input.existingCommunityId
      ? await tx
          .select({
            id: entities.id,
            parentId: entities.parentId,
            kind: entities.kind,
            name: entities.name,
            path: entities.path,
            depth: entities.depth,
            flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
          })
          .from(entities)
          .where(
            and(
              eq(entities.rootId, communityId),
              isNull(entities.archivedAt)
            )
          )
      : [];
    const existingByKindAndKey = new Map<string, (typeof existingChildren)[number]>();
    // Key formats:
    //   block:   "block|<name>"
    //   entrance:"entrance|<parentId>|<name>"
    //   unit:    "unit|<parentId>|<flatNumber>" (data.flat_number), plus
    //            "unitname|<parentId>|<name>" for legacy rows without it.
    // The unit is matched by its NUMBER, not its display name, so renaming a
    // unit or changing its type never breaks the re-import match.
    for (const e of existingChildren) {
      if (kinds.block && e.kind === kinds.block) {
        existingByKindAndKey.set(`block|${e.name}`, e);
      } else if (kinds.entrance && e.kind === kinds.entrance && e.parentId) {
        existingByKindAndKey.set(`entrance|${e.parentId}|${e.name}`, e);
      } else if (e.kind === kinds.leaf && e.parentId) {
        if (e.flatNumber) existingByKindAndKey.set(`unit|${e.parentId}|${e.flatNumber}`, e);
        existingByKindAndKey.set(`unitname|${e.parentId}|${e.name}`, e);
      }
    }

    // ── 2. Blocks (optional) — reuse if already present ─
    const blockIdByName = new Map<string, string>();
    if (kinds.block) {
      for (const r of input.rows) {
        const k = blockKey(r);
        if (k === "" || blockIdByName.has(k)) continue;
        const existing = existingByKindAndKey.get(`block|${r.block_name}`);
        if (existing) {
          blockIdByName.set(k, existing.id);
          continue;
        }
        const blockId = crypto.randomUUID();
        const blockPath = buildPath(communityPath, blockId);
        await tx.insert(entities).values({
          id: blockId,
          parentId: communityId,
          kind: kinds.block,
          name: r.block_name!,
          path: blockPath,
          depth: 1,
          rootId: communityId,
        });
        await tx.insert(entityAuditLog).values({
          actorUserId: input.actorUserId,
          action: "entity.create",
          entityId: blockId,
          afterJson: JSON.stringify({ kind: kinds.block, name: r.block_name }),
        });
        blockIdByName.set(k, blockId);
      }
    }

    // ── 3. Entrances (optional) — reuse if already present
    interface EntranceCtx {
      id: string;
      path: string;
      depth: number;
    }
    const entranceCtxByKey = new Map<string, EntranceCtx>();
    if (kinds.entrance) {
      for (const r of input.rows) {
        const k = entranceKey(r);
        if (k === "|" || entranceCtxByKey.has(k)) continue;
        // Skip if no entrance label at all (single-level community).
        if (!r.entrance_label) continue;

        const parent = r.block_name
          ? { id: blockIdByName.get(blockKey(r))!, path: undefined, depth: 1 }
          : { id: communityId, path: communityPath, depth: 0 };
        // Reconstruct parent path if it came from a block (we didn't store it).
        const parentPath = parent.path ?? buildPath(communityPath, parent.id);

        const existing = existingByKindAndKey.get(
          `entrance|${parent.id}|${r.entrance_label}`
        );
        if (existing) {
          entranceCtxByKey.set(k, {
            id: existing.id,
            path: existing.path,
            depth: existing.depth,
          });
          continue;
        }

        const entranceId = crypto.randomUUID();
        const entrancePath = buildPath(parentPath, entranceId);
        await tx.insert(entities).values({
          id: entranceId,
          parentId: parent.id,
          kind: kinds.entrance,
          name: r.entrance_label,
          path: entrancePath,
          depth: parent.depth + 1,
          rootId: communityId,
        });
        await tx.insert(entityAuditLog).values({
          actorUserId: input.actorUserId,
          action: "entity.create",
          entityId: entranceId,
          afterJson: JSON.stringify({
            kind: kinds.entrance,
            name: r.entrance_label,
          }),
        });
        entranceCtxByKey.set(k, {
          id: entranceId,
          path: entrancePath,
          depth: parent.depth + 1,
        });
      }
    }

    // ── 4. Units ────────────────────────────────────────
    interface UnitCtx {
      id: string;
      path: string;
      depth: number;
    }
    const unitCtxByKey = new Map<string, UnitCtx>();
    let unitsCreated = 0;
    let unitsReused = 0;
    for (const r of input.rows) {
      const k = unitKey(r);
      if (unitCtxByKey.has(k)) continue;

      // Pick parent: entrance > block > community.
      let parentId = communityId;
      let parentPath = communityPath;
      let parentDepth = 0;
      const ek = entranceKey(r);
      const entranceCtx = entranceCtxByKey.get(ek);
      if (entranceCtx) {
        parentId = entranceCtx.id;
        parentPath = entranceCtx.path;
        parentDepth = entranceCtx.depth;
      } else if (r.block_name) {
        const blockId = blockIdByName.get(blockKey(r))!;
        parentId = blockId;
        parentPath = buildPath(communityPath, blockId);
        parentDepth = 1;
      }

      // Display name by unit type / template leaf kind ("Byt 12",
      // "Garáž 3"). The re-import key is data.flat_number, not this name.
      const leafName = nameUnit(r);

      // Reuse a leaf with the same parent + number already in the tree
      // (re-import is idempotent — adds new entries, leaves existing ones
      // untouched).
      const existingUnit =
        existingByKindAndKey.get(`unit|${parentId}|${r.unit_number}`) ??
        existingByKindAndKey.get(`unitname|${parentId}|${legacyLeafName(r.unit_number)}`);
      if (existingUnit) {
        unitCtxByKey.set(k, {
          id: existingUnit.id,
          path: existingUnit.path,
          depth: existingUnit.depth,
        });
        unitsReused += 1;
        continue;
      }

      const unitId = crypto.randomUUID();
      const unitPath = buildPath(parentPath, unitId);
      // Phase 2b dual-write: leaf fields on entities.data jsonb
      // (read-path truth) AND in housing_unit_data (rollback source,
      // HOA-only). Phase 6b: the legacy `housing_unit_data` insert
      // only fires when the leaf kind is `unit` — non-HOA leaves
      // (plot, garage, house, etc.) live exclusively on entities.data
      // and never touched the legacy table.
      // Note: legacy column `area` ↔ canonical jsonb key `area_m2`.
      await tx.insert(entities).values({
        id: unitId,
        parentId,
        kind: kinds.leaf,
        name: leafName,
        path: unitPath,
        depth: parentDepth + 1,
        rootId: communityId,
        data: {
          flat_number: r.unit_number,
          floor: r.unit_floor ?? null,
          share_numerator: r.unit_share_numerator,
          share_denominator: r.unit_share_denominator,
          area_m2: r.unit_area_m2 ?? null,
          // Typ priestoru (src/lib/unit-type.ts) — only for HOA `unit`
          // leaves and only when known; absent = unclassified (read as
          // "flat"). No effect on voting weight (SK §14(3)).
          ...(kinds.leaf === "unit" && r.unit_type ? { unit_type: r.unit_type } : {}),
        },
      });

      // Phase 8a: legacy housing_unit_data dual-write removed.
      // Leaf fields live exclusively on entities.data jsonb (written
      // inline on the entity insert above).

      await tx.insert(entityAuditLog).values({
        actorUserId: input.actorUserId,
        action: "entity.create",
        entityId: unitId,
        afterJson: JSON.stringify({
          kind: kinds.leaf,
          flatNumber: r.unit_number,
          floor: r.unit_floor ?? null,
        }),
      });

      unitCtxByKey.set(k, {
        id: unitId,
        path: unitPath,
        depth: parentDepth + 1,
      });
      unitsCreated += 1;
    }

    // ── 5. Owners + memberships ─────────────────────────
    let ownersCreated = 0;
    let ownersReused = 0;
    let membershipsCreated = 0;
    let membershipsSkipped = 0;

    // Pre-fetch any matching real users by lowercased email.
    const emailLookup = new Map<string, string>(); // lowercased email → userId
    const inputEmails = Array.from(
      new Set(
        input.rows
          .map((r) => r.owner_email?.trim().toLowerCase())
          .filter((e): e is string => !!e)
      )
    );
    if (inputEmails.length > 0) {
      const existing = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(
          and(isNotNull(users.email), inArray(sql<string>`lower(${users.email})`, inputEmails))
        );
      for (const u of existing) {
        if (u.email) emailLookup.set(u.email.toLowerCase(), u.id);
      }
    }

    // ONE user per owner group (same e-mail / IČO / name + address), so a
    // person owning a flat and a garage is one account with two
    // memberships. The preview counted the same groups (validate.ts).
    const ownerKeys = ownerKeysForRows(input.rows, input.splitOwnerGroups);
    const userIdByOwnerKey = new Map<string, string>();
    const reusedUserIds = new Set<string>();
    const createdOwners = new Map<string, SeededOwner>();

    for (const [rowIdx, r] of input.rows.entries()) {
      const ctx = unitCtxByKey.get(unitKey(r))!;
      const emailKey = r.owner_email?.trim().toLowerCase();
      const ownerKey = ownerKeys[rowIdx];

      let userId = userIdByOwnerKey.get(ownerKey);
      if (!userId && emailKey && emailLookup.has(emailKey)) {
        userId = emailLookup.get(emailKey)!;
        if (!reusedUserIds.has(userId)) {
          reusedUserIds.add(userId);
          ownersReused += 1;
        }
      }
      if (!userId) {
        userId = crypto.randomUUID();
        await tx.insert(users).values({
          id: userId,
          email: emailKey ?? null,
          passwordHash: null,
          name: r.owner_name,
          phone: r.owner_phone ?? null,
          role: holderRole,
          platformRole: "member",
          isActive: true,
          status: "pending",
        });
        if (emailKey) emailLookup.set(emailKey, userId);
        createdOwners.set(userId, { userId, name: r.owner_name, units: [] });
        ownersCreated += 1;
      }
      userIdByOwnerKey.set(ownerKey, userId);
      createdOwners.get(userId)?.units.push(importUnitLabel(r));

      // Skip membership creation if (user, unit) already exists — re-imports
      // on a unit that already has owners shouldn't duplicate the link.
      if (input.existingCommunityId) {
        const [dup] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, userId),
              eq(memberships.entityId, ctx.id),
              // Current only — a former owner re-buying gets a new period.
              isNull(memberships.validTo)
            )
          )
          .limit(1);
        if (dup) {
          membershipsSkipped += 1;
          continue;
        }
      }

      const shareOfCommunity = ownerCommunityShare(r);
      const weight = Number(
        (shareOfCommunity.num * WEIGHT_SCALE) / shareOfCommunity.den
      );

      await tx.insert(memberships).values({
        userId,
        entityId: ctx.id,
        role: holderRole,
        weight,
        ownerUnitShareNumerator: r.owner_unit_share_numerator,
        ownerUnitShareDenominator: r.owner_unit_share_denominator,
        status: "active",
        // BYT-20261118-003: LV facts for the ownership checks (NULL when
        // the row did not come from an LV).
        lvOrdinal: r.lv_ordinal ?? null,
        ownershipForm: r.ownership_form === "bsm" ? "bsm" : null,
      });
      await tx.insert(entityAuditLog).values({
        actorUserId: input.actorUserId,
        action: "membership.create",
        entityId: ctx.id,
        afterJson: JSON.stringify({
          userId,
          role: holderRole,
          ownerUnitShare: `${r.owner_unit_share_numerator}/${r.owner_unit_share_denominator}`,
        }),
      });
      membershipsCreated += 1;
    }

    return {
      communityEntityId: communityId,
      unitsCreated,
      unitsReused,
      ownersCreated,
      ownersReused,
      membershipsCreated,
      membershipsSkipped,
      createdOwners: [...createdOwners.values()],
    };
  });
}

export interface ExistingUnitMatch {
  unitId: string;
  /** Active owner memberships on the unit right now. */
  activeOwners: number;
}

/**
 * Read-only dry run of the seeder's append matching: which import rows
 * point at a unit that already exists under `communityId` (same parent +
 * unit-number lookup as seedImport with existingCommunityId), keyed by
 * importUnitKey. A row whose block / entrance does not exist yet cannot
 * match — the seeder would create it, and the unit with it.
 */
export async function matchExistingUnits(input: {
  rows: ImportRow[];
  communityId: string;
  templateSlug?: string;
}): Promise<Map<string, ExistingUnitMatch>> {
  const kinds = await resolveKindChain(input.templateSlug);
  const children = await db
    .select({
      id: entities.id,
      parentId: entities.parentId,
      kind: entities.kind,
      name: entities.name,
      flatNumber: sql<string | null>`${entities.data}->>'flat_number'`,
    })
    .from(entities)
    .where(and(eq(entities.rootId, input.communityId), isNull(entities.archivedAt)));
  const byKey = new Map<string, string>();
  for (const e of children) {
    if (kinds.block && e.kind === kinds.block) byKey.set(`block|${e.name}`, e.id);
    else if (kinds.entrance && e.kind === kinds.entrance && e.parentId) {
      byKey.set(`entrance|${e.parentId}|${e.name}`, e.id);
    } else if (e.kind === kinds.leaf && e.parentId) {
      // Same match as seedImport: data.flat_number, legacy name fallback.
      if (e.flatNumber) byKey.set(`unit|${e.parentId}|${e.flatNumber}`, e.id);
      byKey.set(`unitname|${e.parentId}|${e.name}`, e.id);
    }
  }

  const unitIdByKey = new Map<string, string>();
  for (const r of input.rows) {
    const k = unitKey(r);
    if (unitIdByKey.has(k)) continue;
    let blockId: string | null = null;
    if (kinds.block && r.block_name) {
      blockId = byKey.get(`block|${r.block_name}`) ?? null;
      if (!blockId) continue;
    }
    let parentId: string = input.communityId;
    if (kinds.entrance && r.entrance_label) {
      const entranceId = byKey.get(`entrance|${blockId ?? input.communityId}|${r.entrance_label}`);
      if (!entranceId) continue;
      parentId = entranceId;
    } else if (blockId) {
      parentId = blockId;
    }
    const unitId =
      byKey.get(`unit|${parentId}|${r.unit_number}`) ??
      byKey.get(`unitname|${parentId}|${legacyLeafName(r.unit_number)}`);
    if (unitId) unitIdByKey.set(k, unitId);
  }

  const ids = [...new Set(unitIdByKey.values())];
  const owners = ids.length
    ? await db
        .select({ unitId: memberships.entityId, n: count() })
        .from(memberships)
        .where(
          and(
            inArray(memberships.entityId, ids),
            inArray(memberships.role, UNIT_HOLDER_ROLES),
            eq(memberships.status, "active")
          )
        )
        .groupBy(memberships.entityId)
    : [];
  const ownersById = new Map(owners.map((o) => [o.unitId, Number(o.n)]));
  const out = new Map<string, ExistingUnitMatch>();
  for (const [k, unitId] of unitIdByKey) {
    out.set(k, { unitId, activeOwners: ownersById.get(unitId) ?? 0 });
  }
  return out;
}

/**
 * Lower-cased e-mails (from `emails`) that already belong to a user — the
 * accounts seedImport would REUSE instead of creating a new owner.
 */
export async function findExistingOwnerEmails(emails: string[]): Promise<Set<string>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (wanted.length === 0) return new Set();
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(sql<string>`lower(${users.email})`, wanted));
  return new Set(rows.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean));
}
