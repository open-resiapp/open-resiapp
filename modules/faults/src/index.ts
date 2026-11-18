// Faults module — typed source of truth. dist/index.js is the
// hand-maintained ESM entry the loader executes (same pattern as
// modules/voting and modules/accounting).

import { defineModule } from "@/lib/modules/sdk";

export default defineModule({
  name: "faults",

  async onInstall(ctx) {
    ctx.sdk.log.info("faults installing");
  },

  async onUninstall(ctx) {
    ctx.sdk.log.warn("faults uninstall requested — fault history is kept; use disable instead.");
  },

  async onAppStart(ctx) {
    ctx.sdk.log.info("faults module started");
  },

  hooks: {},

  ui: {},
});
