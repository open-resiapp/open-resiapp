import type { NextRequest } from "next/server";

import { handleOAuthPreflight, handleToken } from "@/lib/mcp/oauth/endpoints";

// OAuth 2.1 token endpoint (BYT-20261117-001 §2).

export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return handleToken(req);
}

export function OPTIONS() {
  return handleOAuthPreflight();
}
