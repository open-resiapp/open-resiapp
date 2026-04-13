import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { votings, users, building, entrances, userFlats, flats } from "@/db/schema";
import { desc, eq, inArray, isNull, or } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { validatePerRollamDuration } from "@/lib/voting-rules";
import type { UserRole, Country } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const role = session.user.role as UserRole;
  let conditions;

  // Non-admins only see building-wide votings + votings for their entrances
  if (role !== "admin") {
    const userEntrances = await db
      .select({ entranceId: flats.entranceId })
      .from(userFlats)
      .innerJoin(flats, eq(userFlats.flatId, flats.id))
      .where(eq(userFlats.userId, session.user.id));

    const entranceIds = [...new Set(userEntrances.map((e) => e.entranceId))];

    conditions = entranceIds.length > 0
      ? or(isNull(votings.entranceId), inArray(votings.entranceId, entranceIds))
      : isNull(votings.entranceId);
  }

  const result = await db
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
      entranceName: entrances.name,
      createdBy: {
        id: users.id,
        name: users.name,
      },
    })
    .from(votings)
    .leftJoin(users, eq(votings.createdById, users.id))
    .leftJoin(entrances, eq(votings.entranceId, entrances.id))
    .where(conditions)
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
    })
    .returning();

  return NextResponse.json(voting, { status: 201 });
}
