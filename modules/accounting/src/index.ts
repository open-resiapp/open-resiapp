// Accounting module — typed source of truth. dist/index.js is the
// hand-maintained ESM entry the loader executes (same pattern as
// modules/voting); this TS source is the type contract for
// module-internal imports.

import { defineModule } from "@/lib/modules/sdk";

export default defineModule({
  name: "accounting",

  async onInstall(ctx) {
    ctx.sdk.log.info("accounting installing");
  },

  async onUninstall(ctx) {
    ctx.sdk.log.warn(
      "accounting uninstall requested — financial records carry a 10-year statutory retention (SK §35 zák. 431/2002). Use disable instead."
    );
  },

  async onAppStart(ctx) {
    ctx.sdk.log.info("accounting module started");
  },

  hooks: {},

  ui: {},
});

export * as booking from "./engine/booking";
export * as allocation from "./engine/allocation";
