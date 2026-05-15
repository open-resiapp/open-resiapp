import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { and, eq, isNull } from "drizzle-orm";

import { entities, entityKinds } from "../db/schema";
import { CANONICAL_KIND_CATALOG } from "../lib/kinds/registry";

// BYT-20260515-001 Phase 5: first-boot bootstrap.
//
// Given INSTALL_TEMPLATE (env or --template flag), seed the per-instance
// `entity_kinds` catalog with the kinds the template uses, then walk
// the template's `starter_tree` and create the root entity. Idempotent:
// re-running on an already-seeded instance no-ops.
//
// Translation resolution: template node `name_key`s are resolved
// against messages/{locale}.json so the seeded community name shows up
// in the operator's chosen language. The `--name` flag overrides the
// translated sample for the root community (operator picked it in
// setup.sh).

interface BootstrapArgs {
  template: string;
  locale: string;
  name: string | null;
}

interface Template {
  slug: string;
  root_kind: string;
  default_voting_method: string;
  starter_tree: TemplateStarterNode[];
  import_levels: string[];
}

interface TemplateStarterNode {
  kind: string;
  name_key: string;
  children?: TemplateStarterNode[];
}

function parseArgs(): BootstrapArgs {
  const args = process.argv.slice(2);
  let template = process.env.INSTALL_TEMPLATE ?? "";
  let locale = process.env.LANGUAGE ?? "sk";
  let name: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--template" && args[i + 1]) template = args[++i];
    else if (args[i] === "--locale" && args[i + 1]) locale = args[++i];
    else if (args[i] === "--name" && args[i + 1]) name = args[++i];
  }

  if (!template) {
    console.error(
      "Usage: bootstrap-community.ts --template <slug> [--name \"Community\"] [--locale sk|en]\n" +
        "Or set INSTALL_TEMPLATE in the environment."
    );
    process.exit(1);
  }
  if (locale !== "sk" && locale !== "en") {
    console.error(`Error: locale must be sk or en (got "${locale}").`);
    process.exit(1);
  }

  return { template, locale, name };
}

async function loadTemplate(slug: string): Promise<Template> {
  const file = path.join(process.cwd(), "src/lib/templates", `${slug}.json`);
  const raw = await readFile(file, "utf8").catch(() => {
    throw new Error(
      `Template "${slug}" not found at ${file}. Check INSTALL_TEMPLATE.`
    );
  });
  return JSON.parse(raw) as Template;
}

async function loadMessages(locale: string): Promise<Record<string, unknown>> {
  const file = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

function resolveKey(messages: Record<string, unknown>, key: string): string {
  const parts = key.split(".");
  let cur: unknown = messages;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return key;
    }
  }
  return typeof cur === "string" ? cur : key;
}

function collectKindsFromTree(
  nodes: TemplateStarterNode[],
  out: Set<string>
): void {
  for (const n of nodes) {
    out.add(n.kind);
    if (n.children) collectKindsFromTree(n.children, out);
  }
}

async function main() {
  const opts = parseArgs();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log(`\n  Bootstrap: template="${opts.template}", locale="${opts.locale}"`);

  // 1. Load template + messages.
  const template = await loadTemplate(opts.template);
  const messages = await loadMessages(opts.locale);

  // 2. Compute the set of kinds this template uses.
  const requiredKinds = new Set<string>([template.root_kind]);
  for (const slug of template.import_levels) requiredKinds.add(slug);
  collectKindsFromTree(template.starter_tree, requiredKinds);
  requiredKinds.add("generic_group"); // always useful

  // 3. Seed entity_kinds (idempotent via onConflictDoNothing).
  const toSeed = CANONICAL_KIND_CATALOG.filter((row) =>
    requiredKinds.has(row.slug)
  );
  if (toSeed.length === 0) {
    throw new Error(
      `Template "${opts.template}" references no known kinds. ` +
        `Required: ${Array.from(requiredKinds).join(", ")}`
    );
  }
  for (const row of toSeed) {
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
  console.log(`  Seeded ${toSeed.length} kind(s): ${toSeed.map((r) => r.slug).join(", ")}`);

  // 4. Check whether a root community already exists. If yes, no-op.
  const existingRoot = await db
    .select({ id: entities.id })
    .from(entities)
    .where(and(isNull(entities.parentId), isNull(entities.archivedAt)))
    .limit(1);
  if (existingRoot.length > 0) {
    console.log(`  Root entity already exists (${existingRoot[0].id}); skipping starter tree.`);
    await pool.end();
    return;
  }

  // 5. Walk starter_tree depth-first and insert entities.
  const inserted: string[] = [];
  async function insertNode(
    node: TemplateStarterNode,
    parentId: string | null,
    parentPath: string | null,
    depth: number,
    rootId: string | null
  ): Promise<string> {
    const id = crypto.randomUUID();
    const path = parentPath ? `${parentPath}${id}/` : `/${id}/`;
    const resolvedRoot = rootId ?? id;
    const isRoot = parentId === null;
    const translatedName =
      isRoot && opts.name ? opts.name : resolveKey(messages, node.name_key);

    const data: Record<string, unknown> = {};
    if (isRoot) {
      // Set voting method on the root so the dispatcher reads it.
      data.voting_method = template.default_voting_method;
    }

    await db.insert(entities).values({
      id,
      parentId,
      kind: node.kind,
      name: translatedName,
      path,
      depth,
      rootId: resolvedRoot,
      data,
    });
    inserted.push(`${node.kind}: ${translatedName}`);

    if (node.children) {
      for (const child of node.children) {
        await insertNode(child, id, path, depth + 1, resolvedRoot);
      }
    }
    return id;
  }

  if (template.starter_tree.length === 0) {
    console.log("  Template declares no starter_tree; nothing to insert.");
  } else {
    for (const node of template.starter_tree) {
      await insertNode(node, null, null, 0, null);
    }
    console.log(`  Inserted ${inserted.length} entity(ies):`);
    for (const line of inserted) console.log(`    - ${line}`);
  }

  console.log("\n  Bootstrap complete.\n");
  await pool.end();
}

main().catch((e) => {
  console.error("Bootstrap failed:", e);
  process.exit(1);
});
