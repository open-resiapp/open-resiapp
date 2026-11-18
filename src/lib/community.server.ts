import "server-only";

import { aliasedTable, and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  communityPostTypeEnum,
  communityPosts,
  communityResponses,
  directoryEntries,
  entities,
  eventRsvps,
  memberships,
  users,
} from "@/db/schema";
import { deleteLinksForTarget, linkDocumentToTarget } from "@/lib/documents.server";
import { getVisibleCommunityPost } from "@/lib/feed.server";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { McpError, validationError } from "@/lib/mcp/errors";
import { dispatchHook } from "@/lib/modules/dispatch";
import { hasPermission } from "@/lib/permissions";
import { getPostScopeEntity } from "@/lib/posts";
import type { UserRole } from "@/types";

// Community (komunita) writes + reads shared by the web routes under
// /api/community/* and the MCP community tools (BYT-20261118-012). One code
// path: permission checks, validation and side effects (document links,
// onPostCreate hook) live here, the routes only translate errors.
//
// Errors are McpError codes (`forbidden`, `not_found`, `validation.<field>`,
// `conflict.state_changed`); routes answer `{ error: code }` with
// `mcpErrorStatus(code)`.
//
// Reads with visibility (list / single post) live in src/lib/feed.server.ts
// (loadFeed / getVisibleCommunityPost) — the board feed's rule.

export interface CommunityActor {
  userId: string;
  role: UserRole;
}

/** Days a community post stays listed (expiresAt). */
export const COMMUNITY_POST_TTL_DAYS = 30;

export type CommunityPostType = (typeof communityPostTypeEnum.enumValues)[number];
export type RsvpStatus = "yes" | "maybe" | "no";

export interface CommunityPostRow {
  id: string;
  type: CommunityPostType;
  status: "active" | "resolved" | "expired";
  title: string;
  authorId: string;
  eventKind: "social" | "owners_meeting";
  eventDate: Date | null;
  eventLocation: string | null;
  responsesAllowed: boolean;
  entityId: string;
  expiresAt: Date | null;
}

