// Voting module entry. Free, bundled with core.
// Slovak/Czech HOA legal voting engine — extracted from core under
// RES-20260505-001. Source files live in `modules/voting/src/`; this
// dist entry is the only file the host loader executes.

export default {
  name: "voting",

  async onInstall(ctx) {
    ctx.sdk.log.info("voting installing — bundled module");
    // Tables already present from core schema during dual-run; full
    // mod_voting_* rename ships in VM-6 migration.
  },

  async onUninstall(ctx) {
    ctx.sdk.log.warn(
      "voting uninstall requested — voting data is legally required to retain (SK §14a / CZ analog). Use disable instead."
    );
  },

  async onAppStart(ctx) {
    ctx.sdk.log.info("voting module started");
  },

  hooks: {
    // Reserved for future cross-module subscribers (e.g. passkey).
  },

  ui: {
    // Sidebar + dashboard widgets registered in VM-5 once UI is moved.
  },
};
