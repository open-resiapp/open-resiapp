import "server-only";

import type {
  ComponentLoader,
  DomainHooks,
  ModuleContext,
  ModuleDefinition,
  ModuleManifest,
  SlotName,
} from "./sdk";

export interface LoadedModule {
  manifest: ModuleManifest;
  definition: ModuleDefinition;
  installPath: string;
  status: "enabled" | "disabled" | "failed";
  grantedPermissions: Set<string>;
  failureCount: number;
}

type RegistryState = {
  modules: Map<string, LoadedModule>;
  slots: Map<SlotName, Array<{ moduleName: string; loader: ComponentLoader }>>;
};

const globalKey = "__openHousingModuleRegistry__" as const;

function getState(): RegistryState {
  const g = globalThis as unknown as Record<string, RegistryState>;
  if (!g[globalKey]) {
    g[globalKey] = { modules: new Map(), slots: new Map() };
  }
  return g[globalKey];
}

export function registerModule(mod: LoadedModule): void {
  const state = getState();
  state.modules.set(mod.manifest.name, mod);

  if (mod.definition.ui) {
    for (const [slot, loader] of Object.entries(mod.definition.ui)) {
      if (!loader) continue;
      const slotName = slot as SlotName;
      const list = state.slots.get(slotName) ?? [];
      const filtered = list.filter((e) => e.moduleName !== mod.manifest.name);
      filtered.push({ moduleName: mod.manifest.name, loader });
      filtered.sort((a, b) => a.moduleName.localeCompare(b.moduleName));
      state.slots.set(slotName, filtered);
    }
  }
}

export function unregisterModule(name: string): void {
  const state = getState();
  state.modules.delete(name);
  for (const [slot, list] of state.slots) {
    state.slots.set(
      slot,
      list.filter((e) => e.moduleName !== name)
    );
  }
}

export function getModule(name: string): LoadedModule | undefined {
  return getState().modules.get(name);
}

export function listModules(): LoadedModule[] {
  return Array.from(getState().modules.values()).sort((a, b) =>
    a.manifest.name.localeCompare(b.manifest.name)
  );
}

export function listEnabledModules(): LoadedModule[] {
  return listModules().filter((m) => m.status === "enabled");
}

export function listSlot(
  slot: SlotName
): Array<{ moduleName: string; loader: ComponentLoader }> {
  return getState().slots.get(slot) ?? [];
}

const HOOK_TIMEOUT_MS = 5_000;
const MAX_FAILURES = 5;

export async function runHook<K extends keyof DomainHooks>(
  hook: K,
  payload: Parameters<DomainHooks[K]>[0],
  buildContext: (mod: LoadedModule) => ModuleContext,
  onModuleFailed?: (mod: LoadedModule, err: unknown) => Promise<void>
): Promise<void> {
  const mods = listEnabledModules();
  await Promise.all(
    mods.map(async (mod) => {
      const handler = mod.definition.hooks?.[hook];
      if (!handler) return;
      const ctx = buildContext(mod);
      try {
        await Promise.race([
          // @ts-expect-error variadic hook signature
          handler(payload, ctx),
          new Promise((_, rej) =>
            setTimeout(
              () =>
                rej(
                  new Error(
                    `Module "${mod.manifest.name}" hook "${String(hook)}" timed out after ${HOOK_TIMEOUT_MS}ms`
                  )
                ),
              HOOK_TIMEOUT_MS
            )
          ),
        ]);
        if (mod.failureCount > 0) mod.failureCount = 0;
      } catch (err) {
        mod.failureCount += 1;
        // eslint-disable-next-line no-console
        console.error(
          `[modules] hook "${String(hook)}" failed in "${mod.manifest.name}":`,
          err
        );
        if (mod.failureCount >= MAX_FAILURES) {
          mod.status = "failed";
          await onModuleFailed?.(mod, err);
        }
      }
    })
  );
}
