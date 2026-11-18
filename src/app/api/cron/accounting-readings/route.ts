import { NextRequest, NextResponse } from "next/server";
import { secretsEqual } from "@/lib/secret-compare.server";

import { isModuleEnabled } from "@/lib/modules/route-guard";
import { runReadingReminders } from "@modules/accounting/src/lib/reading-reminders";

// Reading-round reminder cron (BYT-20261118-006). Same shared-secret
// contract as /api/cron/accounting-rates: POST with `x-cron-secret`, daily
// from the cron sidecar in docker-compose.*.yml. Self-gates on the
// accounting module (disabled ⇒ clean 200 no-op). Dedupe lives in the DB
// (insert-on-conflict claim per round × recipient), so a duplicate call or
// a second replica never double-sends.

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }
  if (!secretsEqual(request.headers.get("x-cron-secret"), expected)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!(await isModuleEnabled("accounting"))) {
    return NextResponse.json({ ok: true, skipped: "accounting module disabled" });
  }

  try {
    const result = await runReadingReminders();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error("[cron/accounting-readings] failed:", error);
    return NextResponse.json({ ok: false, error: "internal" }, { status: 500 });
  }
}
