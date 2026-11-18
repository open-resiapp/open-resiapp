import { NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";

import {
  requireReader,
  requireWriter,
} from "@modules/accounting/src/lib/api-guard";
import {
  getVyuctovaniePreview,
  isVyuctovanieError,
  notifySettlementPublished,
  publishVyuctovanie,
} from "@modules/accounting/src/lib/vyuctovanie";
import { requestLocale } from "@modules/accounting/src/lib/input-errors.server";

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
    // Stable code → localized catalog entry (Accounting.vyuctovanie.errors).
    // Anything else is unexpected: log it, never leak raw English text.
    const t = await getTranslations({
      locale: requestLocale(req),
      namespace: "Accounting.vyuctovanie.errors",
    });
    if (isVyuctovanieError(err)) {
      return NextResponse.json(
        { error: t(err.code as Parameters<typeof t>[0]), code: err.code },
        { status: err.code === "PERIOD_NOT_FOUND" ? 404 : 409 }
      );
    }
    console.error("[accounting] vyúčtovanie publish failed:", err);
    return NextResponse.json(
      { error: t("UNKNOWN"), code: "UNKNOWN" },
      { status: 500 }
    );
  }
}
