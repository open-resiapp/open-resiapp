import type { NextRequest } from "next/server";

import { handleAuthorize } from "@/lib/mcp/oauth/endpoints";

// OAuth 2.1 authorization endpoint → localized consent page
// (BYT-20261117-001 §2). 404 while the `mcp` module is disabled.

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return handleAuthorize(req);
}
