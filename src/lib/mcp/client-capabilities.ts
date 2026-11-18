import "server-only";

import type { ClientCapabilities } from "@modelcontextprotocol/server";
import { getUiCapability, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { oauthClients } from "@/db/schema";
import type { ValidAccessToken } from "./oauth/tokens";

// MCP Apps UI capability per OAuth client (stateless serving).
//
// 2026-07-28 clients send their capabilities in every request envelope.
// 2025-era clients (Claude.ai / Desktop / ChatGPT on 2025-11-25 …) declare
// them ONCE, in `initialize` — a different HTTP request than the later
// tools/call, which in stateless serving (any replica, fresh McpServer per
// request) knows nothing about it. Without memory those hosts were treated
// as "no UI" and got link-only confirm cards.
//
// So the `initialize` request records the declaration on the client's
// oauth_clients row (one UPDATE by primary key — no DDL, no lock beyond
// that row, safe on N replicas), and tools/call falls back to it when the
// envelope carries no capabilities.
//
// Caveat: one CIMD client_id can be shared by several surfaces of the same
// vendor (web / desktop / mobile). The value is "last initialize wins";
// a surface that renders no UI but shares a client_id with one that does
// would get the token-bearing card. Hosts that do not render MCP Apps do not
// show result `_meta` to the model either, and `confirm_action` stays
// app-only + token-bound, so the residual risk is a model that sees the
// app-only tool AND the token — documented, accepted for v1.

/** Re-write an unchanged declaration at most this often (keeps writes rare). */
const REFRESH_MS = 60 * 60 * 1000;

/** Does this capability object declare MCP Apps UI support we can render to? */
export function declaresAppsUi(caps: ClientCapabilities | null | undefined): boolean {
  const ui = getUiCapability(caps ?? undefined);
  if (!ui) return false;
  // A host that lists MIME types must list the MCP App one.
  return !Array.isArray(ui.mimeTypes) || ui.mimeTypes.includes(RESOURCE_MIME_TYPE);
}

const logged = new Set<string>();

function logOnce(token: ValidAccessToken, protocolVersion: string | null, ui: boolean, clientInfo: string) {
  const key = `${token.clientRowId}|${protocolVersion ?? "?"}|${ui ? 1 : 0}`;
  if (logged.has(key)) return;
  if (logged.size > 1000) logged.clear();
  logged.add(key);
  // No user data: client display name, protocol version, UI flag only.
  console.info(
    `[mcp] initialize client="${token.clientName}"${clientInfo ? ` clientInfo="${clientInfo}"` : ""} protocol=${protocolVersion ?? "unknown"} appsUi=${ui ? "yes" : "no"}`
  );
}

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
}

/**
 * Called for a JSON-RPC `initialize` request body. Logs the negotiated
 * protocol + UI flag (once per client / version / flag per process) and
 * persists the UI flag on the client row when it changed or went stale.
 * Never throws — a failed write only means the next tools/call falls back
 * to the previous value.
 */
export async function recordInitialize(token: ValidAccessToken, params: unknown): Promise<void> {
  try {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const protocolVersion = str(p.protocolVersion, 32);
    const caps = (p.capabilities && typeof p.capabilities === "object"
      ? p.capabilities
      : {}) as ClientCapabilities;
    const ui = declaresAppsUi(caps);
    const info = (p.clientInfo && typeof p.clientInfo === "object" ? p.clientInfo : {}) as Record<
      string,
      unknown
    >;
    const clientInfo = [str(info.name, 80), str(info.version, 40)].filter(Boolean).join(" ");
    logOnce(token, protocolVersion, ui, clientInfo);

    const fresh =
      token.clientCapabilitiesSeenAt !== null &&
      Date.now() - token.clientCapabilitiesSeenAt.getTime() < REFRESH_MS;
    if (token.clientAppsUi === ui && token.clientProtocolVersion === protocolVersion && fresh) return;

    await db
      .update(oauthClients)
      .set({ appsUiDeclared: ui, mcpProtocolVersion: protocolVersion, capabilitiesSeenAt: new Date() })
      .where(eq(oauthClients.id, token.clientRowId));
  } catch (err) {
    console.warn("[mcp] could not record client capabilities:", err instanceof Error ? err.message : err);
  }
}
