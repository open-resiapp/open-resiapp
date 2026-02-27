import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { votings, users } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import type { UserRole } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const result = await db
    .select({
      id: votings.id,
      title: votings.title,
      description: votings.description,
      status: votings.status,
      startsAt: votings.startsAt,
      endsAt: votings.endsAt,
      createdAt: votings.createdAt,
      createdBy: {
        id: users.id,
        name: users.name,
      },
    })
    .from(votings)
    .leftJoin(users, eq(votings.createdById, users.id))
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
  const { title, description, startsAt, endsAt, status } = body;

  if (!title || !startsAt || !endsAt) {
    return NextResponse.json(
      { error: "Nadpis, začiatok a koniec sú povinné" },
      { status: 400 }
    );
  }

  const [voting] = await db
    .insert(votings)
    .values({
      title,
      description: description || null,
      status: status || "draft",
      startsAt: new Date(startsAt),
      endsAt: new Date(endsAt),
      createdById: session.user.id,
    })
    .returning();

  return NextResponse.json(voting, { status: 201 });
}
