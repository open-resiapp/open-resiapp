import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { votings, users, entrances } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hasPermission } from "@/lib/permissions";
import { sendPushToAll } from "@/lib/push";
import type { UserRole } from "@/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { id } = await params;

  const [voting] = await db
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
      voteCounterId: votings.voteCounterId,
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
    .where(eq(votings.id, id))
    .limit(1);

  if (!voting) {
    return NextResponse.json({ error: "Hlasovanie nenájdené" }, { status: 404 });
  }

  return NextResponse.json(voting);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  if (!hasPermission(session.user.role as UserRole, "createVoting")) {
    return NextResponse.json({ error: "Nemáte oprávnenie" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const updateData: Record<string, unknown> = {};

  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.status !== undefined) updateData.status = body.status;
  if (body.startsAt !== undefined) updateData.startsAt = new Date(body.startsAt);
  if (body.endsAt !== undefined) updateData.endsAt = new Date(body.endsAt);
  if (body.voteCounterId !== undefined) updateData.voteCounterId = body.voteCounterId;
  if (body.votingType !== undefined) updateData.votingType = body.votingType;
  if (body.initiatedBy !== undefined) updateData.initiatedBy = body.initiatedBy;
  if (body.quorumType !== undefined) updateData.quorumType = body.quorumType;
  if (body.entranceId !== undefined) updateData.entranceId = body.entranceId || null;

  const [updated] = await db
    .update(votings)
    .set(updateData)
    .where(eq(votings.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Hlasovanie nenájdené" }, { status: 404 });
  }

  // Send push notification when voting becomes active
  if (body.status === "active") {
    // Get all owner user IDs
    const owners = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.role, "owner"));
    const ownerIds = owners.map((o) => o.id);

    sendPushToAll(
      { title: "Nové hlasovanie", body: updated.title, url: `/voting/${id}` },
      "votingStarted",
      ownerIds
    ).catch(() => {});
  }

  return NextResponse.json(updated);
}
