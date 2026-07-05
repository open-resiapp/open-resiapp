import { NextRequest, NextResponse } from "next/server";

import { requireReader } from "@modules/accounting/src/lib/api-guard";
import {
  getTrialBalance,
  listJournal,
} from "@modules/accounting/src/lib/accountant-view";

// Pohľad účtovníka API — board roles (treasurer/chairman/admin). The one
// endpoint that speaks debit/credit; owners have no access (403).

export async function handleGet(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;

  const page = Math.max(0, Number(req.nextUrl.searchParams.get("page")) || 0);
  const [trialBalance, journal] = await Promise.all([
    getTrialBalance(ctx.root.id, ctx.root.country),
    listJournal(ctx.root.id, page),
  ]);
  return NextResponse.json({ trialBalance, journal, page });
}
