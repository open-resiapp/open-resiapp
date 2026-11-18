import "server-only";

import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import { db } from "@/db";
import {
  communityPosts,
  communityResponses,
  documentLinks,
  documents,
  entities,
  eventRsvps,
  memberships,
  posts,
  users,
} from "@/db/schema";
import { canSeeDocPath } from "@/lib/documents";
import { loadUserMemberships } from "@/lib/documents.server";
import {
  FEED_PAGE_SIZE,
  FILTER_COMMUNITY_TYPES,
  communityKey,
  noticeKey,
  type CommunityPostType,
  type FeedAttachment,
  type FeedCommunityPost,
  type FeedFilter,
  type FeedItem,
  type FeedNotice,
  type FeedRsvp,
  type RsvpStatus,
} from "@/lib/feed";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

// Merged feed (BYT-20261117-002 Phase 5). Read-only queries over the two
// existing post tables; visibility rules are copied 1:1 from
// GET /api/posts and GET /api/community/posts (RES-20260501-002):
//   - notices: admin sees all; others need an active membership on an
//     entity overlapping the post's entity along the materialized path.
//   - community: needs `viewCommunity`; admin sees all; others get the same
//     overlap rule unless the community root enables cross-entrance
//     visibility; only active, non-expired posts are listed.
// No caching, no module state (multi-replica safe).