/** Raw post row WITHOUT a visibility check — callers decide access. */
export async function loadCommunityPostRow(id: string): Promise<CommunityPostRow | null> {
  const [row] = await db
    .select({
      id: communityPosts.id,
      type: communityPosts.type,
      status: communityPosts.status,
      title: communityPosts.title,
      authorId: communityPosts.authorId,
      eventKind: communityPosts.eventKind,
      eventDate: communityPosts.eventDate,
      eventLocation: communityPosts.eventLocation,
      responsesAllowed: communityPosts.responsesAllowed,
      entityId: communityPosts.entityId,
      expiresAt: communityPosts.expiresAt,
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * May the actor see this post? The board feed's rule (viewCommunity +
 * entrance overlap unless cross-entrance visibility; admin all) via
 * getVisibleCommunityPost. Used before any read or answer by post id.
 */
export async function canSeeCommunityPost(actor: CommunityActor, postId: string): Promise<boolean> {
  return (await getVisibleCommunityPost({ id: actor.userId, role: actor.role }, postId)) !== null;
}

/** Author or operator admin may resolve / toggle / delete a post (web rule). */
export function canManageCommunityPost(
  actor: CommunityActor,
  post: Pick<CommunityPostRow, "authorId">
): boolean {
  return actor.role === "admin" || post.authorId === actor.userId;
}

// ── Create ───────────────────────────────────────────────────────────────

export interface CreateCommunityPostInput {
  type: string;
  title: string;
  content: string;
  photoUrl?: string | null;
  /** ISO string or Date; events only. */
  eventDate?: string | Date | null;
  eventLocation?: string | null;
  /** Entrance / sub-entity scope; empty = whole community. */
  entranceId?: string | null;
  /** Default true; false only when the author opts out. */
  responsesAllowed?: boolean;
  documentIds?: string[];
}

export interface NormalizedCommunityPost {
  type: CommunityPostType;
  title: string;
  content: string;
  photoUrl: string | null;
  eventDate: Date | null;
  eventLocation: string | null;
  /** Resolved scope entity (root when community-wide). */
  entityId: string;
  responsesAllowed: boolean;
}

function isPostType(t: string): t is CommunityPostType {
  return (communityPostTypeEnum.enumValues as readonly string[]).includes(t);
}

/**
 * Validates a new community post without writing anything (MCP propose
 * runs it, the route runs it through createCommunityPost).
 */
export async function validateCommunityPostInput(
  actor: CommunityActor,
  input: CreateCommunityPostInput
): Promise<NormalizedCommunityPost> {
  if (!hasPermission(actor.role, "createCommunityPost")) throw new McpError("forbidden");
  const type = typeof input.type === "string" ? input.type : "";
  if (!isPostType(type)) throw validationError("type");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const content = typeof input.content === "string" ? input.content.trim() : "";
  if (!title || title.length > 255) throw validationError("title");
  if (!content) throw validationError("content");

  const isEvent = type === "event";
  const location = typeof input.eventLocation === "string" ? input.eventLocation.trim() : "";
  let eventDate: Date | null = null;
  if (isEvent) {
    if (!input.eventDate) throw validationError("eventDate");
    eventDate = input.eventDate instanceof Date ? input.eventDate : new Date(input.eventDate);
    if (Number.isNaN(eventDate.getTime())) throw validationError("eventDate");
    if (!location || location.length > 255) throw validationError("eventLocation");
  } else if (input.eventDate || location) {
    throw validationError("eventDate", { reason: "events_only" });
  }

  const root = await getCommunityRoot();
  if (!root) throw new McpError("community_missing");
  let entityId = root.id;
  if (input.entranceId) {
    const scope = await getPostScopeEntity(root.id, input.entranceId);
    if (!scope) throw validationError("entranceId");
    entityId = scope.id;
  }

  return {
    type,
    title,
    content,
    photoUrl: input.photoUrl || null,
    eventDate,
    eventLocation: isEvent ? location : null,
    entityId,
    responsesAllowed: input.responsesAllowed !== false,
  };
}

export async function createCommunityPost(
  actor: CommunityActor,
  input: CreateCommunityPostInput
) {
  const p = await validateCommunityPostInput(actor, input);
  const expiresAt = new Date(Date.now() + COMMUNITY_POST_TTL_DAYS * 24 * 60 * 60 * 1000);

  const [post] = await db
    .insert(communityPosts)
    .values({
      type: p.type,
      title: p.title,
      content: p.content,
      photoUrl: p.photoUrl,
      authorId: actor.userId,
      eventDate: p.eventDate,
      eventLocation: p.eventLocation,
      // The community API never creates owners' meeting posts (voting module only).
      eventKind: "social",
      entityId: p.entityId,
      responsesAllowed: p.responsesAllowed,
      expiresAt,
    })
    .returning();

  for (const docId of input.documentIds ?? []) {
    await linkDocumentToTarget(String(docId), "community_post", post.id);
  }

  dispatchHook("onPostCreate", {
    id: post.id,
    communityId: post.entityId ?? "",
    authorId: post.authorId,
    type: post.type,
    title: post.title,
    body: post.content,
    createdAt: post.createdAt,
  }).catch((err) => console.error("[modules] onPostCreate failed:", err));

  return post;
}

// ── Update / delete (author or admin) ────────────────────────────────────

export interface UpdateCommunityPostInput {
  /** Only the transition to "resolved" is allowed. */
  status?: unknown;
  responsesAllowed?: unknown;
}

export async function updateCommunityPost(
  actor: CommunityActor,
  postId: string,
  input: UpdateCommunityPostInput
) {
  const post = await loadCommunityPostRow(postId);
  if (!post) throw new McpError("not_found");
  if (!canManageCommunityPost(actor, post)) throw new McpError("forbidden");

  const updates: Partial<typeof communityPosts.$inferInsert> = {};
  if (input.status !== undefined) {
    if (input.status !== "resolved") throw validationError("status");
    updates.status = "resolved";
  }
  if (input.responsesAllowed !== undefined) {
    if (typeof input.responsesAllowed !== "boolean") throw validationError("responsesAllowed");
    updates.responsesAllowed = input.responsesAllowed;
  }
  if (Object.keys(updates).length === 0) throw validationError("input");

  const [updated] = await db
    .update(communityPosts)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(communityPosts.id, postId))
    .returning();
  return updated;
}

/** Hard delete (responses + RSVPs cascade; document links removed). */
export async function deleteCommunityPost(actor: CommunityActor, postId: string): Promise<void> {
  const post = await loadCommunityPostRow(postId);
  if (!post) throw new McpError("not_found");
  if (!canManageCommunityPost(actor, post)) throw new McpError("forbidden");
  await db.delete(communityPosts).where(eq(communityPosts.id, postId));
  await deleteLinksForTarget("community_post", postId);
}

// ── Responses (read) ─────────────────────────────────────────────────────

export interface CommunityResponseItem {
  id: string;
  content: string;
  createdAt: Date;
  author: { id: string; name: string } | null;
}

/** Responses of a post, oldest first. Caller must have checked post visibility. */
export async function listCommunityResponses(postId: string): Promise<CommunityResponseItem[]> {
  const rows = await db
    .select({
      id: communityResponses.id,
      content: communityResponses.content,
      createdAt: communityResponses.createdAt,
      authorId: users.id,
      authorName: users.name,
    })
    .from(communityResponses)
    .leftJoin(users, eq(communityResponses.authorId, users.id))
    .where(eq(communityResponses.postId, postId))
    .orderBy(asc(communityResponses.createdAt));
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    createdAt: r.createdAt,
    author: r.authorId ? { id: r.authorId, name: r.authorName ?? "" } : null,
  }));
}

