import "server-only";

import { promises as fs } from "fs";
import path from "path";
import { pathToFileURL } from "url";

import { db } from "@/db";
import { coreModules, coreModuleGrants, building } from "@/db/schema";
import { eq } from "drizzle-orm";

import {
  compareSemver,
  validateManifest,
  type ModuleDefinition,
  type ModuleManifest,
} from "./sdk";
import { CORE_VERSION } from "./core-version";
import { registerModule, type LoadedModule } from "./registry";

export const MODULES_DIR =
  process.env.OPEN_HOUSING_MODULES_DIR ??
  path.resolve(process.cwd(), "modules");

async function readManifest(
  dir: string
): Promise<{ manifest: ModuleManifest; raw: string } | null> {
  const manifestPath = path.join(dir, "module.json");
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, "utf-8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[modules] invalid JSON in ${manifestPath}:`, err);
    return null;
  }
  const result = validateManifest(parsed);
  if (!result.ok) {
    console.warn(
      `[modules] manifest validation failed in ${manifestPath}:`,
      result.errors.map((e) => `${e.field}: ${e.message}`).join("; ")
    );
    return null;
  }
  return { manifest: result.manifest, raw };
}

async function importEntry(
  dir: string,
  entry: string
): Promise<ModuleDefinition | null> {
  const entryPath = path.resolve(dir, entry);
  const fromInside = path.relative(dir, entryPath);
  if (fromInside.startsWith("..") || path.isAbsolute(fromInside)) {
    console.warn(
      `[modules] entry "${entry}" escapes module directory ${dir}, refusing to load`
    );
    return null;
  }
  try {
    const mod = await import(/* webpackIgnore: true */ pathToFileURL(entryPath).href);
    const def = (mod.default ?? mod) as ModuleDefinition | undefined;
    if (!def || typeof def !== "object" || typeof def.name !== "string") {
      console.warn(`[modules] entry ${entryPath} did not export a ModuleDefinition`);
      return null;
    }
    return def;
  } catch (err) {
    console.warn(`[modules] failed to import ${entryPath}:`, err);
    return null;
  }
}

async function loadGrantsFor(
  moduleName: string
): Promise<Set<string>> {
  // V1: single building per instance — grants merged across buildings
  // (cloud per-tenant means one building anyway).
  const rows = await db
    .select({ permissions: coreModuleGrants.permissions })
    .from(coreModuleGrants)
    .where(eq(coreModuleGrants.moduleName, moduleName));
  const set = new Set<string>();
  for (const r of rows) for (const p of r.permissions) set.add(p);
  return set;
}

async function loadInstallationState(name: string): Promise<{
  status: "enabled" | "disabled" | "failed";
  failureCount: number;
} | null> {
  const [row] = await db
    .select({
      status: coreModules.status,
      failureCount: coreModules.failureCount,
    })
    .from(coreModules)
    .where(eq(coreModules.name, name))
    .limit(1);
  return row ?? null;
}

export async function loadAllModules(): Promise<LoadedModule[]> {
  let dirs: string[];
  try {
    const entries = await fs.readdir(MODULES_DIR, { withFileTypes: true });
    dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  const loaded: LoadedModule[] = [];
  for (const sub of dirs) {
    const dir = path.join(MODULES_DIR, sub);
    const m = await readManifest(dir);
    if (!m) continue;
    const { manifest } = m;

    if (compareSemver(CORE_VERSION, manifest.minCoreVersion) < 0) {
      console.warn(
        `[modules] "${manifest.name}" requires core ${manifest.minCoreVersion}, have ${CORE_VERSION} — skipping`
      );
      continue;
    }

    const installState = await loadInstallationState(manifest.name);
    if (installState && installState.status !== "enabled") {
      console.info(
        `[modules] "${manifest.name}" status=${installState.status}, skipping load`
      );
      continue;
    }

    const def = await importEntry(dir, manifest.entry);
    if (!def) continue;

    const grants = await loadGrantsFor(manifest.name);

    const mod: LoadedModule = {
      manifest,
      definition: def,
      installPath: dir,
      status: installState?.status ?? "enabled",
      grantedPermissions: grants,
      failureCount: installState?.failureCount ?? 0,
    };
    registerModule(mod);
    loaded.push(mod);
  }

  return loaded;
}

export async function callOnAppStart(
  loaded: LoadedModule[],
  buildContext: (
    mod: LoadedModule,
    communityRow: typeof building.$inferSelect
  ) => Parameters<NonNullable<ModuleDefinition["onAppStart"]>>[0]
): Promise<void> {
  const [communityRow] = await db.select().from(building).limit(1);
  if (!communityRow) return;
  for (const mod of loaded) {
    if (!mod.definition.onAppStart) continue;
    try {
      await Promise.race([
        mod.definition.onAppStart(buildContext(mod, communityRow)),
        new Promise((_, rej) =>
          setTimeout(
            () =>
              rej(new Error(`onAppStart timed out for "${mod.manifest.name}"`)),
            5_000
          )
        ),
      ]);
    } catch (err) {
      console.error(
        `[modules] onAppStart failed for "${mod.manifest.name}":`,
        err
      );
    }
  }
}
