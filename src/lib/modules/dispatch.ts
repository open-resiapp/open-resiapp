import "server-only";

import type { DomainHooks } from "./sdk";
import { runHook } from "./registry";
import { buildContextFor } from "./sdk-runtime";
import { markModuleFailed } from "./state";
import { getCommunityRoot } from "@/lib/legacy-compat";

export async function dispatchHook<K extends keyof DomainHooks>(
  hook: K,
  payload: Parameters<DomainHooks[K]>[0]
): Promise<void> {
  const communityRow = await getCommunityRoot();
  if (!communityRow) return;
  await runHook(
    hook,
    payload,
    (mod) => buildContextFor(mod, communityRow),
    async (mod, err) => {
      await markModuleFailed(mod.manifest.name, err);
      console.warn(
        `[modules] auto-disabled "${mod.manifest.name}" after repeated failures`
      );
    }
  );
}
