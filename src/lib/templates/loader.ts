import "server-only";

import { readFile, readdir } from "fs/promises";
import path from "path";

import type { Template, TemplateSummary } from "./types";

// BYT-20260515-001 Phase 4: template loader.
//
// Templates live as JSON files next to this loader. The cache is
// process-local — invalidated on cold start, fine for templates which
// only change with deploys.

const TEMPLATES_DIR = path.join(process.cwd(), "src/lib/templates");

let cache: Map<string, Template> | null = null;

async function loadAll(): Promise<Map<string, Template>> {
  if (cache) return cache;
  const entries = await readdir(TEMPLATES_DIR);
  const out = new Map<string, Template>();
  for (const file of entries) {
    if (!file.endsWith(".json")) continue;
    const raw = await readFile(path.join(TEMPLATES_DIR, file), "utf8");
    const parsed = JSON.parse(raw) as Template;
    if (parsed.slug !== path.basename(file, ".json")) {
      throw new Error(
        `Template file ${file} declares slug "${parsed.slug}" — must match filename.`
      );
    }
    out.set(parsed.slug, parsed);
  }
  cache = out;
  return out;
}

export async function listTemplates(): Promise<Template[]> {
  const all = await loadAll();
  return Array.from(all.values()).sort((a, b) =>
    a.slug.localeCompare(b.slug)
  );
}

export async function listTemplateSummaries(): Promise<TemplateSummary[]> {
  const templates = await listTemplates();
  return templates.map((t) => ({
    slug: t.slug,
    display_name_key: t.display_name_key,
    description_key: t.description_key,
    category: t.category,
    default_voting_method: t.default_voting_method,
    legal_review_required: t.legal_review_required ?? false,
  }));
}

export async function getTemplate(slug: string): Promise<Template | null> {
  const all = await loadAll();
  return all.get(slug) ?? null;
}
