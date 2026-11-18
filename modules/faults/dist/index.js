// Faults module entry (BYT-20261118-004). Source lives in
// `modules/faults/src/`; this dist entry is the only file the host loader
// executes (same hand-maintained pattern as modules/voting + accounting).

export default {
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
};
