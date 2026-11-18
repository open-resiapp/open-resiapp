import { NextRequest, NextResponse } from "next/server";

import { isModuleEnabled } from "@/lib/modules/route-guard";
import { runStaleDigest } from "@modules/faults/src/lib/digest.server";

// Weekly stale-fault digest (BYT-20261118-004). Cron sidecar fires
// `0 7 * * 1` (docker-compose.*.yml) with `x-cron-secret`. Self-gates on the
// faults module: disabled → clean no-op 200. Dedupe / double-run safety is
// the insert-on-conflict claim inside runStaleDigest — no in-process state.

export async function POST(request: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (request.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await isModuleEnabled("faults"))) {
    return NextResponse.json({ ok: true, skipped: "faults module disabled" });
  }
  try {
    const result = await runStaleDigest();
    return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[cron/faults] failed:", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
