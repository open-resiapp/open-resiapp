import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { entities } from "@/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { createEntity, type EntityKind } from "@/lib/entity-tree";
import { recordEntityAudit } from "@/lib/entity-audit";
import { getKind } from "@/lib/kinds/registry.server";

async function handleList(request: NextRequest, _apiKey: unknown) {
  const { searchParams } = new URL(request.url);
  const includeArchived = searchParams.get("includeArchived") === "true";
  const kindParam = searchParams.get("kind");
  const conditions = [] as Array<ReturnType<typeof eq>>;
  if (!includeArchived) conditions.push(isNull(entities.archivedAt));
  if (kindParam && (await getKind(kindParam))) {
    conditions.push(eq(entities.kind, kindParam));
  }
  const rows = await db
    .select()
    .from(entities)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(entities.createdAt));
  return NextResponse.json(rows);
}

async function handleCreate(request: NextRequest, _apiKey: unknown) {
  const body = await request.json();
  const { parentId = null, kind, name } = body ?? {};

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof kind !== "string" || !(await getKind(kind))) {
    return NextResponse.json(
      { error: "kind must be a registered entity_kinds slug" },
      { status: 400 }
    );
  }
  if (parentId !== null && typeof parentId !== "string") {
    return NextResponse.json({ error: "parentId must be a string or null" }, { status: 400 });
  }

  try {
    const created = await createEntity({
      parentId,
      kind: kind as EntityKind,
      name,
    });
    recordEntityAudit({
      action: "entity.create",
      actorUserId: null,
      entityId: created.id,
      after: { name: created.name, kind: created.kind, parentId: created.parentId },
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "create failed" },
      { status: 400 }
    );
  }
}

export const GET = withExternalAuth(handleList, "full");
export const POST = withExternalAuth(handleCreate, "full");
