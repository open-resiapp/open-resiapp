import "server-only";

import AdmZip from "adm-zip";
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { db } from "@/db";
import {
  coreModuleGrants,
  coreModules,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCommunityRoot, listCommunityRoots } from "@/lib/legacy-compat";

import {
  compareSemver,
  validateManifest,
  type ModuleManifest,
  type Permission,
} from "./sdk";
import { CORE_VERSION } from "./core-version";
import { MODULES_DIR } from "./loader";
import { buildContextFor, dropModuleTables } from "./sdk-runtime";
import {
  registerModule,
  unregisterModule,
  getModule,
  type LoadedModule,
} from "./registry";
import { assertNotBundled } from "./bootstrap-bundled";

const STAGING_DIR = path.join(MODULES_DIR, ".staging");

export interface StagedModule {
  stagingId: string;
  manifest: ModuleManifest;
  declaredPermissions: Permission[];
  isUpgrade: boolean;
  previousVersion: string | null;
  warnings: string[];
}

export class ModuleInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleInstallError";
  }
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ── Stage from zip buffer ───────────────────────────────

export async function stageZip(buf: Buffer): Promise<StagedModule> {
  await ensureDir(STAGING_DIR);

  const zip = new AdmZip(buf);
  const entries = zip.getEntries();
  const manifestEntry = entries.find(
    (e) => !e.isDirectory && path.basename(e.entryName) === "module.json"
  );
  if (!manifestEntry) {
    throw new ModuleInstallError("zip does not contain a module.json");
  }

  let manifestRaw: unknown;
  try {
    manifestRaw = JSON.parse(manifestEntry.getData().toString("utf-8"));
  } catch {
    throw new ModuleInstallError("module.json is not valid JSON");
  }
  const result = validateManifest(manifestRaw);
  if (!result.ok) {
    throw new ModuleInstallError(
      `manifest invalid: ${result.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`
    );
  }
  const manifest = result.manifest;

  if (compareSemver(CORE_VERSION, manifest.minCoreVersion) < 0) {
    throw new ModuleInstallError(
      `module requires core ${manifest.minCoreVersion}, have ${CORE_VERSION}`
    );
  }

  const warnings: string[] = [];
  if (manifest.checksum) {
    const expected = manifest.checksum.replace(/^sha256:/i, "").toLowerCase();
    const actual = sha256Hex(buf);
    if (expected !== actual) {
      throw new ModuleInstallError(
        `checksum mismatch: manifest=${expected.slice(0, 12)}…, zip=${actual.slice(0, 12)}…`
      );
    }
  } else {
    warnings.push(
      "manifest has no checksum — Phase-2 marketplace will require this"
    );
  }

  // The manifest may live inside a top-level folder. Determine the prefix
  // so we can extract relative to the module root.
  const manifestDir = path.dirname(manifestEntry.entryName);
  const stripPrefix = manifestDir === "." ? "" : manifestDir + "/";

  const stagingId =
    `${manifest.name}-${manifest.version}-${Date.now().toString(36)}`;
  const target = path.join(STAGING_DIR, stagingId);
  await fs.rm(target, { recursive: true, force: true });
  await ensureDir(target);

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    let rel = entry.entryName;
    if (stripPrefix && rel.startsWith(stripPrefix)) {
      rel = rel.slice(stripPrefix.length);
    } else if (stripPrefix) {
      // entry outside the module root — skip
      continue;
    }
    if (!rel || rel.startsWith("..")) continue;
    const dest = path.resolve(target, rel);
    if (!dest.startsWith(target + path.sep) && dest !== target) {
      throw new ModuleInstallError(`zip entry escapes target: ${entry.entryName}`);
    }
    await ensureDir(path.dirname(dest));
    await fs.writeFile(dest, entry.getData());
  }

  const [existing] = await db
    .select({ version: coreModules.version })
    .from(coreModules)
    .where(eq(coreModules.name, manifest.name))
    .limit(1);

  return {
    stagingId,
    manifest,
    declaredPermissions: manifest.permissions,
    isUpgrade: !!existing,
    previousVersion: existing?.version ?? null,
    warnings,
  };
}

// ── Approve grants & finalize install ───────────────────

