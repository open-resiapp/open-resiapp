import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { principalFromSession, viewerFromSession } from "@/lib/mcp/principal";
import { toMcpError } from "@/lib/mcp/errors";
import { createVoting, listVisibleVotings } from "@modules/voting/src/votings";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const result = await listVisibleVotings(viewerFromSession(session));
  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  try {
    // BYT-20261117-001 Decided 1: admin OR active chairman — the same
    // assertBoard check the MCP draft_voting tool uses.
    const principal = await principalFromSession(session);
    const voting = await createVoting(principal, body);
    return NextResponse.json(voting, { status: 201 });
  } catch (err) {
    const e = toMcpError(err);
    if (e.code === "unauthorized") {
      return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
    }
    if (e.code === "forbidden") {
      return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
    }
    if (e.code === "validation.endsAt" && typeof e.details?.minEnd === "string") {
      return NextResponse.json(
        { error: `Písomné hlasovanie musí trvať minimálne 15 dní. Najskorší koniec: ${e.details.minEnd}` },
        { status: 400 }
      );
    }
    if (e.code === "validation.items" && e.details?.quorum) {
      return NextResponse.json(e.details.quorum, { status: 400 });
    }
    if (e.code === "validation.items" && typeof e.details?.raw === "string") {
      return NextResponse.json({ error: e.details.raw }, { status: 400 });
    }
    if (e.code.startsWith("validation.")) {
      return NextResponse.json(
        { error: "Nadpis, začiatok a koniec sú povinné" },
        { status: 400 }
      );
    }
    throw err;
  }
}
