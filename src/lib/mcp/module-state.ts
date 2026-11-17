import "server-only";

import { isModuleEnabled } from "@/lib/modules/route-guard";
import { revokeAllTokens } from "./oauth/tokens";

// The `mcp` core module is the admin on/off switch for the whole MCP
// surface (BYT-20261117-001 §2): /api/mcp, /.well-known/oauth-*, /api/oauth/*
// and the consent page all 404 while it is disabled. It ships disabled
// (bootstrap-bundled.ts, defaultStatus "disabled").

export const MCP_MODULE = "mcp";

export function isMcpEnabled(): Promise<boolean> {
  return isModuleEnabled(MCP_MODULE);
}

/**
 * Called by every code path that flips a module's status. Disabling `mcp`
 * revokes every OAuth token + pending code on the instance, so a re-enable
 * never resurrects old grants.
 */
export async function onModuleStatusChanged(
  name: string,
  status: "enabled" | "disabled"
): Promise<void> {
  if (name !== MCP_MODULE || status !== "disabled") return;
  const n = await revokeAllTokens();
  console.info(`[mcp] module disabled — revoked ${n} OAuth token(s)`);
}
