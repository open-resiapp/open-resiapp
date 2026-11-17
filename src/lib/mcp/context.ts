import "server-only";

import { isDomOwnerOf } from "@/lib/community-info";
import { listEnabledModules } from "@/lib/modules/route-guard";
import { getPublicOrigin } from "./config";
import { loadPrincipalContext } from "./principal";
import type { ValidAccessToken } from "./oauth/tokens";
import type { ToolContext } from "./tools/types";

// Per-request tool context for an authenticated MCP call: live principal
// (role / status / board roles read from the DB, scopes from the token),
// community root, enabled modules, owner flag.

export async function buildToolContext(
  token: ValidAccessToken,
  requestUrl: string
): Promise<ToolContext> {
  const { principal, root } = await loadPrincipalContext(token.userId, {
    scopes: token.scopes,
    clientId: token.clientId,
  });
  const [modules, isDomOwner] = await Promise.all([
    listEnabledModules(),
    isDomOwnerOf(principal.userId, root.id),
  ]);
  return {
    principal,
    root,
    enabledModules: new Set(modules),
    isDomOwner,
    clientName: token.clientName,
    origin: getPublicOrigin(requestUrl),
    numberLocale: root.country === "cz" ? "cs-CZ" : "sk-SK",
  };
}
