import { NextRequest, NextResponse } from "next/server";

import { requireWriter } from "@modules/accounting/src/lib/api-guard";
import { lookupSupplier } from "@modules/accounting/src/lib/supplier-lookup";

// Supplier IČO lookup API — treasurer/admin (expense-entry surface).

export async function handleGet(req: NextRequest): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;

  const ico = req.nextUrl.searchParams.get("ico") ?? "";
  const force = req.nextUrl.searchParams.get("force") === "1";

  const outcome = await lookupSupplier({
    country: ctx.root.country,
    ico,
    force,
  });
  return NextResponse.json(outcome);
}
