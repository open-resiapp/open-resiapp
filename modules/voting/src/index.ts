// Voting module — typed source of truth.
// Build step (TS → dist/index.js) is wired up in VM-5. Until then,
// dist/index.js is a hand-maintained ESM file and this TS source acts
// as the type contract for module-internal imports.

import { defineModule } from "@/lib/modules/sdk";

export default defineModule({
  name: "voting",

  async onInstall(ctx) {
    ctx.sdk.log.info("voting installing");
  },

  async onUninstall(ctx) {
    ctx.sdk.log.warn(
      "voting uninstall blocked while voting records exist (SK §14a). Disable instead."
    );
  },

  async onAppStart(ctx) {
    ctx.sdk.log.info("voting module started");
  },

  hooks: {},

  ui: {},
});

// Re-export module-internal modules for use by route passthroughs in
// src/app/[locale]/(dashboard)/voting/* and src/app/api/votings/*.
// During VM-2..VM-5 these are progressively populated.
export * as engine from "./engine";
export * as rules from "./rules";
