import { NextRequest, NextResponse } from "next/server";

import { withExternalAuth } from "@/lib/external-auth";
import { unarchiveEntity } from "@/lib/entity-tree";
import { recordEntityAudit } from "@/lib/entity-audit";

async function handler(
  _request: NextRequest,
  _apiKey: unknown,
  ctx?: { params: Promise<Record<string, string>> }
) {
  const params = ctx ? await ctx.params : {};
  const id = params.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await unarchiveEntity(id);

  recordEntityAudit({
    action: "entity.archive",
    actorUserId: null,
    entityId: id,
    after: { archivedAt: null, unarchived: true },
  });

  return NextResponse.json({ success: true });
}

export const POST = withExternalAuth(handler, "full");
