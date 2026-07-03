// Accounting module entry (BYT-20260512-002). Source files live in
// `modules/accounting/src/`; this dist entry is the only file the host
// loader executes (same hand-maintained pattern as modules/voting until
// the module build step lands).

export default {
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
};
