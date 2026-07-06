import { NextRequest, NextResponse } from "next/server";

import { syncRates } from "@modules/accounting/src/lib/rate-sync";

// Central-bank rate-sync cron (BYT-20260512-002 Phase 5). Same shared-secret
// contract as /api/cron/community: POST with `x-cron-secret`. Appends the
// latest ECB/ČNB rate to the úroky-z-omeškania history (idempotent per day).

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (request.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = await syncRates();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/accounting-rates] failed:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
