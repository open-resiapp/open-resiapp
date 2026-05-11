import "server-only";

import { isNotNull } from "drizzle-orm";

import { db } from "@/db";
import {
  entities,
  entityAuditLog,
  housingRootData,
  housingUnitData,
  memberships,
  users,
} from "@/db/schema";
import { buildPath } from "@/lib/entity-tree";

import type { ImportRow } from "./types";
import { ownerCommunityShare } from "./validate";

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

  return db.transaction(async (tx) => {
    // ── 1. Community root ───────────────────────────────
    const communityId = crypto.randomUUID();
    const communityPath = buildPath(null, communityId);

    await tx.insert(entities).values({
      id: communityId,
      parentId: null,
      kind: "housing_community",
      name: first.community_name,
      path: communityPath,
      depth: 0,
      rootId: communityId,
    });

    await tx.insert(housingRootData).values({
      entityId: communityId,
      address: first.community_address,
      ico: first.community_ico ?? null,
      votingMethod: first.voting_method,
      country: first.country,
    });

    await tx.insert(entityAuditLog).values({
      actorUserId: input.actorUserId,
      action: "entity.create",
      entityId: communityId,
      afterJson: JSON.stringify({
        kind: "housing_community",
        name: first.community_name,
      }),
    });

    // ── 2. Blocks (optional) ────────────────────────────
    const blockIdByName = new Map<string, string>();
    for (const r of input.rows) {
      const k = blockKey(r);
      if (k === "" || blockIdByName.has(k)) continue;
      const blockId = crypto.randomUUID();
      const blockPath = buildPath(communityPath, blockId);
      await tx.insert(entities).values({
        id: blockId,
        parentId: communityId,
        kind: "housing_block",
        name: r.block_name!,
        path: blockPath,
        depth: 1,
        rootId: communityId,
      });
      await tx.insert(entityAuditLog).values({
        actorUserId: input.actorUserId,
        action: "entity.create",
        entityId: blockId,
        afterJson: JSON.stringify({ kind: "housing_block", name: r.block_name }),
      });
      blockIdByName.set(k, blockId);
    }

    // ── 3. Entrances (optional) ─────────────────────────
    interface EntranceCtx {
      id: string;
      path: string;
      depth: number;
    }
    const entranceCtxByKey = new Map<string, EntranceCtx>();
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

      const entranceId = crypto.randomUUID();
      const entrancePath = buildPath(parentPath, entranceId);
      await tx.insert(entities).values({
        id: entranceId,
        parentId: parent.id,
        kind: "housing_entrance",
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
          kind: "housing_entrance",
          name: r.entrance_label,
        }),
      });
      entranceCtxByKey.set(k, {
        id: entranceId,
        path: entrancePath,
        depth: parent.depth + 1,
      });
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

      const unitId = crypto.randomUUID();
      const unitPath = buildPath(parentPath, unitId);
      await tx.insert(entities).values({
        id: unitId,
        parentId,
        kind: "housing_unit",
        name: `Byt ${r.unit_number}`,
        path: unitPath,
        depth: parentDepth + 1,
        rootId: communityId,
      });

      await tx.insert(housingUnitData).values({
        entityId: unitId,
        flatNumber: r.unit_number,
        floor: r.unit_floor,
        shareNumerator: r.unit_share_numerator,
        shareDenominator: r.unit_share_denominator,
        area: r.unit_area_m2 ?? null,
      });

      await tx.insert(entityAuditLog).values({
        actorUserId: input.actorUserId,
        action: "entity.create",
        entityId: unitId,
        afterJson: JSON.stringify({
          kind: "housing_unit",
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
