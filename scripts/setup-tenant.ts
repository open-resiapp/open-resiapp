#!/usr/bin/env node
/**
 * `pnpm setup:tenant` — first-time tenant bootstrap.
 *
 * Default seeds a single housing community with one entrance and a flat
 * placeholder, mirroring today's experience. `--kind <other>` swaps to
 * a non-housing seed shape.
 *
 * Operator-only, runs against the local DB via Drizzle. NOT a runtime
 * endpoint — invoke from a shell or the Docker entrypoint on first
 * provisioning. RES-20260501-002 §"Operator-only mutation surface" #1.
 */
import "dotenv/config";

import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";

import * as coreSchema from "@/db/schema";
import * as votingSchema from "@modules/voting/src/db/schema";

const SUPPORTED_KINDS = [
  "housing_community",
  "housing_block",
  "street_community" as const,
  "playground_group" as const,
  "garage_cooperative" as const,
  "garden_allotment" as const,
  "generic_group",
] as const;

type Kind = (typeof coreSchema.entityKindEnum.enumValues)[number];

interface CliArgs {
  kind: Kind;
  name: string;
  apply: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let kind: Kind = "housing_community";
  let name = "Default community";
  let apply = false;

  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--kind") {
      const next = argv[i + 1];
      if (!next) throw new Error("--kind requires a value");
      if (!coreSchema.entityKindEnum.enumValues.includes(next as Kind)) {
        throw new Error(
          `--kind must be one of: ${coreSchema.entityKindEnum.enumValues.join(", ")}`
        );
      }
      kind = next as Kind;
      i++;
    } else if (tok === "--name") {
      const next = argv[i + 1];
      if (!next) throw new Error("--name requires a value");
      name = next;
      i++;
    } else if (tok === "--apply") {
      apply = true;
    } else if (tok === "--help" || tok === "-h") {
      console.log(`pnpm setup:tenant — first-time tenant bootstrap

Options:
  --kind <kind>   default: housing_community. One of: ${SUPPORTED_KINDS.join(", ")}
  --name <name>   tenant display name (default: "Default community")
  --apply         persist changes (default is dry-run preview)`);
      process.exit(0);
    }
  }
  return { kind, name, apply };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool, { schema: { ...coreSchema, ...votingSchema } });

  // Idempotent: refuse to overwrite an existing root entity.
  const existingRoots = await db
    .select({ id: coreSchema.entities.id })
    .from(coreSchema.entities)
    .where(eq(coreSchema.entities.parentId, null as unknown as string))
    .limit(1)
    .catch(() => []);
  if (existingRoots.length > 0) {
    console.log(
      `[setup-tenant] root entity already exists (${existingRoots[0].id}); skipping bootstrap.`
    );
    await pool.end();
    return;
  }

  if (!args.apply) {
    console.log(
      `[dry-run] would seed root entity { kind: ${args.kind}, name: ${JSON.stringify(args.name)} }`
    );
    console.log("(pass --apply to persist)");
    await pool.end();
    return;
  }

  // Persist a single root entity. Per-kind extension data + child
  // shape is the operator's responsibility via subsequent admin API
  // calls — no opinionated nested seeding here.
  const newId = crypto.randomUUID();
  await db.insert(coreSchema.entities).values({
    id: newId,
    parentId: null,
    kind: args.kind,
    name: args.name,
    path: `/${newId}/`,
    depth: 0,
    rootId: newId,
  });

  console.log(`[setup-tenant] created root entity ${newId} (kind: ${args.kind}).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