export interface FeedViewer {
  id: string;
  role: UserRole;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function overlapsViewer(userId: string, entityCol: SQLWrapper): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM ${memberships} m
    JOIN ${entities} me ON me.id = m.entity_id
    JOIN ${entities} pe ON pe.id = ${entityCol}
    WHERE m.user_id = ${userId}
      AND m.status = 'active'
      AND (pe.path LIKE me.path || '%' OR me.path LIKE pe.path || '%')
  )`;
}

function noticeVisibility(viewer: FeedViewer): SQL | undefined {
  return viewer.role === "admin" ? undefined : overlapsViewer(viewer.id, posts.entityId);
}

/** Community visibility; `null` = viewer may not see community posts at all. */
async function communityVisibility(viewer: FeedViewer): Promise<SQL | undefined | null> {
  if (!hasPermission(viewer.role, "viewCommunity")) return null;
  if (viewer.role === "admin") return undefined;
  const root = await getCommunityRoot();
  if (root?.communityCrossEntranceVisible) return undefined;
  return overlapsViewer(viewer.id, communityPosts.entityId);
}

function activeCommunity(now: Date): SQL {
  return and(
    eq(communityPosts.status, "active"),
    or(isNull(communityPosts.expiresAt), gt(communityPosts.expiresAt, now))
  ) as SQL;
}

// ── Row loaders ──

const noticeEntrance = aliasedTable(entities, "notice_entrance");
const communityEntrance = aliasedTable(entities, "community_entrance");

function selectNotices() {
  return db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      category: posts.category,
      isPinned: posts.isPinned,
      createdAt: posts.createdAt,
      entranceName: noticeEntrance.name,
      authorId: users.id,
      authorName: users.name,
    })
    .from(posts)
    .leftJoin(users, eq(posts.authorId, users.id))
    .leftJoin(noticeEntrance, eq(noticeEntrance.id, posts.entityId));
}

function selectCommunity() {
  return db
    .select({
      id: communityPosts.id,
      type: communityPosts.type,
      status: communityPosts.status,
      title: communityPosts.title,
      content: communityPosts.content,
      photoUrl: communityPosts.photoUrl,
      responsesAllowed: communityPosts.responsesAllowed,
      eventDate: communityPosts.eventDate,
      eventLocation: communityPosts.eventLocation,
      eventKind: communityPosts.eventKind,
      expiresAt: communityPosts.expiresAt,
      createdAt: communityPosts.createdAt,
      entranceName: communityEntrance.name,
      authorId: users.id,
      authorName: users.name,
    })
    .from(communityPosts)
    .leftJoin(users, eq(communityPosts.authorId, users.id))
    .leftJoin(communityEntrance, eq(communityEntrance.id, communityPosts.entityId));
}

type NoticeRow = Awaited<ReturnType<typeof selectNotices>>[number];
type CommunityRow = Awaited<ReturnType<typeof selectCommunity>>[number];

function toNotice(r: NoticeRow): FeedNotice {
  return {
    kind: "notice",
    key: noticeKey(r.id),
    id: r.id,
    title: r.title,
    content: r.content,
    category: r.category,
    isPinned: r.isPinned,
    createdAt: r.createdAt.toISOString(),
    entranceName: r.entranceName,
    author: r.authorId ? { id: r.authorId, name: r.authorName ?? "" } : null,
    attachments: [],
  };
}

function toCommunity(r: CommunityRow): FeedCommunityPost {
  return {
    kind: "community",
    key: communityKey(r.id),
    id: r.id,
    type: r.type,
    status: r.status,
    title: r.title,
    content: r.content,
    photoUrl: r.photoUrl,
    eventDate: iso(r.eventDate),
    eventLocation: r.eventLocation,
    eventKind: r.eventKind,
    entranceName: r.entranceName,
    expiresAt: iso(r.expiresAt),
    createdAt: r.createdAt.toISOString(),
    author: r.authorId ? { id: r.authorId, name: r.authorName ?? "" } : null,
    responsesAllowed: r.responsesAllowed,
    responseCount: 0,
    rsvp: null,
    attachments: [],
  };
}

// ── Enrichment: response counts, RSVPs, attachments — one query each ──

async function enrich(viewer: FeedViewer, items: FeedItem[]): Promise<void> {
  const community = items.filter((i): i is FeedCommunityPost => i.kind === "community");
  const notices = items.filter((i): i is FeedNotice => i.kind === "notice");
  const communityIds = community.map((c) => c.id);
  const eventIds = community.filter((c) => c.type === "event").map((c) => c.id);
  const noticeIds = notices.map((n) => n.id);

  const [responseRows, rsvpRows, attachmentRows, mems] = await Promise.all([
    communityIds.length
      ? db
          .select({
            postId: communityResponses.postId,
            count: sql<number>`count(*)::int`,
          })
          .from(communityResponses)
          .where(inArray(communityResponses.postId, communityIds))
          .groupBy(communityResponses.postId)
      : Promise.resolve([]),
    eventIds.length
      ? db
          .select({
            postId: eventRsvps.postId,
            status: eventRsvps.status,
            count: sql<number>`count(*)::int`,
            mine: sql<boolean>`bool_or(${eventRsvps.userId} = ${viewer.id})`,
          })
          .from(eventRsvps)
          .where(inArray(eventRsvps.postId, eventIds))
          .groupBy(eventRsvps.postId, eventRsvps.status)
      : Promise.resolve([]),
    noticeIds.length || communityIds.length
      ? db
          .select({
            targetType: documentLinks.targetType,
            targetId: documentLinks.targetId,
            id: documents.id,
            name: documents.name,
            audience: documents.audience,
            subjectUserId: documents.subjectUserId,
            path: entities.path,
          })
          .from(documentLinks)
          .innerJoin(documents, eq(documentLinks.documentId, documents.id))
          .innerJoin(entities, eq(documents.entityId, entities.id))
          .where(
            and(
              isNull(documents.deletedAt),
              or(
                noticeIds.length
                  ? and(
                      eq(documentLinks.targetType, "board_post"),
                      inArray(documentLinks.targetId, noticeIds)
                    )
                  : undefined,
                communityIds.length
                  ? and(
                      eq(documentLinks.targetType, "community_post"),
                      inArray(documentLinks.targetId, communityIds)
                    )
                  : undefined
              )
            )
          )
          .orderBy(desc(documentLinks.createdAt))
      : Promise.resolve([]),
    noticeIds.length || communityIds.length
      ? loadUserMemberships(viewer.id)
      : Promise.resolve([]),
  ]);

  const responseCount = new Map(responseRows.map((r) => [r.postId, r.count]));
  const rsvp = new Map<string, FeedRsvp>();
  for (const id of eventIds) rsvp.set(id, { yes: 0, maybe: 0, no: 0, myRsvp: null });
  for (const r of rsvpRows) {
    const b = rsvp.get(r.postId);
    if (!b) continue;
    b[r.status as RsvpStatus] = r.count;
    if (r.mine) b.myRsvp = r.status as RsvpStatus;
  }

  // Same per-document filter as listTargetDocuments (GET /api/document-links).
  const attachments = new Map<string, FeedAttachment[]>();
  for (const r of attachmentRows) {
    if (
      !canSeeDocPath(mems, r.path, r.audience, {
        viewerId: viewer.id,
        subjectUserId: r.subjectUserId,
      })
    ) {
      continue;
    }
    const key = r.targetType === "board_post" ? noticeKey(r.targetId) : communityKey(r.targetId);
    const list = attachments.get(key) ?? [];
    list.push({ id: r.id, name: r.name });
    attachments.set(key, list);
  }

  for (const item of items) {
    item.attachments = attachments.get(item.key) ?? [];
    if (item.kind === "community") {
      item.responseCount = responseCount.get(item.id) ?? 0;
      item.rsvp = item.type === "event" ? rsvp.get(item.id) ?? null : null;
    }
  }
}

// ── Public API ──

export interface FeedPage {
  /** Item linked from a notification (`?prispevok=`), rendered above the list. */
  focused: FeedItem | null;
  items: FeedItem[];
  hasMore: boolean;
  /** Which filter chips have at least one visible item (only computed where needed). */
  nonEmpty: Partial<Record<Exclude<FeedFilter, "all">, boolean>>;
}

export interface LoadFeedOptions {
  filter: FeedFilter;
  /** 1-based; the page shows `page * FEED_PAGE_SIZE` items ("Zobraziť staršie"). */
  page: number;
  focus: { kind: "notice" | "community"; id: string } | null;
  /** Chips whose visibility depends on content (viewer may not create that type). */
  countFilters: Exclude<FeedFilter, "all">[];
}

export async function loadFeed(viewer: FeedViewer, opts: LoadFeedOptions): Promise<FeedPage> {
  const now = new Date();
  const limit = opts.page * FEED_PAGE_SIZE;
  const communityTypes = FILTER_COMMUNITY_TYPES[opts.filter];
  const wantNotices = opts.filter === "all" || opts.filter === "oznamy";

  const communityWhere = await communityVisibility(viewer);
  const canSeeCommunity = communityWhere !== null;
  const noticeWhere = noticeVisibility(viewer);

  const noticesQ = wantNotices
    ? selectNotices()
        .where(noticeWhere)
        .orderBy(desc(posts.isPinned), desc(posts.createdAt))
        .limit(limit + 1)
    : Promise.resolve([] as NoticeRow[]);

  const communityQ =
    canSeeCommunity && communityTypes
      ? selectCommunity()
          .where(
            and(
              communityWhere ?? undefined,
              activeCommunity(now),
              inArray(communityPosts.type, communityTypes)
            )
          )
          .orderBy(
            ...(opts.filter === "udalosti"
              ? // Upcoming soonest first, then past events newest first.
                [
                  sql`(${communityPosts.eventDate} < ${now}) asc`,
                  sql`case when ${communityPosts.eventDate} >= ${now} then ${communityPosts.eventDate} end asc`,
                  desc(communityPosts.eventDate),
                ]
              : [desc(communityPosts.createdAt)])
          )
          .limit(limit + 1)
      : Promise.resolve([] as CommunityRow[]);

  const focusQ: Promise<FeedItem | null> = opts.focus
    ? opts.focus.kind === "notice"
      ? selectNotices()
          .where(and(eq(posts.id, opts.focus.id), noticeWhere))
          .limit(1)
          .then((r) => (r[0] ? toNotice(r[0]) : null))
      : canSeeCommunity
        ? // Direct link: show it even when resolved/expired (visibility still applies).
          selectCommunity()
            .where(and(eq(communityPosts.id, opts.focus.id), communityWhere ?? undefined))
            .limit(1)
            .then((r) => (r[0] ? toCommunity(r[0]) : null))
        : Promise.resolve(null)
    : Promise.resolve(null);

  const [noticeRows, communityRows, focused, nonEmpty] = await Promise.all([
    noticesQ,
    communityQ,
    focusQ,
    countNonEmpty(opts.countFilters, noticeWhere, canSeeCommunity ? communityWhere : null, now),
  ]);

  const notices = noticeRows.map(toNotice);
  const community = communityRows.map(toCommunity);
  const pinned = notices.filter((n) => n.isPinned);
  const rest: FeedItem[] =
    opts.filter === "udalosti"
      ? community
      : [...notices.filter((n) => !n.isPinned), ...community].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt)
        );
  const merged = [...pinned, ...rest].filter((i) => i.key !== focused?.key);
  const hasMore = noticeRows.length > limit || communityRows.length > limit;
  const items = merged.slice(0, limit);

  await enrich(viewer, focused ? [focused, ...items] : items);
  return { focused, items, hasMore, nonEmpty };
}

async function countNonEmpty(
  filters: Exclude<FeedFilter, "all">[],
  noticeWhere: SQL | undefined,
  communityWhere: SQL | undefined | null,
  now: Date
): Promise<FeedPage["nonEmpty"]> {
  const out: FeedPage["nonEmpty"] = {};
  if (filters.length === 0) return out;

  const wantsNotices = filters.includes("oznamy");
  const communityFilters = filters.filter((f) => f !== "oznamy");

  const [noticeRow, typeRows] = await Promise.all([
    wantsNotices
      ? db.select({ id: posts.id }).from(posts).where(noticeWhere).limit(1)
      : Promise.resolve([]),
    communityFilters.length && communityWhere !== null
      ? db
          .selectDistinct({ type: communityPosts.type })
          .from(communityPosts)
          .where(and(communityWhere ?? undefined, activeCommunity(now)))
      : Promise.resolve([] as { type: CommunityPostType }[]),
  ]);

  if (wantsNotices) out.oznamy = noticeRow.length > 0;
  const present = new Set(typeRows.map((r) => r.type));
  for (const f of communityFilters) {
    out[f] = (FILTER_COMMUNITY_TYPES[f] ?? []).some((t) => present.has(t));
  }
  return out;
}

/** Entrances of the building (for the notice scope picker). */
export async function listEntrances(): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .where(and(eq(entities.kind, "entrance"), isNull(entities.archivedAt)))
    .orderBy(asc(entities.name));
}
