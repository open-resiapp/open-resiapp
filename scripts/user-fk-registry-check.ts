/**
 * BYT-20261118-007 check (run: `pnpm test:user-fk-registry`).
 *
 * Every foreign key to users.id must have exactly one entry in the user-FK
 * registry (src/lib/user-fk-registry.ts) — merge, hard delete and the impact
 * planner are driven by it, so a new FK without a strategy would be silently
 * skipped by a merge or turn a delete into a 500.
 *
 * Static: reads the LATEST drizzle snapshot (drizzle/meta/*_snapshot.json),
 * no DB needed. The runtime twin (information_schema, read-only) is
 * findUnregisteredUserFks() in src/lib/user-fk-registry.server.ts.
 * Also asserts the registry's onDelete matches the schema. Exits non-zero
 * on any mismatch.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { USER_FK_REGISTRY, registryKey } from "@/lib/user-fk-registry";

const metaDir = join(process.cwd(), "drizzle", "meta");
const latest = readdirSync(metaDir)
  .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
  .sort()
  .at(-1);
if (!latest) throw new Error("no drizzle snapshot found");

interface Fk {
  tableTo: string;
  columnsFrom: string[];
  columnsTo: string[];
  onDelete?: string;
}
const snap = JSON.parse(readFileSync(join(metaDir, latest), "utf8")) as {
  tables: Record<string, { name: string; foreignKeys: Record<string, Fk> }>;
};

const inSchema = new Map<string, string>();
for (const t of Object.values(snap.tables)) {
  for (const fk of Object.values(t.foreignKeys)) {
    if (fk.tableTo === "users" && fk.columnsTo[0] === "id") {
      inSchema.set(`${t.name}.${fk.columnsFrom[0]}`, fk.onDelete ?? "no action");
    }
  }
}

const failures: string[] = [];
const seen = new Set<string>();
for (const e of USER_FK_REGISTRY) {
  const k = registryKey(e);
  if (seen.has(k)) failures.push(`duplicate registry entry: ${k}`);
  seen.add(k);
  const od = inSchema.get(k);
  if (od === undefined) failures.push(`registry entry not in schema (${latest}): ${k}`);
  else if (od !== e.onDelete) failures.push(`onDelete mismatch ${k}: schema=${od} registry=${e.onDelete}`);
  if (e.merge.kind === "drop" && e.retained) failures.push(`retained row cannot be dropped on merge: ${k}`);
}
for (const k of inSchema.keys()) {
  if (!seen.has(k)) failures.push(`FK to users.id without a registry strategy: ${k}`);
}

if (failures.length > 0) {
  console.error(`✗ user-FK registry check failed against ${latest}:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✓ user-FK registry covers all ${inSchema.size} FKs to users.id (${latest})`);
