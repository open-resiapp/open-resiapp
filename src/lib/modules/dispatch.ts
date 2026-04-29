import "server-only";

import { db } from "@/db";
import { building } from "@/db/schema";

import type { DomainHooks } from "./sdk";
import { runHook } from "./registry";
import { buildContextFor } from "./sdk-runtime";
import { markModuleFailed } from "./state";

export async function dispatchHook<K extends keyof DomainHooks>(
  hook: K,
  payload: Parameters<DomainHooks[K]>[0]
): Promise<void> {
  const [communityRow] = await db.select().from(building).limit(1);
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
