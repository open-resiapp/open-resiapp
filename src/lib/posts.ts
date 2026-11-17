import "server-only";

import { aliasedTable, and, desc, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships, posts, users } from "@/db/schema";
import { sendPushToAll } from "@/lib/push";
import { dispatchHook } from "@/lib/modules/dispatch";
import { linkDocumentToTarget } from "@/lib/documents.server";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { assertBoard } from "@/lib/mcp/authz";
import { McpError, validationError } from "@/lib/mcp/errors";
import type { Principal, Viewer } from "@/lib/mcp/principal";

// Board posts (oznamy) — shared by GET/POST /api/posts and the MCP
// announcement tools (BYT-20261117-001 §3). One code path for visibility and
// for create side effects (document links, push, onPostCreate hook).

/**
 * Visibility rule (RES-20260501-002): post P is visible iff the viewer holds
 * an active membership at an entity that overlaps P's entity along the
 * materialized path (ancestor / equal / descendant). Admin bypasses it.
 */
function visibleToViewer(viewer: Viewer): SQL | undefined {
  if (viewer.role === "admin") return undefined;
  return sql`EXISTS (
    SELECT 1
    FROM ${memberships} m
    JOIN ${entities} me ON me.id = m.entity_id
    JOIN ${entities} pe ON pe.id = ${posts.entityId}
    WHERE m.user_id = ${viewer.userId}
      AND m.status = 'active'
      AND (pe.path LIKE me.path || '%' OR me.path LIKE pe.path || '%')
  )`;
}

function postSelect() {
  const entrance = aliasedTable(entities, "entrance");
  return {
    entrance,
    query: db
      .select({
        id: posts.id,
        title: posts.title,
        content: posts.content,
        category: posts.category,
        isPinned: posts.isPinned,
        createdAt: posts.createdAt,
        updatedAt: posts.updatedAt,
        entityId: posts.entityId,
        entranceName: entrance.name,
        author: {
          id: users.id,
          name: users.name,
        },
      })
      .from(posts)
      .leftJoin(users, eq(posts.authorId, users.id))
      .leftJoin(entrance, eq(entrance.id, posts.entityId)),
  };
}

export type VisiblePost = Awaited<ReturnType<typeof listVisiblePosts>>[number];

/** Every post the viewer may see, pinned first, newest first. */
export async function listVisiblePosts(viewer: Viewer) {
  const { query } = postSelect();
  const filter = visibleToViewer(viewer);
  const q = filter ? query.where(filter) : query;
  return q.orderBy(desc(posts.isPinned), desc(posts.createdAt));
}

/**
 * One post by id, WITH the visibility check. Invisible and missing posts are
 * indistinguishable (both null) so ids can't be probed.
 */
export async function getVisiblePost(
  viewer: Viewer,
  postId: string
): Promise<VisiblePost | null> {
  const { query } = postSelect();
  const filter = visibleToViewer(viewer);
  const [row] = await query
    .where(filter ? and(eq(posts.id, postId), filter) : eq(posts.id, postId))
    .limit(1);
  return row ?? null;
}

/**
 * The sub-entity (entrance …) a post may be scoped to: a live entity of the
 * community `rootId` (or the root itself). Null when foreign / archived /
 * missing — used to validate an AI-proposed `entranceId` before confirm.
 */
export async function getPostScopeEntity(
  rootId: string,
  entityId: string
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: entities.id, name: entities.name, rootId: entities.rootId, archivedAt: entities.archivedAt })
    .from(entities)
    .where(eq(entities.id, entityId))
    .limit(1);
  if (!row || row.archivedAt) return null;
  if (row.id !== rootId && row.rootId !== rootId) return null;
  return { id: row.id, name: row.name };
}

export interface CreatePostInput {
  title: string;
  content: string;
  category?: string | null;
  /** Entrance (or other sub-entity) scope; null/empty = community-wide. */
  entranceId?: string | null;
  isPinned?: boolean;
  documentIds?: string[];
}

/**
 * Creates a post as `principal`. Authz: board (admin / active chairman) or
 * caretaker (spec Notes → Decided 1). Side effects identical for UI and MCP:
 * document links, push to all, `onPostCreate` hook.
 *
 * Throws McpError: forbidden, validation.title, validation.content,
 * community_missing.
 */
export async function createPost(principal: Principal, input: CreatePostInput) {
  assertBoard(principal, { allowCaretaker: true });

  if (!input.title) throw validationError("title");
  if (!input.content) throw validationError("content");

  // Phase 9.1d: NULL entranceId means building-wide → resolve via the root
  // entity (single-tenant assumption).
  let postEntityId: string | null = input.entranceId || null;
  if (postEntityId === null) {
    const root = await getCommunityRoot();
    postEntityId = root?.id ?? null;
  }
  if (!postEntityId) throw new McpError("community_missing");

  const [post] = await db
    .insert(posts)
    .values({
      title: input.title,
      content: input.content,
      category: (input.category || "info") as typeof posts.$inferInsert.category,
      authorId: principal.userId,
      entityId: postEntityId,
      isPinned: input.isPinned || false,
    })
    .returning();

  for (const docId of input.documentIds ?? []) {
    await linkDocumentToTarget(String(docId), "board_post", post.id);
  }

  sendPushToAll(
    { title: "Nový príspevok", body: input.title, url: "/board" },
    "newPost"
  ).catch(() => {});

  dispatchHook("onPostCreate", {
    id: post.id,
    communityId: post.entityId ?? "",
    authorId: post.authorId,
    type: post.category,
    title: post.title,
    body: post.content,
    createdAt: post.createdAt,
  }).catch((err) => console.error("[modules] onPostCreate failed:", err));

  return post;
}
