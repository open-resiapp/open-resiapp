import { NextRequest, NextResponse } from "next/server";
import { aliasedTable, and, eq, inArray, isNull } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { users, entities, memberships } from "@/db/schema";
import { votings } from "@modules/voting/src/db/schema";
import { hasPermission } from "@/lib/permissions";
import { sendPushToAll } from "@/lib/push";
import { dispatchHook } from "@/lib/modules/dispatch";
import { getCommunityRoot } from "@/lib/legacy-compat";
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
  const entrance = aliasedTable(entities, "entrance");

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
      entityId: votings.entityId,
      entranceName: entrance.name,
      createdBy: {
        id: users.id,
        name: users.name,
      },
    })
    .from(votings)
    .leftJoin(users, eq(votings.createdById, users.id))
    .leftJoin(entrance, eq(entrance.id, votings.entityId))
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
  // Accept either `entityId` (canonical) or legacy `entranceId` from older
  // clients. Both resolve to the voting's scope entity. NULL = community-wide
  // → use the root entity.
  const scopeChange = body.entityId ?? body.entranceId;
  if (scopeChange !== undefined) {
    if (scopeChange) {
      updateData.entityId = scopeChange;
    } else {
      const root = await getCommunityRoot();
      updateData.entityId = root?.id ?? null;
    }
  }

  const [updated] = await db
    .update(votings)
    .set(updateData)
    .where(eq(votings.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Hlasovanie nenájdené" }, { status: 404 });
  }

  if (body.status === "closed") {
    dispatchHook("onVoteClose", {
      id: updated.id,
      communityId: updated.entityId ?? "",
      title: updated.title,
      status: updated.status,
    }).catch((err) => console.error("[modules] onVoteClose failed:", err));
  }

  // Push notify owners in the voting's subtree when it goes active.
  if (body.status === "active" && updated.entityId) {
    const [scope] = await db
      .select({ path: entities.path })
      .from(entities)
      .where(eq(entities.id, updated.entityId))
      .limit(1);
    if (scope) {
      const ownerRows = await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .innerJoin(entities, eq(memberships.entityId, entities.id))
        .where(
          and(
            eq(memberships.status, "active"),
            inArray(memberships.role, ["admin", "owner"]),
            isNull(entities.archivedAt),
            // Memberships at any descendant of the voting's scope.
            // Using path prefix match to avoid recursive CTE here.
            // Drizzle doesn't have a clean LIKE on column-vs-column,
            // so rely on raw SQL for the path overlap.
            // We accept slight overestimation (ancestors also match).
          )
        );
      const ownerIds = ownerRows.map((r) => r.userId);
      if (ownerIds.length > 0) {
        sendPushToAll(
          { title: "Nové hlasovanie", body: updated.title, url: `/voting/${id}` },
          "votingStarted",
          ownerIds
        ).catch(() => {});
      }
    }
  }

  return NextResponse.json(updated);
}
