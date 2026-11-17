import type { NextRequest } from "next/server";

import {
  handleAuthorizationServerMetadata,
  handleOAuthPreflight,
} from "@/lib/mcp/oauth/endpoints";

// RFC 8414 Authorization Server Metadata (BYT-20261117-001 §2). 404 while
// the `mcp` module is disabled.

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleAuthorizationServerMetadata(req);
}

export function OPTIONS() {
  return handleOAuthPreflight();
}
