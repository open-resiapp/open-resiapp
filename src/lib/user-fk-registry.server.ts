import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { USER_FK_REGISTRY, registryKey, type UserFkEntry } from "@/lib/user-fk-registry";

// BYT-20261118-007 — DB side of the user-FK registry. Read-only helpers.
// Identifiers come from the static registry (code constants), never from
// input; the user id is always a bound parameter.

type Executor = Pick<typeof db, "execute">;

function ident(name: string) {
  return sql.identifier(name);
}

/**
 * Row counts per registry entry for one user, in ONE round trip
 * (UNION ALL of indexed `count(*) WHERE col = $id`). Entries with 0 rows
 * are omitted.
 */
export async function countUserFkRows(
  userId: string,
  executor: Executor = db
): Promise<Map<string, number>> {
  const parts = USER_FK_REGISTRY.map(
    (e) =>
      sql`SELECT ${registryKey(e)}::text AS k, count(*)::int AS n FROM ${ident(e.table)} WHERE ${ident(e.column)} = ${userId}`
  );
  const query = sql.join(parts, sql` UNION ALL `);
  const res = await executor.execute(query);
  const rows = (res as unknown as { rows: { k: string; n: number }[] }).rows;
  const out = new Map<string, number>();
  for (const r of rows) if (Number(r.n) > 0) out.set(r.k, Number(r.n));
  return out;
}

export function entriesWithRows(
  counts: Map<string, number>,
  filter: (e: UserFkEntry) => boolean = () => true
): { entry: UserFkEntry; count: number }[] {
  return USER_FK_REGISTRY.filter(filter)
    .map((entry) => ({ entry, count: counts.get(registryKey(entry)) ?? 0 }))
    .filter((x) => x.count > 0);
}

/**
 * FK columns to users.id present in the database but missing from the
 * registry (and registry entries the database does not have). Read-only
 * information_schema query — run by the registry check
 * (scripts/check-user-fk-registry.ts) so a new FK without a strategy fails.
 */
export async function findUnregisteredUserFks(): Promise<{
  missing: string[];
  stale: string[];
}> {
  const res = await db.execute(sql`
    SELECT kcu.table_name AS t, kcu.column_name AS c
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_name = 'users'
      AND ccu.column_name = 'id'
  `);
  const rows = (res as unknown as { rows: { t: string; c: string }[] }).rows;
  const inDb = new Set(rows.map((r) => `${r.t}.${r.c}`));
  const inRegistry = new Set(USER_FK_REGISTRY.map(registryKey));
  return {
    missing: [...inDb].filter((k) => !inRegistry.has(k)).sort(),
    stale: [...inRegistry].filter((k) => !inDb.has(k)).sort(),
  };
}
