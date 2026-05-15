import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { entities } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { recordEntityAudit } from "@/lib/entity-audit";
import { getKind } from "@/lib/kinds/registry.server";

// Set-kind is one-way and audit-logged. The spec gates this at the
// admin API layer (RES-20260501-002 §"Operator-only mutation surface")
// because changing an entity's kind has cascading semantic effects:
// per-kind extension data shapes (housing_unit_data vs housing_root_data),
// voting eligibility math, UI translations.
async function handler(
  request: NextRequest,
  _apiKey: unknown,
  ctx?: { params: Promise<Record<string, string>> }
) {
  const params = ctx ? await ctx.params : {};
  const id = params.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = await request.json();
  const { kind } = body ?? {};
  if (typeof kind !== "string" || !(await getKind(kind))) {
    return NextResponse.json(
      { error: "kind must be a registered entity_kinds slug" },
      { status: 400 }
    );
  }

  const [before] = await db
    .select({ kind: entities.kind, name: entities.name })
    .from(entities)
    .where(eq(entities.id, id))
    .limit(1);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (before.kind === kind) {
    return NextResponse.json({ success: true, unchanged: true });
  }

  await db
    .update(entities)
    .set({ kind })
    .where(eq(entities.id, id));

  recordEntityAudit({
    action: "entity.set_kind",
    actorUserId: null,
    entityId: id,
    before: { kind: before.kind },
    after: { kind },
  });

  return NextResponse.json({ success: true });
}

export const POST = withExternalAuth(handler, "full");
