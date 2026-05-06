import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  posts,
  users,
  entities,
  memberships,
} from "@/db/schema";
import { aliasedTable, desc, eq, sql } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { sendPushToAll } from "@/lib/push";
import { dispatchHook } from "@/lib/modules/dispatch";
import { getCommunityRoot } from "@/lib/legacy-compat";
import type { UserRole } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const role = session.user.role as UserRole;
  const userId = session.user.id;
  const isAdmin = role === "admin";

  // Visibility rule (RES-20260501-002): post P is visible iff the
  // viewer holds an active membership at an entity that overlaps P's
  // entity along the materialized path (ancestor / equal / descendant).
  // Admin bypasses the filter.
  const entrance = aliasedTable(entities, "entrance");
  const baseQuery = db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      category: posts.category,
      isPinned: posts.isPinned,
      createdAt: posts.createdAt,
      updatedAt: posts.updatedAt,
      entranceId: posts.entranceId,
      entityId: posts.entityId,
      entranceName: entrance.name,
      author: {
        id: users.id,
        name: users.name,
      },
    })
    .from(posts)
    .leftJoin(users, eq(posts.authorId, users.id))
    .leftJoin(entrance, eq(entrance.id, posts.entranceId));

  const result = isAdmin
    ? await baseQuery.orderBy(desc(posts.isPinned), desc(posts.createdAt))
    : await baseQuery
        .where(
          sql`EXISTS (
            SELECT 1
            FROM ${memberships} m
            JOIN ${entities} me ON me.id = m.entity_id
            JOIN ${entities} pe ON pe.id = ${posts.entityId}
            WHERE m.user_id = ${userId}
              AND m.status = 'active'
              AND (pe.path LIKE me.path || '%' OR me.path LIKE pe.path || '%')
          )`
        )
        .orderBy(desc(posts.isPinned), desc(posts.createdAt));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "createPost")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json();
  const { title, content, category, entranceId, isPinned } = body;

  if (!title || !content) {
    return NextResponse.json(
      { error: "Nadpis a obsah sú povinné" },
      { status: 400 }
    );
  }

  // Phase 9.1d: NULL entranceId means building-wide → resolve via the
  // root entity (single-tenant assumption).
  let postEntityId: string | null = entranceId || null;
  if (postEntityId === null) {
    const root = await getCommunityRoot();
    postEntityId = root?.id ?? null;
  }

  const [post] = await db
    .insert(posts)
    .values({
      title,
      content,
      category: category || "info",
      authorId: session.user.id,
      entranceId: entranceId || null,
      entityId: postEntityId,
      isPinned: isPinned || false,
    })
    .returning();

  sendPushToAll(
    { title: "Nový príspevok", body: title, url: "/board" },
    "newPost"
  ).catch(() => {});

  dispatchHook("onPostCreate", {
    id: post.id,
    communityId: post.entranceId ?? "",
    authorId: post.authorId,
    type: post.category,
    title: post.title,
    body: post.content,
    createdAt: post.createdAt,
  }).catch((err) => console.error("[modules] onPostCreate failed:", err));

  return NextResponse.json(post, { status: 201 });
}
