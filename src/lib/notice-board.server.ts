import "server-only";

import { aliasedTable, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { entities, memberships, posts, users } from "@/db/schema";
import type { PostCategory } from "@/types";

// Notice board (nástenka) read model for server components. Same query and
// visibility rule as GET /api/posts (RES-20260501-002): a post is visible
// iff the viewer holds an active membership at an entity overlapping the
// post's entity along the materialized path; admin bypasses the filter.
// Pinned first, newest first. Read-only.

export interface NoticeRow {
  id: string;
  title: string;
  content: string;
  category: PostCategory;
  isPinned: boolean;
  /** ISO timestamp. */
  createdAt: string;
  entranceName: string | null;
  authorName: string | null;
}

export async function listVisibleNotices(input: {
  userId: string;
  isAdmin: boolean;
  /** Omit for the full list. */
  limit?: number;
}): Promise<NoticeRow[]> {
  const entrance = aliasedTable(entities, "entrance");
  const base = db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      category: posts.category,
      isPinned: posts.isPinned,
      createdAt: posts.createdAt,
      entranceName: entrance.name,
      authorName: users.name,
    })
    .from(posts)
    .leftJoin(users, eq(posts.authorId, users.id))
    .leftJoin(entrance, eq(entrance.id, posts.entityId))
    .$dynamic();

  const filtered = input.isAdmin
    ? base
    : base.where(
        sql`EXISTS (
          SELECT 1
          FROM ${memberships} m
          JOIN ${entities} me ON me.id = m.entity_id
          JOIN ${entities} pe ON pe.id = ${posts.entityId}
          WHERE m.user_id = ${input.userId}
            AND m.status = 'active'
            AND (pe.path LIKE me.path || '%' OR me.path LIKE pe.path || '%')
        )`
      );

  const ordered = filtered.orderBy(desc(posts.isPinned), desc(posts.createdAt));
  const rows = await (input.limit ? ordered.limit(input.limit) : ordered);

  return rows.map((r) => ({
    ...r,
    category: r.category as PostCategory,
    createdAt: r.createdAt.toISOString(),
  }));
}
