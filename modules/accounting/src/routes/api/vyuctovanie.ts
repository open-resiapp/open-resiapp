import { NextRequest, NextResponse } from "next/server";

import {
  requireReader,
  requireWriter,
} from "@modules/accounting/src/lib/api-guard";
import {
  getVyuctovaniePreview,
  notifySettlementPublished,
  publishVyuctovanie,
} from "@modules/accounting/src/lib/vyuctovanie";

// Vyúčtovanie wizard API — preview for board roles, publish (period lock,
// irreversible) for treasurer/admin.

export async function handleGet(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;

  const yearRaw = req.nextUrl.searchParams.get("year");
  const year = yearRaw ? Number(yearRaw) : new Date().getUTCFullYear() - 1;
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }

  const preview = await getVyuctovaniePreview(
    ctx.root.id,
    ctx.root.country,
    year
  );
  return NextResponse.json(preview);
}

/** POST /api/accounting/vyuctovanie — { year }. Locks the period. */
export async function handlePublish(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  let body: { year?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 });
  }

  try {
    const result = await publishVyuctovanie({
      entityId: ctx.root.id,
      country: ctx.root.country,
      year,
      actorId: ctx.session.user.id,
    });

    // Owner notifications run AFTER the publish committed — an email
    // failure must never roll back a legally published settlement. The
    // dedupe table makes re-triggering safe.
    let delivery = null;
    try {
      delivery = await notifySettlementPublished({
        entityId: ctx.root.id,
        settlementId: result.settlementId,
        buildingName: ctx.root.name,
        appBaseUrl:
          process.env.NEXTAUTH_URL ||
          process.env.APP_URL ||
          "http://localhost:3000",
      });
    } catch (err) {
      console.error("[accounting] settlement notification failed:", err);
    }

    return NextResponse.json({ ...result, delivery }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "publish failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
