import { NextRequest, NextResponse } from "next/server";

import type { Session } from "next-auth";

import { auth } from "@/lib/auth";
import {
  getCommunityRoot,
  type CommunityRootRow,
} from "@/lib/legacy-compat";
import { canWriteAccounting } from "@modules/accounting/src/lib/authz";
import {
  getOpeningBalanceState,
  submitOpeningBalance,
} from "@modules/accounting/src/lib/opening-balance";

// Opening-balance tool API — write-privileged (treasurer / admin) only,
// including GET: the tool exposes whole-dom financial state.

type WriterCtx =
  | { ok: false; error: NextResponse }
  | { ok: true; session: Session; root: CommunityRootRow };

async function requireWriter(): Promise<WriterCtx> {
  const session = await auth();
  if (!session) {
    return {
      ok: false,
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  const root = await getCommunityRoot();
  if (!root) {
    return {
      ok: false,
      error: NextResponse.json({ error: "no community" }, { status: 404 }),
    };
  }
  const allowed = await canWriteAccounting(
    session.user.id,
    session.user.role as string,
    root.id
  );
  if (!allowed) {
    return {
      ok: false,
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { ok: true, session, root };
}

export async function handleGet(): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  const year = new Date().getFullYear();
  const state = await getOpeningBalanceState(
    ctx.root.id,
    ctx.root.country,
    year
  );
  return NextResponse.json(state);
}

export async function handlePost(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: {
    year?: number;
    bankaCents?: number;
    pokladnicaCents?: number;
    unitBalances?: { unitEntityId: string; fpuoCents: number; zalohyCents: number }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }
  const bankaCents = Number(body.bankaCents);
  const pokladnicaCents = Number(body.pokladnicaCents);
  if (
    !Number.isInteger(bankaCents) ||
    !Number.isInteger(pokladnicaCents) ||
    bankaCents < 0 ||
    pokladnicaCents < 0
  ) {
    return NextResponse.json({ error: "invalid amounts" }, { status: 400 });
  }
  if (!Array.isArray(body.unitBalances)) {
    return NextResponse.json({ error: "invalid unitBalances" }, { status: 400 });
  }
  const unitBalances = body.unitBalances.map((u) => ({
    unitEntityId: String(u.unitEntityId),
    fpuoCents: Number(u.fpuoCents),
    zalohyCents: Number(u.zalohyCents),
  }));
  if (
    unitBalances.some(
      (u) => !Number.isInteger(u.fpuoCents) || !Number.isInteger(u.zalohyCents)
    )
  ) {
    return NextResponse.json({ error: "invalid unit amounts" }, { status: 400 });
  }

  try {
    const result = await submitOpeningBalance({
      entityId: ctx.root.id,
      country: ctx.root.country,
      year,
      createdById: ctx.session.user.id,
      bankaCents,
      pokladnicaCents,
      unitBalances,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "posting failed";
    const status = message.includes("already posted") ? 409 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
