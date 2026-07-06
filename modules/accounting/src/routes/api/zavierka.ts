import { NextRequest, NextResponse } from "next/server";

import { requireApprover, requireReader } from "@modules/accounting/src/lib/api-guard";
import { canApproveAccounting } from "@modules/accounting/src/lib/authz";
import {
  approveZavierka,
  getZavierkaStatus,
} from "@modules/accounting/src/lib/zavierka";

// Účtovná závierka approval API (AC 423/521).
//   GET  — status (reader: treasurer/chairman/admin)
//   POST — approve (approver: chairman/admin only — no ledger write)

/** GET /api/accounting/zavierka?year=YYYY */
export async function handleGet(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  const yearParam = req.nextUrl.searchParams.get("year");
  const year = Number(yearParam);
  // `Number(null)`/`Number("")` are 0 (a valid integer) — reject a missing or
  // empty param explicitly rather than silently answering for year 0.
  if (!yearParam || !Number.isInteger(year)) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }
  const [status, viewerCanApprove] = await Promise.all([
    getZavierkaStatus(ctx.root.id, year),
    canApproveAccounting(
      ctx.session.user.id,
      ctx.session.user.role as string,
      ctx.root.id
    ),
  ]);
  return NextResponse.json({ ...status, viewerCanApprove });
}

/** POST /api/accounting/zavierka — { year, votingItemId }. Chairman only. */
export async function handleApprove(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireApprover();
  if (!ctx.ok) return ctx.error;

  let body: { year?: unknown; votingItemId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  // Reject null/undefined explicitly — `Number(null)` is 0, a valid integer.
  const year = body.year == null ? NaN : Number(body.year);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }
  if (typeof body.votingItemId !== "string" || body.votingItemId.trim() === "") {
    return NextResponse.json({ error: "votingItemId required" }, { status: 400 });
  }

  try {
    await approveZavierka({
      entityId: ctx.root.id,
      year,
      votingItemId: body.votingItemId,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "approval failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
