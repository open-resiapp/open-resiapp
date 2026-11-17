import type { NextRequest } from "next/server";

import { handleMcpMethodNotAllowed, handleMcpPost } from "@/lib/mcp/http";

// MCP endpoint (BYT-20261117-001 §1) — stateless Streamable HTTP. All logic
// lives in src/lib/mcp/*; this file exports HTTP handlers only.

export const dynamic = "force-dynamic";

export function POST(req: NextRequest) {
  return handleMcpPost(req);
}

export function GET() {
  return handleMcpMethodNotAllowed();
}

export function DELETE() {
  return handleMcpMethodNotAllowed();
}
