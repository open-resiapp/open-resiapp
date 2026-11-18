import "server-only";

import { promises as fs } from "fs";
import path from "path";

import type { LawDocument, LawIndex, LawJurisdiction, LawMeta } from "./laws";
import { buildSearchUnits, listProvisionAnchors, type SearchUnit } from "./laws-search";
import { unknownTopicAnchors } from "./laws-topics";

// Read-only access to the committed laws library (`data/laws/**`, produced
// by `pnpm laws:sync`). Static files, so caching in module scope is safe on
// every replica; nothing here fetches from the network or touches the DB.
//
// Production: the Dockerfile copies `data/laws` next to the standalone
// server, so `process.cwd()/data/laws` resolves in both `next dev` and the
// container.

const LAWS_DIR = path.join(process.cwd(), "data", "laws");

let indexPromise: Promise<LawIndex> | null = null;

export function getLawIndex(): Promise<LawIndex> {
  if (!indexPromise) {
    indexPromise = fs
      .readFile(path.join(LAWS_DIR, "index.json"), "utf8")
      .then((raw) => JSON.parse(raw) as LawIndex)
      .catch((err: unknown) => {
        indexPromise = null; // don't cache a failed read
        console.error("[laws] failed to read data/laws/index.json", err);
        return { generatedAt: "", laws: [] };
      });
  }
  return indexPromise;
}

export async function listLaws(jurisdiction?: LawJurisdiction): Promise<LawMeta[]> {
  const { laws } = await getLawIndex();
  return jurisdiction ? laws.filter((l) => l.jurisdiction === jurisdiction) : laws;
}

export async function getLawMeta(id: string): Promise<LawMeta | null> {
  const { laws } = await getLawIndex();
  return laws.find((l) => l.id === id) ?? null;
}

// Full documents are large (the Slovak Civil Code is ~0.6 MB of JSON), so
// keep only the few most recently read ones.
const DOC_CACHE_MAX = 4;
const docCache = new Map<string, Promise<LawDocument | null>>();

/**
 * Full text of one law. `id` is only ever resolved through the index, never
 * used to build a path directly, so arbitrary input can't reach the
 * filesystem.
 */
export async function getLaw(id: string): Promise<LawDocument | null> {
  const meta = await getLawMeta(id);
  if (!meta) return null;

  const cached = docCache.get(meta.id);
  if (cached) {
    docCache.delete(meta.id);
    docCache.set(meta.id, cached);
    return cached;
  }

  const file = path.join(LAWS_DIR, meta.jurisdiction, `${meta.id}.json`);
  const loading = fs
    .readFile(file, "utf8")
    .then((raw) => JSON.parse(raw) as LawDocument)
    .catch((err: unknown) => {
      docCache.delete(meta.id);
      console.error(`[laws] failed to read ${meta.id}`, err);
      return null;
    });
  docCache.set(meta.id, loading);
  while (docCache.size > DOC_CACHE_MAX) {
    const oldest = docCache.keys().next().value;
    if (oldest === undefined) break;
    docCache.delete(oldest);
  }
  return loading;
}

// ---------------------------------------------------------------------------
// Search corpus (MCP find_legal_basis)
// ---------------------------------------------------------------------------

// Flattened paragraphs of every act of one jurisdiction, built once per
// process from the static files (≈ 3 MB of JSON for SK). Read straight from
// disk, NOT through the document LRU above, so a search over all acts
// doesn't evict the reader's working set.
const corpusCache = new Map<LawJurisdiction, Promise<SearchUnit[]>>();

export function getSearchCorpus(jurisdiction: LawJurisdiction): Promise<SearchUnit[]> {
  let cached = corpusCache.get(jurisdiction);
  if (!cached) {
    cached = (async () => {
      const laws = await listLaws(jurisdiction);
      const units: SearchUnit[] = [];
      const anchors = new Map<string, Set<string>>();
      for (const meta of laws) {
        const raw = await fs.readFile(path.join(LAWS_DIR, meta.jurisdiction, `${meta.id}.json`), "utf8");
        const doc = JSON.parse(raw) as LawDocument;
        units.push(...buildSearchUnits(doc));
        anchors.set(doc.id, listProvisionAnchors(doc));
      }
      const unknown = unknownTopicAnchors(jurisdiction, anchors);
      if (unknown.length) {
        // Stale topic map after a re-sync: those entries just get no boost.
        console.warn(`[laws] topic map anchors missing in data (${jurisdiction}): ${unknown.join(", ")}`);
      }
      return units;
    })().catch((err: unknown) => {
      corpusCache.delete(jurisdiction);
      console.error(`[laws] failed to build search corpus (${jurisdiction})`, err);
      return [];
    });
    corpusCache.set(jurisdiction, cached);
  }
  return cached;
}
