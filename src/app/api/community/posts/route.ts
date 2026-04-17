import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  communityPosts,
  users,
  userFlats,
  flats,
  entrances,
  building,
} from "@/db/schema";
import { and, desc, eq, gt, inArray, isNull, or, asc } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
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
    const [buildingRow] = await db.select().from(building).limit(1);
    const crossVisible = buildingRow?.communityCrossEntranceVisible ?? false;

    if (!crossVisible) {
      const userEntrances = await db
        .select({ entranceId: flats.entranceId })
        .from(userFlats)
        .innerJoin(flats, eq(userFlats.flatId, flats.id))
        .where(eq(userFlats.userId, session.user.id));

      const entranceIds = [...new Set(userEntrances.map((e) => e.entranceId))];
      conditions.push(
        entranceIds.length > 0
          ? or(isNull(communityPosts.entranceId), inArray(communityPosts.entranceId, entranceIds))
          : isNull(communityPosts.entranceId)
      );
    }
  }

  const where = conditions.length > 0 ? and(...(conditions as never[])) : undefined;

  const isEventType = typeParam === "event";

  const result = await db
    .select({
      id: communityPosts.id,
      type: communityPosts.type,
      status: communityPosts.status,
      title: communityPosts.title,
      content: communityPosts.content,
      photoUrl: communityPosts.photoUrl,
      eventDate: communityPosts.eventDate,
      eventLocation: communityPosts.eventLocation,
      entranceId: communityPosts.entranceId,
      entranceName: entrances.name,
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
    .leftJoin(entrances, eq(communityPosts.entranceId, entrances.id))
    .where(where)
    .orderBy(
      isEventType ? asc(communityPosts.eventDate) : desc(communityPosts.createdAt)
    );

  return NextResponse.json(result);
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
  const { type, title, content, photoUrl, eventDate, eventLocation, entranceId } = body;

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
      entranceId: entranceId || null,
      expiresAt,
    })
    .returning();

  return NextResponse.json(post, { status: 201 });
}