// ── RSVP to a social event (owners' meetings: voting module setMeetingRsvp) ─

export async function getMyEventRsvp(postId: string, userId: string): Promise<RsvpStatus | null> {
  const [row] = await db
    .select({ status: eventRsvps.status })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.postId, postId), eq(eventRsvps.userId, userId)))
    .limit(1);
  return row?.status ?? null;
}

/**
 * Sets (status) or withdraws (null) the actor's own RSVP on a SOCIAL event.
 * Owners' meeting posts throw `validation.postId` {reason: owners_meeting} —
 * they go through the voting module's setMeetingRsvp.
 */
export async function setSocialEventRsvp(
  actor: CommunityActor,
  postId: string,
  status: RsvpStatus | null
): Promise<{ status: RsvpStatus | null }> {
  // The viewer must be able to see the event (feed rule) — a post from
  // another entrance answers like a missing one.
  if (!(await canSeeCommunityPost(actor, postId))) throw new McpError("not_found");
  const post = await loadCommunityPostRow(postId);
  if (!post) throw new McpError("not_found");
  if (post.type !== "event") throw validationError("postId", { reason: "events_only" });
  if (post.eventKind === "owners_meeting") {
    throw validationError("postId", { reason: "owners_meeting" });
  }

  if (status === null) {
    await db
      .delete(eventRsvps)
      .where(and(eq(eventRsvps.postId, postId), eq(eventRsvps.userId, actor.userId)));
    return { status: null };
  }

  if (!hasPermission(actor.role, "respondToCommunityPost")) throw new McpError("forbidden");
  const [existing] = await db
    .select({ id: eventRsvps.id })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.postId, postId), eq(eventRsvps.userId, actor.userId)))
    .limit(1);
  if (existing) {
    await db
      .update(eventRsvps)
      .set({ status, updatedAt: new Date() })
      .where(eq(eventRsvps.id, existing.id));
  } else {
    await db.insert(eventRsvps).values({ postId, userId: actor.userId, status });
  }
  return { status };
}

// ── Directory (adresár) ──────────────────────────────────────────────────

export interface DirectoryListItem {
  id: string;
  userId: string;
  name: string;
  /** Only when the person opted in (sharePhone / shareEmail). */
  phone: string | null;
  email: string | null;
  note: string | null;
  skills: string | null;
  sharePhone: boolean;
  shareEmail: boolean;
  flatNumber: string | null;
  entranceName: string | null;
}

/**
 * The opt-in directory as every member with `viewDirectory` sees it
 * (BYT-20261118-012 — shared by GET /api/community/directory and the MCP
 * list_directory tool):
 *   - only ACTIVE users (a pending, rejected or deactivated account's old
 *     opt-in never shows);
 *   - only members of THIS community: an active membership on the root or
 *     any entity below it (another community on the instance is invisible);
 *   - phone / e-mail only where the person shared them;
 *   - flat / entrance = the person's first active unit membership in the
 *     community.
 * Caller checks `viewDirectory`.
 */
