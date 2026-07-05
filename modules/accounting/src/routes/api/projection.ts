import { NextResponse } from "next/server";

import { requireReader } from "@modules/accounting/src/lib/api-guard";
import { getCashflowProjection } from "@modules/accounting/src/lib/projection";

// Cash-flow projection API — board roles (whole-dom financial view).

export async function handleGet(): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  const projection = await getCashflowProjection(
    ctx.root.id,
    ctx.root.country
  );
  return NextResponse.json(projection);
}
