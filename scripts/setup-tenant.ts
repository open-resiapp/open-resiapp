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
 *
 * Bundled modules (voting, …) auto-enable on housing kinds at app
 * start. Pass `--skip-bundled <names>` (or answer the interactive
 * prompt when running in a TTY) to opt out — this writes a disabled
 * `core_modules` row before the app starts so the bootstrap leaves it
 * alone. Operator can re-enable later via /settings/modules or
 * `pnpm entity-admin module-enable <name>`.
 */
import "dotenv/config";

import { promises as fs } from "fs";
import path from "path";
import readline from "readline";

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
  skipBundled: Set<string>;
  yes: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let kind: Kind = "housing_community";
  let name = "Default community";
  let apply = false;
  const skipBundled = new Set<string>();
  let yes = false;

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
    } else if (tok === "--skip-bundled") {
      const next = argv[i + 1];
      if (!next) throw new Error("--skip-bundled requires a comma-list");
      for (const m of next.split(",").map((s) => s.trim()).filter(Boolean)) {
        skipBundled.add(m);
      }
      i++;
    } else if (tok === "--yes" || tok === "-y") {
      yes = true;
    } else if (tok === "--apply") {
      apply = true;
    } else if (tok === "--help" || tok === "-h") {
      console.log(`pnpm setup:tenant — first-time tenant bootstrap

Options:
  --kind <kind>          default: housing_community. One of:
                         ${SUPPORTED_KINDS.join(", ")}
  --name <name>          tenant display name (default: "Default community")
  --skip-bundled <list>  comma-separated bundled module names to leave
                         disabled (e.g. "voting"). Without this flag,
                         setup prompts interactively when run in a TTY.
  --yes / -y             accept all bundled module defaults (skip the
                         interactive prompt). Useful for CI / Docker.
  --apply                persist changes (default is dry-run preview)`);
      process.exit(0);
    }
  }
  return { kind, name, apply, skipBundled, yes };
}

async function readBundledManifests(): Promise<
  Array<{ name: string; description: string }>
> {
  const modulesDir = path.resolve(process.cwd(), "modules");
  const out: Array<{ name: string; description: string }> = [];
  let entries: string[];
  try {
    entries = await fs.readdir(modulesDir);
  } catch {
    return out;
  }
  for (const sub of entries) {
    const manifestPath = path.join(modulesDir, sub, "module.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf-8");
      const m = JSON.parse(raw) as { name?: string; description?: string };
      if (m.name) out.push({ name: m.name, description: m.description ?? "" });
    } catch {
      // skip invalid manifests
    }
  }
  return out;
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) =>
      rl.question(`${question} [Y/n] `, resolve)
    );
    return !/^n(o)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function resolveSkipSet(
  args: CliArgs,
  manifests: Array<{ name: string; description: string }>
): Promise<Set<string>> {
  if (args.skipBundled.size > 0 || args.yes) return args.skipBundled;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return args.skipBundled;
  if (manifests.length === 0) return args.skipBundled;

  console.log("\nBundled modules detected. Each one will be enabled by default.");
  const skip = new Set<string>();
  for (const m of manifests) {
    const want = await promptYesNo(
      `Enable "${m.name}"${m.description ? ` — ${m.description}` : ""}?`
    );
    if (!want) skip.add(m.name);
  }
  console.log("");
  return skip;
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

  const manifests = await readBundledManifests();
  const skipSet = await resolveSkipSet(args, manifests);

  if (!args.apply) {
    console.log(
      `[dry-run] would seed root entity { kind: ${args.kind}, name: ${JSON.stringify(args.name)} }`
    );
    if (skipSet.size > 0) {
      console.log(
        `[dry-run] would mark these bundled modules disabled at install: ${[...skipSet].join(", ")}`
      );
    }
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

  // Pre-seed `core_modules` rows with status='disabled' for any module
  // the operator opted out of. The bootstrap on app start uses
  // ON CONFLICT DO UPDATE that explicitly preserves the existing
  // status, so this entry is honored — no grants get created and the
  // route guard returns 404 until the operator re-enables.
  for (const name of skipSet) {
    const manifest = manifests.find((m) => m.name === name);
    if (!manifest) {
      console.warn(
        `[setup-tenant] --skip-bundled "${name}" but no module of that name found in modules/, skipping.`
      );
      continue;
    }
    const installPath = path.resolve(process.cwd(), "modules", name);
    await db
      .insert(coreSchema.coreModules)
      .values({
        name,
        version: "0.0.0", // bootstrap rewrites this on first run
        status: "disabled",
        installPath,
      })
      .onConflictDoUpdate({
        target: coreSchema.coreModules.name,
        set: { status: "disabled" },
      });
    console.log(`[setup-tenant] marked bundled module "${name}" as disabled.`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
