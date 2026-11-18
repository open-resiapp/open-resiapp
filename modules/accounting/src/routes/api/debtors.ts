import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { principalContextFromSession } from "@/lib/mcp/principal";
import { isMcpError } from "@/lib/mcp/errors";
import { getDebtorListForPrincipal } from "@modules/accounting/src/lib/debtors";
import { requireWriter } from "@modules/accounting/src/lib/api-guard";
import { canWriteAccounting } from "@modules/accounting/src/lib/authz";
import { getUpomienkyForAllDebtors } from "@modules/accounting/src/lib/overdue";

// Debtor list (BYT-20261117-001 Decided 2): treasurer / chairman / admin get
// the full board list with names regardless of unit ownership; dom owners
// keep the §11 disclosure view (threshold + SK 500 € name rule).
export async function handleGet(): Promise<NextResponse> {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const { principal, root } = await principalContextFromSession(session);
    const list = await getDebtorListForPrincipal(principal, root.country);
    // canWrite drives the bulk-upomienka button (the endpoint re-checks).
    const canWrite =
      list.audience === "board" &&
      (await canWriteAccounting(principal.userId, principal.role, root.id));
    return NextResponse.json({ ...list, canWrite, country: root.country });
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

/**
 * GET /api/accounting/debtors/upomienky-pdf — data for ONE combined PDF
 * with a page per debtor (net debt + overdue after preplatok netting).
 * Treasurer / admin only, SK template only.
 */
export async function handleUpomienkyPdfData(): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  if (ctx.root.country !== "sk") {
    return NextResponse.json({ error: "template_sk_only" }, { status: 400 });
  }
  const letters = await getUpomienkyForAllDebtors({
    entityId: ctx.root.id,
    country: ctx.root.country,
    beneficiaryName: ctx.root.name,
  });
  return NextResponse.json({
    letters,
    building: {
      name: ctx.root.name,
      address: ctx.root.address,
      ico: ctx.root.ico,
      dic: ctx.root.dic,
    },
  });
}
