import { NextRequest, NextResponse } from "next/server";

import { requireReader } from "@modules/accounting/src/lib/api-guard";
import { getVyuctovaniePreview } from "@modules/accounting/src/lib/vyuctovanie";

// Vyúčtovanie wizard API — read/preview stage (board roles). Publishing
// (PDF + period lock) is a separate write endpoint in the next slice.

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
