import { NextRequest, NextResponse } from "next/server";

import { requireReader, requireWriter } from "@modules/accounting/src/lib/api-guard";
import {
  categorySlugMap,
  previewSchedulePublish,
  publishSchedule,
} from "@modules/accounting/src/lib/fee-schedule-publish";

// Predpis publish API. Preview computes per-unit assessments without
// persisting (treasurer verifies per-byt amounts before publish — spec:
// "mass-recompute with per-byt preview before publish").

export async function handlePreview(
  _req: NextRequest,
  scheduleId: string
): Promise<NextResponse> {
  const ctx = await requireReader();
  if (!ctx.ok) return ctx.error;
  try {
    const [preview, slugs] = await Promise.all([
      previewSchedulePublish(ctx.root.id, scheduleId),
      categorySlugMap(ctx.root.country),
    ]);
    return NextResponse.json({ preview, slugs });
  } catch (err) {
    const message = err instanceof Error ? err.message : "preview failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function handlePublish(
  _req: NextRequest,
  scheduleId: string
): Promise<NextResponse> {
  const ctx = await requireWriter();
  if (!ctx.ok) return ctx.error;
  try {
    const result = await publishSchedule({
      entityId: ctx.root.id,
      country: ctx.root.country,
      scheduleId,
      actorId: ctx.session.user.id,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "publish failed";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
