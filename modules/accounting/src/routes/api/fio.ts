import { NextRequest, NextResponse } from "next/server";

import { requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  getFioConnection,
  setFioToken,
  syncFio,
} from "@modules/accounting/src/lib/fio";

// Fio connector API — treasurer/admin only. The token is write-only:
// GET returns a masked preview, never the credential.

export async function handleGet(): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  const state = await getFioConnection(ctx.root.id);
  return NextResponse.json(state);
}

export async function handleSetToken(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (typeof body.token !== "string" || body.token.trim() === "") {
    return NextResponse.json({ error: "missing token" }, { status: 400 });
  }

  try {
    await setFioToken({
      entityId: ctx.root.id,
      actorId: ctx.session.user.id,
      token: body.token,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "save failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function handleSync(): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  try {
    const summary = await syncFio({
      entityId: ctx.root.id,
      country: ctx.root.country,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "sync failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
