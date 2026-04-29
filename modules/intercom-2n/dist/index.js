// Reference skeleton — 2N intercom module.
// Entry file is plain ESM JS so no build step is needed for the skeleton.
// A real module ships a bundled `dist/`.

export default {
  name: "intercom-2n",

  async onInstall(ctx) {
    ctx.sdk.log.info("intercom-2n installing — running migrations");
    await ctx.sdk.db.runMigrations();
  },

  async onUninstall(ctx) {
    ctx.sdk.log.info("intercom-2n uninstalling — host will drop tables");
  },

  async onAppStart(ctx) {
    ctx.sdk.log.info("intercom-2n started");
  },

  hooks: {
    onPostCreate: async (post, ctx) => {
      ctx.sdk.log.info(`saw post create: ${post.id}`);
    },
  },

  ui: {
    "dashboard.widgets": () => import("./ui/IntercomWidget.js"),
  },
};
