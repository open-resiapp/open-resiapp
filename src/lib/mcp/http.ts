import "server-only";

import type { NextRequest } from "next/server";

import { authenticateBearer, unauthorizedResponse } from "./bearer";
import { buildToolContext } from "./context";
import { isMcpError } from "./errors";
import { isMcpEnabled } from "./module-state";
import { getResourceMetadataUrl, getResourceUrl } from "./config";
import { getMcpHandler } from "./server";

// HTTP entry for /api/mcp (BYT-20261117-001 §1). The route file only
// re-exports these handlers (route.ts may export HTTP methods only).

const NOT_FOUND = () => new Response(null, { status: 404 });

/** No server-push / subscriptions in this server (§1): pull-only tools. */
const REFUSED_METHODS = new Set(["subscriptions/listen"]);

export async function handleMcpPost(req: NextRequest): Promise<Response> {
  if (!(await isMcpEnabled())) return NOT_FOUND();

  const auth = await authenticateBearer(req);
  if (!auth.ok) return auth.response;

  let ctx;
  try {
    ctx = await buildToolContext(auth.token, req.url);
  } catch (err) {
    if (isMcpError(err) && err.code === "unauthorized") {
      return unauthorizedResponse(req.url, true);
    }
    if (isMcpError(err) && err.code === "community_missing") {
      return Response.json({ error: "community_missing" }, { status: 503 });
    }
    throw err;
  }

  // Peek at the JSON-RPC method so subscription streams are refused up front.
  let parsedBody: unknown = undefined;
  try {
    parsedBody = await req.clone().json();
  } catch {
    parsedBody = undefined; // let the SDK answer the parse error
  }
  const method =
    parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
      ? (parsedBody as { method?: unknown }).method
      : undefined;
  if (typeof method === "string" && REFUSED_METHODS.has(method)) {
    const id = (parsedBody as { id?: unknown }).id ?? null;
    return Response.json(
      { jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } },
      { status: 200 }
    );
  }

  return getMcpHandler().fetch(req, {
    authInfo: {
      token: auth.rawToken,
      clientId: auth.token.clientId,
      scopes: [...auth.token.scopes],
      expiresAt: Math.floor(auth.token.expiresAt.getTime() / 1000),
      resource: new URL(getResourceUrl(req.url)),
      resourceMetadataUrl: getResourceMetadataUrl(req.url),
      extra: { toolContext: ctx },
    },
    ...(parsedBody !== undefined ? { parsedBody } : {}),
  });
}

/** Stateless server: no SSE stream (GET) and no session to delete (DELETE). */
export async function handleMcpMethodNotAllowed(): Promise<Response> {
  if (!(await isMcpEnabled())) return NOT_FOUND();
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Method not allowed." } },
    { status: 405, headers: { Allow: "POST" } }
  );
}
