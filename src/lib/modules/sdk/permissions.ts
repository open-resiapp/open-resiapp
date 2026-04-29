export const PERMISSIONS = [
  "db:read",
  "db:write",
  "api:external",
  "ui:inject",
  "hardware:access",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export class PermissionDeniedError extends Error {
  readonly module: string;
  readonly permission: Permission;

  constructor(module: string, permission: Permission, detail?: string) {
    super(
      `Module "${module}" lacks permission "${permission}"${detail ? `: ${detail}` : ""}`
    );
    this.name = "PermissionDeniedError";
    this.module = module;
    this.permission = permission;
  }
}
