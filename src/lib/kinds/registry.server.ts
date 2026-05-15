import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { entityKinds } from "@/db/schema";
import {
  HOA_CATALOG_SEED,
  type KindCatalogRow,
} from "./registry";

// BYT-20260515-001 Phase 1a: server-side accessors for the
// per-instance kind catalog.

export async function listKinds(): Promise<KindCatalogRow[]> {
  const rows = await db
    .select()
    .from(entityKinds)
    .orderBy(entityKinds.sortOrder);

  return rows.map(toCatalogRow);
}

export async function getKind(slug: string): Promise<KindCatalogRow | null> {
  const [row] = await db
    .select()
    .from(entityKinds)
    .where(eq(entityKinds.slug, slug))
    .limit(1);

  return row ? toCatalogRow(row) : null;
}

// Idempotent: inserts only kinds that don't already exist for this
// instance. Safe to call on every boot or as part of setup.sh.
export async function seedCatalog(rows: KindCatalogRow[]): Promise<void> {
  for (const row of rows) {
    await db
      .insert(entityKinds)
      .values({
        slug: row.slug,
        displayNameKey: row.displayNameKey,
        icon: row.icon,
        allowsMembers: row.allowsMembers,
        votable: row.votable,
        allowedParentKinds: row.allowedParentKinds,
        dataSchema: row.dataSchema,
        sortOrder: row.sortOrder,
      })
      .onConflictDoNothing({ target: entityKinds.slug });
  }
}

export function seedHoaCatalog(): Promise<void> {
  return seedCatalog(HOA_CATALOG_SEED);
}

function toCatalogRow(row: typeof entityKinds.$inferSelect): KindCatalogRow {
  return {
    slug: row.slug,
    displayNameKey: row.displayNameKey,
    icon: row.icon,
    allowsMembers: row.allowsMembers,
    votable: row.votable,
    allowedParentKinds: row.allowedParentKinds,
    dataSchema: row.dataSchema as Record<string, unknown>,
    sortOrder: row.sortOrder,
  };
}
