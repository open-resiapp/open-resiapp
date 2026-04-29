export { defineModule } from "./types";
export type {
  ModuleSDK,
  ModuleContext,
  ModuleDefinition,
  DomainHooks,
  ReadQuery,
  Community,
  Member,
  Vote,
  Voting,
  User,
  Post,
  DeviceSpec,
  DeviceHandle,
} from "./types";
export {
  PERMISSIONS,
  PermissionDeniedError,
  type Permission,
} from "./permissions";
export { SLOT_NAMES, type SlotName, type SlotProps, type ComponentLoader } from "./slots";
export {
  validateManifest,
  compareSemver,
  tablePrefixFor,
  migrationsTableFor,
  type ModuleManifest,
  type ManifestValidationError,
} from "./manifest";
