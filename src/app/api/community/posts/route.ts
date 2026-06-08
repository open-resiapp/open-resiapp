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
import { dispatchHook } from "@/lib/modules/dispatch";
import { linkDocumentToTarget } from "@/lib/documents.server";
import type { UserRole } from "@/types";

const POST_TTL_DAYS = 30;

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

  if (!hasPermission(session.user.role as UserRole, "createCommunityPost")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json();
  const { type, title, content, photoUrl, eventDate, eventLocation, entranceId, responsesAllowed } = body;

  if (!type || !title || !content) {
    return NextResponse.json(
      { error: "Typ, nadpis a obsah sú povinné" },
      { status: 400 }
    );
  }

  const isEvent = type === "event";
  if (isEvent && (!eventDate || !eventLocation)) {
    return NextResponse.json(
      { error: "Udalosť musí mať dátum a miesto" },
      { status: 400 }
    );
  }
  if (!isEvent && (eventDate || eventLocation)) {
    return NextResponse.json(
      { error: "Dátum a miesto sú povolené len pre udalosti" },
      { status: 400 }
    );
  }

  const expiresAt = new Date(Date.now() + POST_TTL_DAYS * 24 * 60 * 60 * 1000);

  // Phase 9.1d: NULL entranceId = community-wide → root entity.
  let cpEntityId: string | null = entranceId || null;
  if (cpEntityId === null) {
    const root = await getCommunityRoot();
    cpEntityId = root?.id ?? null;
  }

  if (!cpEntityId) {
    return NextResponse.json({ error: "Žiadne community root nie je nastavené" }, { status: 500 });
  }

  const [post] = await db
    .insert(communityPosts)
    .values({
      type,
      title,
      content,
      photoUrl: photoUrl || null,
      authorId: session.user.id,
      eventDate: eventDate ? new Date(eventDate) : null,
      eventLocation: eventLocation || null,
      entityId: cpEntityId,
      // Default true; only persist false when the author explicitly opts out.
      responsesAllowed: responsesAllowed === false ? false : true,
      expiresAt,
    })
    .returning();

  const documentIds = Array.isArray(body.documentIds) ? body.documentIds : [];
  for (const docId of documentIds) {
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

  return NextResponse.json(post, { status: 201 });
}
