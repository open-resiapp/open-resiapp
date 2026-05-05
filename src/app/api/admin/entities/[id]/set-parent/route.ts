import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { entities } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { setParent } from "@/lib/entity-tree";
import { recordEntityAudit } from "@/lib/entity-audit";

async function handler(
  request: NextRequest,
  _apiKey: unknown,
  ctx?: { params: Promise<Record<string, string>> }
) {
  const params = ctx ? await ctx.params : {};
  const id = params.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = await request.json();
  const { parentId = null } = body ?? {};
  if (parentId !== null && typeof parentId !== "string") {
    return NextResponse.json(
      { error: "parentId must be a string or null" },
      { status: 400 }
    );
  }

  const [before] = await db
    .select({ parentId: entities.parentId, path: entities.path })
    .from(entities)
    .where(eq(entities.id, id))
    .limit(1);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    await setParent(id, parentId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "set-parent failed" },
      { status: 400 }
    );
  }

  recordEntityAudit({
    action: "entity.set_parent",
    actorUserId: null,
    entityId: id,
    before: { parentId: before.parentId, path: before.path },
    after: { parentId },
  });

  return NextResponse.json({ success: true });
}

export const POST = withExternalAuth(handler, "full");
