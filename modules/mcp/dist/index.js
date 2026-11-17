// MCP core module entry (BYT-20261117-001). The MCP server, OAuth
// authorization server and tools are core code (src/lib/mcp/*, src/app/api/mcp,
// src/app/api/oauth, src/app/.well-known); this module exists only as the
// admin on/off switch (core_modules row, `isModuleEnabled("mcp")`). It ships
// DISABLED — bootstrap-bundled.ts inserts its row with status "disabled".
// Disabling it revokes every OAuth token (src/lib/mcp/module-state.ts).

export default {
  name: "mcp",

  async onInstall(ctx) {
    ctx.sdk.log.info("mcp installing (disabled by default)");
  },

  async onAppStart(ctx) {
    ctx.sdk.log.info("mcp module started");
  },

  hooks: {},

  ui: {},
};