export async function finalizeInstall(
  stagingId: string,
  approverUserId: string,
  approvedPermissions: Permission[]
): Promise<{ name: string; version: string }> {
  const stagingPath = path.join(STAGING_DIR, stagingId);
  const manifestRaw = await fs
    .readFile(path.join(stagingPath, "module.json"), "utf-8")
    .catch(() => {
      throw new ModuleInstallError(`staging ${stagingId} not found`);
    });
  const validated = validateManifest(JSON.parse(manifestRaw));
  if (!validated.ok) {
    throw new ModuleInstallError("staged manifest no longer valid");
  }
  const manifest = validated.manifest;

  // Confirm approved set is a subset of declared.
  for (const p of approvedPermissions) {
    if (!manifest.permissions.includes(p)) {
      throw new ModuleInstallError(
        `approved permission "${p}" not declared in manifest`
      );
    }
  }

  const finalPath = path.join(MODULES_DIR, manifest.name);

  // If upgrading, run onUninstall on the previous version first.
  const previous = getModule(manifest.name);
  if (previous) {
    await runOnUninstallSafe(previous);
    unregisterModule(manifest.name);
  }
  await fs.rm(finalPath, { recursive: true, force: true });
  await fs.rename(stagingPath, finalPath);

  // Persist core_modules row.
  await db
    .insert(coreModules)
    .values({
      name: manifest.name,
      version: manifest.version,
      status: "enabled",
      installPath: finalPath,
    })
    .onConflictDoUpdate({
      target: coreModules.name,
      set: {
        version: manifest.version,
        status: "enabled",
        failureCount: 0,
        lastFailureAt: null,
        lastFailureMessage: null,
        installPath: finalPath,
        updatedAt: new Date(),
      },
    });

  // Persist grant per community root (housing_community / housing_block).
  const communityRoots = await listCommunityRoots();
  for (const root of communityRoots) {
    await db
      .insert(coreModuleGrants)
      .values({
        entityId: root.id,
        moduleName: manifest.name,
        permissions: approvedPermissions,
        grantedById: approverUserId,
      })
      .onConflictDoUpdate({
        target: [coreModuleGrants.entityId, coreModuleGrants.moduleName],
        set: {
          permissions: approvedPermissions,
          grantedById: approverUserId,
          grantedAt: new Date(),
        },
      });
  }

  // Dynamic-import + run onInstall + register.
  const { loadAllModules } = await import("./loader");
  await loadAllModules();
  const loaded = getModule(manifest.name);
  if (loaded?.definition.onInstall) {
    const communityRow = await getCommunityRoot();
    if (communityRow) {
      try {
        await Promise.race([
          loaded.definition.onInstall(buildContextFor(loaded, communityRow)),
          new Promise((_, rej) =>
            setTimeout(
              () => rej(new Error("onInstall timed out after 30s")),
              30_000
            )
          ),
        ]);
      } catch (err) {
        // Roll back partially: leave files but disable. Admin can retry.
        await db
          .update(coreModules)
          .set({ status: "failed", lastFailureMessage: String(err) })
          .where(eq(coreModules.name, manifest.name));
        throw err;
      }
    }
  }

  return { name: manifest.name, version: manifest.version };
}

// ── Uninstall ───────────────────────────────────────────

export async function uninstallModule(name: string): Promise<void> {
  // Bundled modules (voting, etc.) are part of the app distribution and
  // cannot be removed via the standard uninstall flow. The voting module
  // additionally has SK §14a retention requirements and exposes a
  // separate operator purge endpoint per RES-20260505-001.
  assertNotBundled(name);

  const loaded = getModule(name);
  const [row] = await db
    .select({ installPath: coreModules.installPath })
    .from(coreModules)
    .where(eq(coreModules.name, name))
    .limit(1);
  if (!row) throw new ModuleInstallError(`module "${name}" is not installed`);

  if (loaded) {
    await runOnUninstallSafe(loaded);
    unregisterModule(name);
  }

  await dropModuleTables(name, row.installPath);

  // Cascade removes grants when coreModules row goes.
  await db.delete(coreModules).where(eq(coreModules.name, name));

  await fs.rm(row.installPath, { recursive: true, force: true });
}

async function runOnUninstallSafe(loaded: LoadedModule): Promise<void> {
  if (!loaded.definition.onUninstall) return;
  const communityRow = await getCommunityRoot();
  if (!communityRow) return;
  try {
    await Promise.race([
      loaded.definition.onUninstall(buildContextFor(loaded, communityRow)),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("onUninstall timed out")), 10_000)
      ),
    ]);
  } catch (err) {
    console.error(
      `[modules] onUninstall failed for "${loaded.manifest.name}":`,
      err
    );
  }
}

// ── Enable / disable ────────────────────────────────────

export async function setModuleStatus(
  name: string,
  status: "enabled" | "disabled"
): Promise<void> {
  await db
    .update(coreModules)
    .set({
      status,
      failureCount: 0,
      lastFailureAt: null,
      lastFailureMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(coreModules.name, name));
  if (status === "disabled") unregisterModule(name);
  else {
    const { loadAllModules } = await import("./loader");
    await loadAllModules();
  }
}

// ── List with grants ────────────────────────────────────

export interface InstalledModuleView {
  name: string;
  version: string;
  status: "enabled" | "disabled" | "failed";
  failureCount: number;
  lastFailureMessage: string | null;
  installedAt: Date;
  grantedPermissions: Permission[];
  declaredPermissions: Permission[];
}

export async function listInstalledModules(): Promise<InstalledModuleView[]> {
  const rows = await db.select().from(coreModules);
  const out: InstalledModuleView[] = [];
  for (const row of rows) {
    let declared: Permission[] = [];
    try {
      const raw = await fs.readFile(
        path.join(row.installPath, "module.json"),
        "utf-8"
      );
      const v = validateManifest(JSON.parse(raw));
      if (v.ok) declared = v.manifest.permissions;
    } catch {
      // module dir missing — leave declared empty
    }
    const grants = await db
      .select({ permissions: coreModuleGrants.permissions })
      .from(coreModuleGrants)
      .where(eq(coreModuleGrants.moduleName, row.name));
    const granted = new Set<Permission>();
    for (const g of grants) for (const p of g.permissions) granted.add(p as Permission);
    out.push({
      name: row.name,
      version: row.version,
      status: row.status,
      failureCount: row.failureCount,
      lastFailureMessage: row.lastFailureMessage,
      installedAt: row.installedAt,
      declaredPermissions: declared,
      grantedPermissions: Array.from(granted),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
