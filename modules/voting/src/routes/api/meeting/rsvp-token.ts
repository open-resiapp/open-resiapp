import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { answerWithToken } from "@modules/voting/src/meeting-token.server";

// BYT-20261118-001 §3 — public (no session): the signed meeting-rsvp token
// in the body is the only authority. Writes ONLY on POST (the page's
// "Potvrdiť" tap); there is no GET handler, so a prefetched link writes
// nothing.

const STATUSES = ["yes", "no", "maybe"] as const;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const status =
    body.status === null
      ? null
      : (STATUSES as readonly unknown[]).includes(body.status)
        ? (body.status as (typeof STATUSES)[number])
        : undefined;
  if (status === undefined) {
    return NextResponse.json({ error: "RSVP_INVALID_STATUS" }, { status: 400 });
  }
  const r = await answerWithToken(body.token, status);
  if (!r.ok) return NextResponse.json({ error: r.code }, { status: r.httpStatus });
  return NextResponse.json({ status: r.status });
}
