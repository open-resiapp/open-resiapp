import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  communityPosts,
  communityResponses,
  users,
  eventRsvps,
  entities,
  memberships,
} from "@/db/schema";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { createCommunityPost } from "@/lib/community.server";
import { isMcpError, mcpErrorStatus } from "@/lib/mcp/errors";
import {
  aliasedTable,
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  or,
  asc,
  sql,
} from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const role = session.user.role as UserRole;
  if (!hasPermission(role, "viewCommunity")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get("type");
  const includeResolved = searchParams.get("includeResolved") === "true";
  const includeExpired = searchParams.get("includeExpired") === "true";

  const conditions = [] as unknown[];

  if (typeParam) {
    const types = typeParam.split(",") as (typeof communityPosts.$inferSelect.type)[];
    conditions.push(inArray(communityPosts.type, types));
  }

  if (includeResolved) {
    conditions.push(inArray(communityPosts.status, ["active", "resolved"] as const));
  } else {
    conditions.push(eq(communityPosts.status, "active"));
  }

  if (!includeExpired) {
    conditions.push(
      or(isNull(communityPosts.expiresAt), gt(communityPosts.expiresAt, new Date()))
    );
  }

  if (role !== "admin") {
    const buildingRow = await getCommunityRoot();
    const crossVisible = buildingRow?.communityCrossEntranceVisible ?? false;

    if (!crossVisible) {
      // Visibility rule (RES-20260501-002): community post P is visible
      // iff the viewer holds an active membership at an entity that
      // overlaps P's entity along the materialized path.
      const userId = session.user.id;
      conditions.push(
        sql`EXISTS (
          SELECT 1
          FROM ${memberships} m
          JOIN ${entities} me ON me.id = m.entity_id
          JOIN ${entities} pe ON pe.id = ${communityPosts.entityId}
          WHERE m.user_id = ${userId}
            AND m.status = 'active'
            AND (pe.path LIKE me.path || '%' OR me.path LIKE pe.path || '%')
        )`
      );
    }
  }

  const where = conditions.length > 0 ? and(...(conditions as never[])) : undefined;

  const isEventType = typeParam === "event";
  const entrance = aliasedTable(entities, "entrance");

  const result = await db
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
      entityId: communityPosts.entityId,
      entranceName: entrance.name,
      expiresAt: communityPosts.expiresAt,
      createdAt: communityPosts.createdAt,
      updatedAt: communityPosts.updatedAt,
      author: {
        id: users.id,
        name: users.name,
      },
    })
    .from(communityPosts)
    .leftJoin(users, eq(communityPosts.authorId, users.id))
    .leftJoin(entrance, eq(entrance.id, communityPosts.entityId))
    .where(where)
    .orderBy(
      isEventType ? asc(communityPosts.eventDate) : desc(communityPosts.createdAt)
    );

  // Response counts — useful for help/marketplace cards so authors see
  // how many neighbours reacted at a glance.
  const postIds = result.map((p) => p.id);
  const responseCountMap = new Map<string, number>();
  if (postIds.length > 0) {
    const rows = await db
      .select({
        postId: communityResponses.postId,
        count: sql<number>`count(*)::int`,
      })
      .from(communityResponses)
      .where(inArray(communityResponses.postId, postIds))
      .groupBy(communityResponses.postId);
    for (const r of rows) responseCountMap.set(r.postId, r.count);
  }

  const eventIds = result.filter((p) => p.type === "event").map((p) => p.id);
  const rsvpMap = new Map<
    string,
    { yes: number; maybe: number; no: number; myRsvp: "yes" | "maybe" | "no" | null }
  >();

  if (eventIds.length > 0) {
    const counts = await db
      .select({
        postId: eventRsvps.postId,
        status: eventRsvps.status,
        count: sql<number>`count(*)::int`,
      })
      .from(eventRsvps)
      .where(inArray(eventRsvps.postId, eventIds))
      .groupBy(eventRsvps.postId, eventRsvps.status);

    const mine = await db
      .select({ postId: eventRsvps.postId, status: eventRsvps.status })
      .from(eventRsvps)
      .where(
        and(
          inArray(eventRsvps.postId, eventIds),
          eq(eventRsvps.userId, session.user.id)
        )
      );

    for (const id of eventIds) {
      rsvpMap.set(id, { yes: 0, maybe: 0, no: 0, myRsvp: null });
    }
    for (const row of counts) {
      const bucket = rsvpMap.get(row.postId);
      if (bucket) bucket[row.status] = row.count;
    }
    for (const row of mine) {
      const bucket = rsvpMap.get(row.postId);
      if (bucket) bucket.myRsvp = row.status;
    }
  }

  const enriched = result.map((p) => {
    const responseCount = responseCountMap.get(p.id) ?? 0;
    if (p.type === "event") {
      const r = rsvpMap.get(p.id);
      return {
        ...p,
        responseCount,
        rsvp: r || { yes: 0, maybe: 0, no: 0, myRsvp: null },
      };
    }
    return { ...p, responseCount };
  });

  return NextResponse.json(enriched);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  // Permission, validation (type, title, content, event date + place,
  // entrance scope), document links and the onPostCreate hook live in
  // createCommunityPost — shared with the MCP create_community_post action
  // (BYT-20261118-012). Errors are stable codes.
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const post = await createCommunityPost(
      { userId: session.user.id, role: session.user.role as UserRole },
      {
        type: String(body.type ?? ""),
        title: String(body.title ?? ""),
        content: String(body.content ?? ""),
        photoUrl: typeof body.photoUrl === "string" ? body.photoUrl : null,
        eventDate: typeof body.eventDate === "string" ? body.eventDate : null,
        eventLocation: typeof body.eventLocation === "string" ? body.eventLocation : null,
        entranceId: typeof body.entranceId === "string" ? body.entranceId : null,
        responsesAllowed: body.responsesAllowed !== false,
        documentIds: Array.isArray(body.documentIds) ? body.documentIds.map(String) : [],
      }
    );
    return NextResponse.json(post, { status: 201 });
  } catch (err) {
    if (isMcpError(err)) {
      return NextResponse.json({ error: err.code }, { status: mcpErrorStatus(err.code) });
    }
    throw err;
  }
}
