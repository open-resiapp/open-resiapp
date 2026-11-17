import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { principalContextFromSession } from "@/lib/mcp/principal";
import { isMcpError } from "@/lib/mcp/errors";
import { getDebtorListForPrincipal } from "@modules/accounting/src/lib/debtors";

// Debtor list (BYT-20261117-001 Decided 2): treasurer / chairman / admin get
// the full board list with names regardless of unit ownership; dom owners
// keep the §11 disclosure view (threshold + SK 500 € name rule).
export async function handleGet(): Promise<NextResponse> {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { principal, root } = await principalContextFromSession(session);
    const list = await getDebtorListForPrincipal(principal, root.country);
    return NextResponse.json(list);
  } catch (err) {
    if (isMcpError(err)) {
      if (err.code === "community_missing") {
        return NextResponse.json({ error: "no community" }, { status: 404 });
      }
      if (err.code === "forbidden") {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
      }
      if (err.code === "unauthorized") {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
    }
    throw err;
  }
}
