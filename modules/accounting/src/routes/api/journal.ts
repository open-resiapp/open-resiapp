import { NextRequest, NextResponse } from "next/server";

import { requireReader } from "@modules/accounting/src/lib/api-guard";
import {
  getTrialBalance,
  listAccountingYears,
  listJournal,
} from "@modules/accounting/src/lib/accountant-view";

// Pohľad účtovníka API — board roles (treasurer/chairman/admin). The one
// endpoint that speaks debit/credit; owners have no access (403).
// `tb=0` skips the all-time trial balance (the screen reads the per-year
// one from /api/accounting/reports/trial-balance), so paging the journal
// does not recompute it.

export async function handleGet(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;

  const sp = req.nextUrl.searchParams;
  const page = Math.max(0, Number(sp.get("page")) || 0);
  const withTb = sp.get("tb") !== "0";
  const [trialBalance, journal, years] = await Promise.all([
    withTb ? getTrialBalance(ctx.root.id, ctx.root.country) : Promise.resolve(null),
    listJournal(ctx.root.id, page),
    listAccountingYears(ctx.root.id),
  ]);
  return NextResponse.json({
    ...(trialBalance ? { trialBalance } : {}),
    journal,
    page,
    years,
  });
}
