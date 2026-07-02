import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  entities,
  memberships,
  posts,
  documents,
  communityPosts,
  boardMembers,
  coreModuleGrants,
} from "@/db/schema";
import { votings, ballots, mandates } from "@modules/voting/src/db/schema";
import { withExternalAuth } from "@/lib/external-auth";
import { recordEntityAudit } from "@/lib/entity-audit";

async function handleGet(
  _request: NextRequest,
  _apiKey: unknown,
  ctx?: { params: Promise<Record<string, string>> }
) {
  const params = ctx ? await ctx.params : {};
  const id = params.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const [row] = await db
    .select()
    .from(entities)
    .where(eq(entities.id, id))
    .limit(1);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

async function handlePatch(
  request: NextRequest,
  _apiKey: unknown,
  ctx?: { params: Promise<Record<string, string>> }
) {
  const params = ctx ? await ctx.params : {};
  const id = params.id;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const body = await request.json();
  const updateData: Partial<typeof entities.$inferInsert> = {};
  if (typeof body.name === "string" && body.name.trim().length > 0) {
    updateData.name = body.name;
  }
  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  const [before] = await db
    .select()
    .from(entities)
    .where(eq(entities.id, id))
    .limit(1);
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [updated] = await db
    .update(entities)
    .set(updateData)
    .where(eq(entities.id, id))
    .returning();

  recordEntityAudit({
    action: "entity.set_kind",
    actorUserId: null,
    entityId: id,
    before: { name: before.name },
    after: { name: updated.name },
  });

  return NextResponse.json(updated);
}

/**
 * Hard delete is rejected unless the entity has no descendants (live or
 * archived), no memberships, and no FK-pointing rows in any of the
 * known tables. Spec RES-20260501-002 §"Deletion semantics".
 */
async function handleDelete(
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

  // Check descendants (any path starting with target.path, excluding self).
  const [{ count: descendantCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(entities)
    .where(
      and(
        sql`${entities.path} LIKE ${target.path + "%"}`,
        sql`${entities.id} <> ${id}`
      )
    );
  if (descendantCount > 0) {
    return NextResponse.json(
      { error: `entity has ${descendantCount} descendant(s); archive instead` },
      { status: 409 }
    );
  }

  // Check direct references that would block deletion.
  const checks: Array<{ table: string; promise: Promise<Array<{ count: number }>> }> = [
    {
      table: "memberships",
      promise: db
        .select({ count: sql<number>`count(*)::int` })
        .from(memberships)
        .where(eq(memberships.entityId, id)),
    },
    {
      table: "votings",
      promise: db
        .select({ count: sql<number>`count(*)::int` })
        .from(votings)
        .where(eq(votings.entityId, id)),
    },
    {
      table: "ballots",
      promise: db
        .select({ count: sql<number>`count(*)::int` })
        .from(ballots)
        .where(eq(ballots.entityId, id)),
    },
    {
      table: "mandates",
      promise: db
        .select({ count: sql<number>`count(*)::int` })
        .from(mandates)
        .where(eq(mandates.fromEntityId, id)),
    },
    {
      table: "posts",
      promise: db
        .select({ count: sql<number>`count(*)::int` })
        .from(posts)
        .where(eq(posts.entityId, id)),
    },
    {
      table: "documents",
      promise: db
        .select({ count: sql<number>`count(*)::int` })
        .from(documents)
        .where(eq(documents.entityId, id)),
    },
    {
      table: "community_posts",
      promise: db
        .select({ count: sql<number>`count(*)::int` })
        .from(communityPosts)
        .where(eq(communityPosts.entityId, id)),
    },
    {
      table: "board_members",
      promise: db
        .select({ count: sql<number>`count(*)::int` })
        .from(boardMembers)
        .where(eq(boardMembers.entityId, id)),
    },
    {
      table: "core_module_grants",
      promise: db
        .select({ count: sql<number>`count(*)::int` })
        .from(coreModuleGrants)
        .where(eq(coreModuleGrants.entityId, id)),
    },
  ];

  const blockers: string[] = [];
  for (const c of checks) {
    const [{ count }] = await c.promise;
    if (count > 0) blockers.push(`${c.table}: ${count}`);
  }
  if (blockers.length > 0) {
    return NextResponse.json(
      {
        error: "entity is referenced by other rows; archive instead",
        blockers,
      },
      { status: 409 }
    );
  }

  await db.delete(entities).where(eq(entities.id, id));
  recordEntityAudit({
    action: "entity.hard_delete",
    actorUserId: null,
    entityId: id,
    before: { name: target.name, kind: target.kind, path: target.path },
  });

  // Suppress unused warning while keeping the symbol import for future
  // null-safety helpers; remove when isNull starts being used.
  void isNull;

  return NextResponse.json({ success: true });
}

export const GET = withExternalAuth(handleGet, "full");
export const PATCH = withExternalAuth(handlePatch, "full");
export const DELETE = withExternalAuth(handleDelete, "full");
