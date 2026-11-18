import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities } from "@/db/schema";
import { add, rational, ZERO, type Rational } from "@/lib/rational";

import { importUnitLabel, ownerKeysForRows } from "./owner-groups";
import {
  findExistingOwnerEmails,
  importUnitKey,
  matchExistingUnits,
  resolveKindChain,
} from "./seed";
import type { ImportRow } from "./types";

// Read-only dry run of an APPEND import against an existing community.
// Shared by the web import wizard (admin/import/actions.ts) and the MCP
// import_owners action (src/lib/mcp/actions/owners.ts) so both preview the
// exact numbers the seeder will write.
//
// seedImport (append mode) reuses an existing unit but still creates its
// owner rows — so re-importing a unit that already has owners would
// duplicate them. Such units are dropped here together with all their rows;
// existing units WITHOUT an owner keep their rows (owners are attached, the
// unit's own data stays as it is).

export interface ImportAnalysis {
  rowsToSeed: ImportRow[];
  skippedUnitKeys: string[];
  skippedLabels: string[];
  unitsInFile: number;
  unitsToCreate: number;
  unitsToFill: number;
  ownerLinks: number;
  /** Users the seeder will CREATE (one per owner group). */
  newAccounts: number;
  /** Owner groups matched to an existing account by e-mail. */
  matchedAccounts: number;
  /**
   * Share of the community's existing units the import does NOT touch —
   * added to the imported share for the community 1/1 check.
   */
  existingShareSum: { num: string; den: string };
  /** Leaf units already in the community. */
  existingUnits: number;
}

export async function analyseImport(input: {
  rows: ImportRow[];
  communityId: string;
  templateSlug?: string;
  splitOwnerGroups?: string[];
}): Promise<ImportAnalysis> {
  const { rows, communityId, templateSlug } = input;
  const matches = await matchExistingUnits({ rows, communityId, templateSlug });
  const skipped = new Set<string>();
  const fill = new Set<string>();
  for (const [k, m] of matches) (m.activeOwners > 0 ? skipped : fill).add(k);

  const rowsToSeed = rows.filter((r) => !skipped.has(importUnitKey(r)));
  const keptUnits = new Set(rowsToSeed.map(importUnitKey));
  const allUnits = new Set(rows.map(importUnitKey));

  // Mirror the seeder: one user per owner group; a group whose e-mail
  // belongs to an existing user reuses that account.
  const matched = await findExistingOwnerEmails(
    rowsToSeed.map((r) => r.owner_email ?? "").filter(Boolean)
  );
  const keys = ownerKeysForRows(rowsToSeed, input.splitOwnerGroups);
  const seenKeys = new Set<string>();
  const matchedUsed = new Set<string>();
  let newAccounts = 0;
  rowsToSeed.forEach((r, idx) => {
    const key = keys[idx];
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    const e = r.owner_email?.trim().toLowerCase();
    if (e && matched.has(e)) {
      matchedUsed.add(e);
      return;
    }
    newAccounts += 1;
  });

  const skippedLabels: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const k = importUnitKey(r);
    if (!skipped.has(k) || seen.has(k)) continue;
    seen.add(k);
    skippedLabels.push(importUnitLabel(r));
  }

  // Existing units' share (units this import does not touch).
  const kinds = await resolveKindChain(templateSlug);
  const touched = new Set([...matches.values()].map((m) => m.unitId));
  const existingLeaves = await db
    .select({
      id: entities.id,
      num: sql<string | null>`${entities.data}->>'share_numerator'`,
      den: sql<string | null>`${entities.data}->>'share_denominator'`,
    })
    .from(entities)
    .where(
      and(
        eq(entities.rootId, communityId),
        eq(entities.kind, kinds.leaf),
        isNull(entities.archivedAt)
      )
    );
  let existingShare: Rational = ZERO;
  for (const u of existingLeaves) {
    if (touched.has(u.id)) continue;
    const n = Number(u.num);
    const d = Number(u.den);
    if (Number.isInteger(n) && Number.isInteger(d) && n > 0 && d > 0) {
      existingShare = add(existingShare, rational(n, d));
    }
  }

  return {
    rowsToSeed,
    skippedUnitKeys: [...skipped].sort(),
    skippedLabels,
    unitsInFile: allUnits.size,
    unitsToCreate: [...keptUnits].filter((k) => !fill.has(k)).length,
    unitsToFill: [...keptUnits].filter((k) => fill.has(k)).length,
    ownerLinks: rowsToSeed.length,
    newAccounts,
    matchedAccounts: matchedUsed.size,
    existingShareSum: { num: existingShare.num.toString(), den: existingShare.den.toString() },
    existingUnits: existingLeaves.length,
  };
}