export async function listDirectory(rootId: string): Promise<DirectoryListItem[]> {
  const inCommunity = (userCol: typeof directoryEntries.userId) => sql`EXISTS (
    SELECT 1
    FROM ${memberships} m
    JOIN ${entities} me ON me.id = m.entity_id
    JOIN ${entities} r ON r.id = ${rootId}
    WHERE m.user_id = ${userCol}
      AND m.status = 'active'
      AND me.archived_at IS NULL
      AND me.path LIKE r.path || '%'
  )`;
  const baseRows = await db
    .select({
      id: directoryEntries.id,
      userId: directoryEntries.userId,
      sharePhone: directoryEntries.sharePhone,
      shareEmail: directoryEntries.shareEmail,
      note: directoryEntries.note,
      skills: directoryEntries.skills,
      name: users.name,
      email: users.email,
      phone: users.phone,
    })
    .from(directoryEntries)
    .innerJoin(users, eq(directoryEntries.userId, users.id))
    .where(and(eq(users.status, "active"), inCommunity(directoryEntries.userId)))
    .orderBy(users.name);

  // One representative flat per user in a follow-up query (a 4-way join
  // would duplicate users holding several flats).
  const flat = aliasedTable(entities, "flat");
  const entrance = aliasedTable(entities, "entrance");
  const userIds = baseRows.map((r) => r.userId);
  const flatRows: { userId: string; flatNumber: string; entranceName: string | null }[] = userIds.length
    ? await db
        .select({
          userId: memberships.userId,
          flatNumber: sql<string>`${flat.data}->>'flat_number'`,
          entranceName: entrance.name,
        })
        .from(memberships)
        .innerJoin(flat, eq(memberships.entityId, flat.id))
        .leftJoin(entrance, eq(entrance.id, flat.parentId))
        .where(
          and(
            inArray(memberships.userId, userIds),
            eq(memberships.status, "active"),
            eq(flat.kind, "unit"),
            isNull(flat.archivedAt),
            sql`${flat.path} LIKE (SELECT path || '%' FROM ${entities} WHERE id = ${rootId})`
          )
        )
    : [];
  const flatByUser = new Map<string, { flatNumber: string; entranceName: string | null }>();
  for (const r of flatRows) {
    if (!flatByUser.has(r.userId)) {
      flatByUser.set(r.userId, { flatNumber: r.flatNumber, entranceName: r.entranceName });
    }
  }

  return baseRows.map((r) => {
    const f = flatByUser.get(r.userId);
    return {
      id: r.id,
      userId: r.userId,
      name: r.name,
      phone: r.sharePhone ? r.phone : null,
      email: r.shareEmail ? r.email : null,
      note: r.note,
      skills: r.skills,
      sharePhone: r.sharePhone,
      shareEmail: r.shareEmail,
      flatNumber: f?.flatNumber ?? null,
      entranceName: f?.entranceName ?? null,
    };
  });
}

export interface DirectoryEntryInput {
  sharePhone?: boolean;
  shareEmail?: boolean;
  note?: string | null;
  skills?: string | null;
}

export interface NormalizedDirectoryEntry {
  sharePhone: boolean;
  shareEmail: boolean;
  note: string | null;
  skills: string | null;
}

export function normalizeDirectoryEntry(input: DirectoryEntryInput): NormalizedDirectoryEntry {
  const note = typeof input.note === "string" ? input.note.trim() : "";
  const skills = typeof input.skills === "string" ? input.skills.trim() : "";
  if (note.length > 255) throw validationError("note");
  if (skills.length > 500) throw validationError("skills");
  return {
    sharePhone: input.sharePhone === true,
    shareEmail: input.shareEmail === true,
    note: note || null,
    skills: skills || null,
  };
}

export async function getDirectoryEntry(userId: string) {
  const [row] = await db
    .select()
    .from(directoryEntries)
    .where(eq(directoryEntries.userId, userId))
    .limit(1);
  return row ?? null;
}

/** Creates or replaces the actor's own entry (opt-in to the directory). */
export async function upsertDirectoryEntry(actor: CommunityActor, input: DirectoryEntryInput) {
  if (!hasPermission(actor.role, "editOwnDirectory")) throw new McpError("forbidden");
  const values = normalizeDirectoryEntry(input);
  const existing = await getDirectoryEntry(actor.userId);
  if (existing) {
    const [updated] = await db
      .update(directoryEntries)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(directoryEntries.id, existing.id))
      .returning();
    return { entry: updated, created: false };
  }
  const [created] = await db
    .insert(directoryEntries)
    .values({ userId: actor.userId, ...values })
    .returning();
  return { entry: created, created: true };
}

/** Removes the user's own entry (leaves the directory). */
export async function deleteDirectoryEntry(userId: string): Promise<void> {
  await db.delete(directoryEntries).where(eq(directoryEntries.userId, userId));
}
