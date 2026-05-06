import "server-only";

import path from "path";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  coreModules,
  coreModuleGrants,
  entities,
} from "@/db/schema";
import type { ModuleManifest } from "./sdk";
import { MODULES_DIR } from "./loader";
import { listCommunityRoots } from "@/lib/legacy-compat";

// Modules shipped in-tree. Each entry declares the entity kinds that
// should auto-enable the module on first app start. For non-matching
// kinds (e.g. playground_group) the operator must opt in via the admin
// UI — exactly what /settings/modules does for non-bundled modules.
//
// Source of truth for the auto-enable rule: RES-20260505-001
// §"Default install for housing kinds".
type BundledModuleConfig = {
  name: string;
  autoEnableKinds: ReadonlyArray<
    | "housing_community"
    | "housing_block"
    | "housing_entrance"
    | "housing_unit"
    | "generic_group"
  >;
};

const BUNDLED_MODULES: ReadonlyArray<BundledModuleConfig> = [
  {
    name: "voting",
    autoEnableKinds: ["housing_community", "housing_block"],
  },
];

const BUNDLED_NAMES = new Set(BUNDLED_MODULES.map((m) => m.name));

export function isBundledModule(name: string): boolean {
  return BUNDLED_NAMES.has(name);
}

/**
 * Ensure each in-tree bundled module has a `core_modules` install row
 * and a `core_module_grants` row on every entity whose kind matches the
 * module's auto-enable list. Idempotent — safe to run on every startup.
 *
 * Should be invoked from the module loader before `loadAllModules` so
 * that a fresh tenant gets the default voting experience without any
 * admin click.
 */
/**
 * Operator opt-out: comma-separated list of bundled module names that
 * should NOT be auto-enabled at app start. Use this to provision a
 * tenant without voting (or any future bundled module). Re-enable later
 * via the admin API or CLI.
 */
function readOptOutSet(): Set<string> {
  const raw = process.env.OPEN_HOUSING_DISABLE_BUNDLED ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

export async function bootstrapBundledModules(
  manifests: ReadonlyArray<ModuleManifest>
): Promise<void> {
  const optedOut = readOptOutSet();
  for (const manifest of manifests) {
    const config = BUNDLED_MODULES.find((m) => m.name === manifest.name);
    if (!config) continue;
    if (optedOut.has(manifest.name)) {
      console.info(
        `[modules] bundled "${manifest.name}" opted out via OPEN_HOUSING_DISABLE_BUNDLED — skipping bootstrap`
      );
      continue;
    }
    await ensureInstallRow(manifest);
    await ensureGrantsForHousingRoots(manifest, config);
  }
}

async function ensureInstallRow(manifest: ModuleManifest): Promise<void> {
  const installPath = path.join(MODULES_DIR, manifest.name);
  await db
    .insert(coreModules)
    .values({
      name: manifest.name,
      version: manifest.version,
      status: "enabled",
      installPath,
    })
    .onConflictDoUpdate({
      target: coreModules.name,
      set: {
        version: manifest.version,
        installPath,
        // Status / failureCount NOT touched here — operator may have
        // disabled the module deliberately. Auto-bootstrap respects that.
      },
    });
}

async function ensureGrantsForHousingRoots(
  manifest: ModuleManifest,
  config: BundledModuleConfig
): Promise<void> {
  // Phase 9.1d: iterate root entities directly via the compat helper.
  // Single-tenant: one root. Cloud per-tenant: also one root per process.
  const communityRoots = await listCommunityRoots();
  if (communityRoots.length === 0) return;

  const rootIds = communityRoots.map((r) => r.id);
  const rootEntities = await db
    .select({ id: entities.id, kind: entities.kind })
    .from(entities)
    .where(
      and(
        inArray(entities.id, rootIds),
        isNull(entities.archivedAt)
      )
    );

  const allowed = new Set<string>(config.autoEnableKinds);
  for (const entity of rootEntities) {
    if (!allowed.has(entity.kind)) continue;
    await db
      .insert(coreModuleGrants)
      .values({
        entityId: entity.id,
        moduleName: manifest.name,
        permissions: manifest.permissions,
        grantedById: null, // System-granted; null indicates auto-bootstrap.
      })
      .onConflictDoNothing({
        target: [coreModuleGrants.entityId, coreModuleGrants.moduleName],
      });
  }
}

/**
 * Block uninstall of bundled modules. The voting module additionally
 * has retention requirements (SK §14a) handled by its own onUninstall.
 * This guard prevents ad-hoc deletion of bundled modules from the
 * admin UI; operator purge endpoint remains the only path.
 */
export function assertNotBundled(name: string): void {
  if (BUNDLED_NAMES.has(name)) {
    throw new Error(
      `Module "${name}" is bundled with core and cannot be uninstalled. ` +
        "Disable instead, or run the operator purge endpoint."
    );
  }
}
