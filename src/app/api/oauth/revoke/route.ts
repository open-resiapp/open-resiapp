import type { NextRequest } from "next/server";

import { handleOAuthPreflight, handleRevoke } from "@/lib/mcp/oauth/endpoints";

// RFC 7009 token revocation (BYT-20261117-001 §2).

export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return handleRevoke(req);
}

export function OPTIONS() {
  return handleOAuthPreflight();
}
