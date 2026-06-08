import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, desc, eq, sql } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, entities, memberships } from "@/db/schema";
import { votings } from "@modules/voting/src/db/schema";
import { hasPermission } from "@/lib/permissions";
import { getCommunityRoot } from "@/lib/legacy-compat";
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
  // overlap with V.entity (ancestor / equal / descendant).
  const userId = session.user.id;
  const isAdmin = role === "admin";
  const entrance = aliasedTable(entities, "entrance");

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
      entityId: votings.entityId,
      entranceName: entrance.name,
      createdBy: {
        id: users.id,
        name: users.name,
      },
    })
    .from(votings)
    .leftJoin(users, eq(votings.createdById, users.id))
    .leftJoin(entrance, eq(entrance.id, votings.entityId));

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
  const { title, description, startsAt, endsAt, status, votingType, initiatedBy, quorumType, entityId, documentProjectId } = body;

  if (!title || !startsAt || !endsAt) {
    return NextResponse.json(
      { error: "Nadpis, začiatok a koniec sú povinné" },
      { status: 400 }
    );
  }

  // Phase 9.2: read country from the root entity's housing_root_data
  // via the legacy-compat helper. Falls back to "sk" if no root.
  const root = await getCommunityRoot();
  const country = (root?.country ?? "sk") as Country;

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

  // Scope: explicit entityId from body, or default to the root entity
  // (community-wide vote). Legacy `entranceId` body field is accepted
  // and treated as entityId for backward compatibility with older
  // clients.
  const scopeEntityId =
    (typeof entityId === "string" && entityId) ||
    body.entranceId ||
    root?.id ||
    null;

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
      entityId: scopeEntityId,
      documentProjectId: documentProjectId || null,
    })
    .returning();

  return NextResponse.json(voting, { status: 201 });
}
