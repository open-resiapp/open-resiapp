import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { entities } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { archiveEntity } from "@/lib/entity-tree";
import { recordEntityAudit } from "@/lib/entity-audit";

async function handler(
  _request: NextRequest,
  _apiKey: unknown,
  ctx?: { params: Promise<Record<string, string>> }
) {
  const params = ctx ? await ctx.params : {};
  const id = params.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const [target] = await db
    .select()
    .from(entities)
    .where(eq(entities.id, id))
    .limit(1);
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });

  await archiveEntity(id);

  recordEntityAudit({
    action: "entity.archive",
    actorUserId: null,
    entityId: id,
    before: { archivedAt: target.archivedAt },
    after: { archivedAt: new Date().toISOString() },
  });

  return NextResponse.json({ success: true });
}

export const POST = withExternalAuth(handler, "full");
