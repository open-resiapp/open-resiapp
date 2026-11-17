import type { NextRequest } from "next/server";

import { handleOAuthPreflight, handleRegister } from "@/lib/mcp/oauth/endpoints";

// RFC 7591 Dynamic Client Registration — fallback for hosts without CIMD
// (BYT-20261117-001 §2).

export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return handleRegister(req);
}

export function OPTIONS() {
  return handleOAuthPreflight();
}
