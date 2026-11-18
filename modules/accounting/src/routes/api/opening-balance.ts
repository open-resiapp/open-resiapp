import { NextRequest, NextResponse } from "next/server";

import { isInt4 } from "@modules/accounting/src/lib/input-validators";
import { requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  correctOpeningBalance,
  getOpeningBalanceState,
  OpeningBalanceError,
  submitOpeningBalance,
} from "@modules/accounting/src/lib/opening-balance";

// Opening-balance tool API — write-privileged (treasurer / admin) only,
// including GET: the tool exposes whole-dom financial state.
//
// POST { year, bankaCents, pokladnicaCents, unitBalances[] }           → first posting
// POST { correction: true, reason, bankaCents, pokladnicaCents, … }   → reversal + repost
// Errors are stable codes ({ error: "<code>" }); the UI maps them to i18n.

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

const nonNegInt = (v: number) => isInt4(v) && v >= 0;

export async function handlePost(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: {
    year?: number;
    correction?: boolean;
    reason?: string;
    bankaCents?: number;
    pokladnicaCents?: number;
    unitBalances?: {
      unitEntityId: string;
      fpuoCents: number;
      zalohyCents: number;
      nedoplatokCents?: number;
      preplatokCents?: number;
    }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const correction = body.correction === true;
  const year = Number(body.year);
  if (!correction && (!Number.isInteger(year) || year < 2000 || year > 2100)) {
    return NextResponse.json({ error: "invalid_year" }, { status: 400 });
  }
  const bankaCents = Number(body.bankaCents);
  const pokladnicaCents = Number(body.pokladnicaCents);
  if (!nonNegInt(bankaCents) || !nonNegInt(pokladnicaCents)) {
    return NextResponse.json({ error: "invalid_amounts" }, { status: 400 });
  }
  if (!Array.isArray(body.unitBalances)) {
    return NextResponse.json({ error: "invalid_amounts" }, { status: 400 });
  }
  // New fields are optional (default 0) so older callers keep working.
  const unitBalances = body.unitBalances.map((u) => ({
    unitEntityId: String(u.unitEntityId),
    fpuoCents: Number(u.fpuoCents ?? 0),
    zalohyCents: Number(u.zalohyCents ?? 0),
    nedoplatokCents: Number(u.nedoplatokCents ?? 0),
    preplatokCents: Number(u.preplatokCents ?? 0),
  }));
  if (
    unitBalances.some(
      (u) =>
        !isInt4(u.fpuoCents) ||
        !isInt4(u.zalohyCents) ||
        !nonNegInt(u.nedoplatokCents) ||
        !nonNegInt(u.preplatokCents)
    )
  ) {
    return NextResponse.json({ error: "invalid_amounts" }, { status: 400 });
  }

  try {
    const common = {
      entityId: ctx.root.id,
      country: ctx.root.country,
      createdById: ctx.session.user.id,
      bankaCents,
      pokladnicaCents,
      unitBalances,
    };
    const result = correction
      ? await correctOpeningBalance({
          ...common,
          reason: typeof body.reason === "string" ? body.reason.slice(0, 500) : "",
        })
      : await submitOpeningBalance({ ...common, year });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof OpeningBalanceError) {
      const status =
        err.code === "already_posted" || err.code === "opening_period_locked"
          ? 409
          : 400;
      return NextResponse.json({ error: err.code }, { status });
    }
    console.error("opening-balance posting failed", err);
    return NextResponse.json({ error: "posting_failed" }, { status: 400 });
  }
}
