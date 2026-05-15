import "server-only";

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  entities,
  entityAuditLog,
  memberships,
  users,
} from "@/db/schema";
import { buildPath } from "@/lib/entity-tree";
import { getTemplate } from "@/lib/templates/loader";

import type { ImportRow } from "./types";
import { ownerCommunityShare } from "./validate";

// BYT-20260515-001 Phase 6b: the kind slugs the seeder emits at each
// tree level. Falls back to the HOA chain when the template is missing
// or doesn't declare 4 levels — matches pre-2026-05 behaviour.
interface KindChain {
  root: string;
  block: string | null;
  entrance: string | null;
  leaf: string;
}

async function resolveKindChain(templateSlug: string | undefined): Promise<KindChain> {
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
}

export interface SeedResult {
  communityEntityId: string;
  unitsCreated: number;
  ownersCreated: number;
  ownersReused: number;
  membershipsCreated: number;
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
    //   unit:    "unit|<parentId>|<flatNumber>"
    // Unit names follow the seeder's "Byt <N>" convention; the lookup
    // matches on the template's level slugs so non-HOA imports
    // (kinds.block = "garage_block", kinds.leaf = "plot", …) reuse the
    // same idempotent-attach path.
    for (const e of existingChildren) {
      if (kinds.block && e.kind === kinds.block) {
        existingByKindAndKey.set(`block|${e.name}`, e);
      } else if (kinds.entrance && e.kind === kinds.entrance && e.parentId) {
        existingByKindAndKey.set(`entrance|${e.parentId}|${e.name}`, e);
      } else if (e.kind === kinds.leaf && e.parentId) {
        existingByKindAndKey.set(`unit|${e.parentId}|${e.name}`, e);
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

      // The seeder always names the leaf "Byt <N>" for HOA back-compat;
      // for non-HOA templates this is still the friendliest default
      // because the row schema uses `unit_number` as the leaf
      // identifier. Operators can rename via the UI afterwards.
      const leafName = `Byt ${r.unit_number}`;

      // Skip if a leaf with the same parent + label is already in the
      // tree (re-import is idempotent — adds new entries, leaves
      // existing ones untouched).
      const existingUnit = existingByKindAndKey.get(
        `unit|${parentId}|${leafName}`
      );
      if (existingUnit) {
        unitCtxByKey.set(k, {
          id: existingUnit.id,
          path: existingUnit.path,
          depth: existingUnit.depth,
        });
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
          floor: r.unit_floor,
          share_numerator: r.unit_share_numerator,
          share_denominator: r.unit_share_denominator,
          area_m2: r.unit_area_m2 ?? null,
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
          floor: r.unit_floor,
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
      // Drizzle: build OR via inArray would be nice but emails are exact.
      // Use the partial unique index — query non-null emails only.
      const existing = await tx
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(isNotNull(users.email));
      for (const u of existing) {
        if (u.email) emailLookup.set(u.email.toLowerCase(), u.id);
      }
    }

    for (const r of input.rows) {
      const ctx = unitCtxByKey.get(unitKey(r))!;
      const emailKey = r.owner_email?.trim().toLowerCase();

      let userId: string;
      if (emailKey && emailLookup.has(emailKey)) {
        userId = emailLookup.get(emailKey)!;
        ownersReused += 1;
      } else {
        userId = crypto.randomUUID();
        await tx.insert(users).values({
          id: userId,
          email: emailKey ?? null,
          passwordHash: null,
          name: r.owner_name,
          phone: r.owner_phone ?? null,
          role: "owner",
          platformRole: "member",
          isActive: true,
          status: "pending",
        });
        if (emailKey) emailLookup.set(emailKey, userId);
        ownersCreated += 1;
      }

      // Skip membership creation if (user, unit) already exists — re-imports
      // on a unit that already has owners shouldn't duplicate the link.
      if (input.existingCommunityId) {
        const [dup] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(
              eq(memberships.userId, userId),
              eq(memberships.entityId, ctx.id)
            )
          )
          .limit(1);
        if (dup) continue;
      }

      const shareOfCommunity = ownerCommunityShare(r);
      const weight = Number(
        (shareOfCommunity.num * WEIGHT_SCALE) / shareOfCommunity.den
      );

      await tx.insert(memberships).values({
        userId,
        entityId: ctx.id,
        role: "owner",
        weight,
        ownerUnitShareNumerator: r.owner_unit_share_numerator,
        ownerUnitShareDenominator: r.owner_unit_share_denominator,
        status: "active",
      });
      await tx.insert(entityAuditLog).values({
        actorUserId: input.actorUserId,
        action: "membership.create",
        entityId: ctx.id,
        afterJson: JSON.stringify({
          userId,
          role: "owner",
          ownerUnitShare: `${r.owner_unit_share_numerator}/${r.owner_unit_share_denominator}`,
        }),
      });
      membershipsCreated += 1;
    }

    return {
      communityEntityId: communityId,
      unitsCreated,
      ownersCreated,
      ownersReused,
      membershipsCreated,
    };
  });
}
