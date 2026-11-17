import type { NextRequest } from "next/server";

import {
  handleOAuthPreflight,
  handleProtectedResourceMetadata,
} from "@/lib/mcp/oauth/endpoints";

// RFC 9728 Protected Resource Metadata (BYT-20261117-001 §2). Serves both
// /.well-known/oauth-protected-resource and the path-inserted form
// /.well-known/oauth-protected-resource/api/mcp. 404 while `mcp` is disabled.

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleProtectedResourceMetadata(req);
}

export function OPTIONS() {
  return handleOAuthPreflight();
}
