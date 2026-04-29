import { PERMISSIONS, type Permission } from "./permissions";
import { SLOT_NAMES, type SlotName } from "./slots";

export interface ModuleManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  entry: string;
  permissions: Permission[];
  uiSlots: SlotName[];
  minCoreVersion: string;
  checksum?: string;
}

export interface ManifestValidationError {
  field: string;
  message: string;
}

const NAME_RE = /^[a-z][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/;
const CHECKSUM_RE = /^sha256:[a-f0-9]{64}$/i;

export function validateManifest(
  raw: unknown
): { ok: true; manifest: ModuleManifest } | { ok: false; errors: ManifestValidationError[] } {
  const errors: ManifestValidationError[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {
      ok: false,
      errors: [{ field: "<root>", message: "manifest must be a JSON object" }],
    };
  }
  const m = raw as Record<string, unknown>;

  if (typeof m.name !== "string" || !NAME_RE.test(m.name)) {
    errors.push({
      field: "name",
      message: "must match /^[a-z][a-z0-9-]*$/ (lowercase, dashes)",
    });
  }
  if (typeof m.version !== "string" || !SEMVER_RE.test(m.version)) {
    errors.push({ field: "version", message: "must be valid semver (x.y.z)" });
  }
  if (typeof m.entry !== "string" || m.entry.length === 0) {
    errors.push({ field: "entry", message: "must be non-empty path string" });
  }
  if (typeof m.minCoreVersion !== "string" || !SEMVER_RE.test(m.minCoreVersion)) {
    errors.push({ field: "minCoreVersion", message: "must be valid semver" });
  }
  if (!Array.isArray(m.permissions)) {
    errors.push({ field: "permissions", message: "must be array of strings" });
  } else {
    for (const p of m.permissions) {
      if (typeof p !== "string" || !PERMISSIONS.includes(p as Permission)) {
        errors.push({
          field: "permissions",
          message: `unknown permission: ${String(p)}`,
        });
      }
    }
  }
  if (!Array.isArray(m.uiSlots)) {
    errors.push({ field: "uiSlots", message: "must be array of slot names" });
  } else {
    for (const s of m.uiSlots) {
      if (typeof s !== "string" || !SLOT_NAMES.includes(s as SlotName)) {
        errors.push({
          field: "uiSlots",
          message: `unknown slot: ${String(s)}`,
        });
      }
    }
  }
  if (m.checksum !== undefined) {
    if (typeof m.checksum !== "string" || !CHECKSUM_RE.test(m.checksum)) {
      errors.push({
        field: "checksum",
        message: "must be 'sha256:<64-hex>'",
      });
    }
  }
  if (m.description !== undefined && typeof m.description !== "string") {
    errors.push({ field: "description", message: "must be string" });
  }
  if (m.author !== undefined && typeof m.author !== "string") {
    errors.push({ field: "author", message: "must be string" });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    manifest: {
      name: m.name as string,
      version: m.version as string,
      description: m.description as string | undefined,
      author: m.author as string | undefined,
      entry: m.entry as string,
      permissions: m.permissions as Permission[],
      uiSlots: m.uiSlots as SlotName[],
      minCoreVersion: m.minCoreVersion as string,
      checksum: m.checksum as string | undefined,
    },
  };
}

export function compareSemver(a: string, b: string): number {
  const pa = a.split(/[-+]/)[0].split(".").map(Number);
  const pb = b.split(/[-+]/)[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function tablePrefixFor(moduleName: string): string {
  return `mod_${moduleName.replace(/-/g, "_")}_`;
}

export function migrationsTableFor(moduleName: string): string {
  return `mod_${moduleName.replace(/-/g, "_")}__migrations`;
}
