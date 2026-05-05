import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import {
  users,
  building,
  entrances,
  entities,
  memberships,
} from "@/db/schema";
import { votings } from "@modules/voting/src/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { validatePerRollamDuration } from "@modules/voting/src/rules";
import type { UserRole, Country } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const role = session.user.role as UserRole;

  // Visibility rule (RES-20260501-002): a user sees a voting V iff they
  // hold an active membership M whose entity is anywhere on the path
  // overlap with V.entity (M is ancestor, equal, or descendant of V).
  //  - Admin at root sees every voting in the subtree.
  //  - Owner at flat sees community-wide and entrance-wide votings that
  //    cover their flat.
  // Implemented via two LIKE checks on materialized paths: V's entity
  // path starts with M's entity path, or vice versa.
  const userId = session.user.id;
  const isAdmin = role === "admin";

  const baseQuery = db
    .select({
      id: votings.id,
      title: votings.title,
      description: votings.description,
      status: votings.status,
      votingType: votings.votingType,
      initiatedBy: votings.initiatedBy,
      quorumType: votings.quorumType,
      startsAt: votings.startsAt,
      endsAt: votings.endsAt,
      createdAt: votings.createdAt,
      entranceId: votings.entranceId,
      entityId: votings.entityId,
      entranceName: entrances.name,
      createdBy: {
        id: users.id,
        name: users.name,
      },
    })
    .from(votings)
    .leftJoin(users, eq(votings.createdById, users.id))
    .leftJoin(entrances, eq(votings.entranceId, entrances.id));

  const result = isAdmin
    ? await baseQuery.orderBy(desc(votings.createdAt))
    : await baseQuery
        .where(
          sql`EXISTS (
            SELECT 1
            FROM ${memberships} m
            JOIN ${entities} me ON me.id = m.entity_id
            JOIN ${entities} ve ON ve.id = ${votings.entityId}
            WHERE m.user_id = ${userId}
              AND m.status = 'active'
              AND (ve.path LIKE me.path || '%' OR me.path LIKE ve.path || '%')
          )`
        )
        .orderBy(desc(votings.createdAt));

  return NextResponse.json(result);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "createVoting")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const body = await request.json();
  const { title, description, startsAt, endsAt, status, votingType, initiatedBy, quorumType, entranceId } = body;

  if (!title || !startsAt || !endsAt) {
    return NextResponse.json(
      { error: "Nadpis, začiatok a koniec sú povinné" },
      { status: 400 }
    );
  }

  // Fetch building country for voting rules
  const [bld] = await db.select({ country: building.country }).from(building).limit(1);
  const country = (bld?.country ?? "sk") as Country;

  // Validate per rollam minimum duration (CZ: 15 days)
  const resolvedVotingType = votingType || "written";
  if (resolvedVotingType === "written") {
    const minEnd = validatePerRollamDuration(
      country,
      new Date(startsAt),
      new Date(endsAt)
    );
    if (minEnd) {
      return NextResponse.json(
        { error: `Písomné hlasovanie musí trvať minimálne 15 dní. Najskorší koniec: ${minEnd.toISOString().split("T")[0]}` },
        { status: 400 }
      );
    }
  }

  // Phase 4 dual-run: dual-write entity_id alongside legacy entrance_id.
  // entrance.id == entity.id thanks to the 0023 backfill, so the entrance_id
  // value works directly as entity_id. NULL (= building-wide scope) maps to
  // the single root entity.
  let scopeEntityId: string | null = entranceId || null;
  if (scopeEntityId === null) {
    const [root] = await db
      .select({ id: building.id })
      .from(building)
      .orderBy(building.createdAt)
      .limit(1);
    scopeEntityId = root?.id ?? null;
  }

  const [voting] = await db
    .insert(votings)
    .values({
      title,
      description: description || null,
      status: status || "draft",
      votingType: votingType || "written",
      initiatedBy: initiatedBy || "board",
      quorumType: quorumType || "simple_all",
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      createdById: session.user.id,
      entranceId: entranceId || null,
      entityId: scopeEntityId,
    })
    .returning();

  return NextResponse.json(voting, { status: 201 });
}
