import "server-only";

import { aliasedTable, and, desc, eq, inArray, isNotNull, ne, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  communityNotificationsSent,
  entities,
  memberships,
  notificationPreferences,
  posts,
  pushSubscriptions,
  users,
} from "@/db/schema";
import { isConfigured as isPushConfigured, sendPushToAll } from "@/lib/push";
import { isSmtpConfigured, sendBoardPostNotice } from "@/lib/email";
import { routing } from "@/i18n/routing";
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

/**
 * Latest posts the viewer may see for the printed notice board (/nastenka
 * print view): pinned first, newest first, capped at `limit`.
 */
export async function listPostsForPrint(viewer: Viewer, limit = 15) {
  const { query } = postSelect();
  const filter = visibleToViewer(viewer);
  const q = filter ? query.where(filter) : query;
  return q.orderBy(desc(posts.isPinned), desc(posts.createdAt)).limit(limit);
}

/**
 * Of `userIds`, those who receive push (≥ 1 subscription and push is
 * configured). Everyone else needs the e-mail fallback. Shared by the board
 * post and the voting announcement fallbacks.
 */
export async function pushSubscriberIds(userIds: string[]): Promise<Set<string>> {
  if (!isPushConfigured() || userIds.length === 0) return new Set();
  const subs = await db
    .selectDistinct({ userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));
  return new Set(subs.map((r) => r.userId));
}

/**
 * Owners who get no push (no subscription, or push not configured) receive the
 * post by e-mail instead — otherwise owners without a smartphone never learn
 * of the notice. Respects the per-user `newPost` preference (default on).
 * Dedupe: one row per (board post, recipient) in community_notifications_sent
 * (kind post_notice), claimed with ON CONFLICT DO NOTHING so replicas / retries
 * never double-send; the claim is released when the send fails.
 * Returns counts so callers can log / surface them.
 */
export async function sendPostEmailFallback(post: {
  id: string;
  title: string;
  content: string;
  entityId: string | null;
  authorId: string | null;
}): Promise<{ sent: number; failed: number; skippedNoSmtp: boolean }> {
  if (!post.entityId) return { sent: 0, failed: 0, skippedNoSmtp: false };
  if (!isSmtpConfigured()) return { sent: 0, failed: 0, skippedNoSmtp: true };

  const pe = aliasedTable(entities, "pe");
  const me = aliasedTable(entities, "me");
  const candidates = await db
    .selectDistinct({ id: users.id, name: users.name, email: users.email })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .innerJoin(me, eq(me.id, memberships.entityId))
    .innerJoin(pe, eq(pe.id, post.entityId))
    .leftJoin(
      notificationPreferences,
      eq(notificationPreferences.userId, users.id)
    )
    .where(
      and(
        eq(memberships.status, "active"),
        eq(users.isActive, true),
        eq(users.status, "active"),
        // Paper-only owners get printed letters from the board, not e-mail.
        eq(users.paperOnly, false),
        isNotNull(users.email),
        post.authorId ? ne(users.id, post.authorId) : undefined,
        sql`(${notificationPreferences.newPost} IS NULL OR ${notificationPreferences.newPost} = true)`,
        sql`(${pe.path} LIKE ${me.path} || '%' OR ${me.path} LIKE ${pe.path} || '%')`
      )
    );
  if (candidates.length === 0) return { sent: 0, failed: 0, skippedNoSmtp: false };

  // Users with at least one push subscription get push, not e-mail.
  const pushUsers = await pushSubscriberIds(candidates.map((c) => c.id));

  const [anchor] = await db
    .select({ rootId: entities.rootId })
    .from(entities)
    .where(eq(entities.id, post.entityId))
    .limit(1);
  const [root] = anchor
    ? await db
        .select({ name: entities.name })
        .from(entities)
        .where(eq(entities.id, anchor.rootId))
        .limit(1)
    : [];
  const base = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");

  let sent = 0;
  let failed = 0;
  for (const c of candidates) {
    if (!c.email || pushUsers.has(c.id)) continue;
    const [claim] = await db
      .insert(communityNotificationsSent)
      .values({ boardPostId: post.id, recipientId: c.id, kind: "post_notice" })
      .onConflictDoNothing()
      .returning({ id: communityNotificationsSent.id });
    if (!claim) continue; // already sent (other replica / earlier run)

    // TODO(decision): users have no stored locale — instance default language.
    const status = await sendBoardPostNotice({
      recipientEmail: c.email,
      recipientName: c.name,
      postTitle: post.title,
      postContent: post.content,
      postUrl: `${base}/${routing.defaultLocale}/board`,
      buildingName: root?.name ?? null,
      locale: routing.defaultLocale,
    });
    if (status === "sent") {
      sent += 1;
    } else {
      failed += 1;
      await db
        .delete(communityNotificationsSent)
        .where(eq(communityNotificationsSent.id, claim.id));
    }
  }
  return { sent, failed, skippedNoSmtp: false };
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

  // Owners without push (no smartphone / not subscribed) get an e-mail.
  sendPostEmailFallback(post).catch((err) =>
    console.error("[posts] e-mail fallback failed:", err)
  );

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
