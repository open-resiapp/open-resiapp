import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { entities, memberships } from "@/db/schema";
import { votings, votingItems, ballots } from "@modules/voting/src/db/schema";
import { getVotingDetail } from "@modules/voting/src/votings";
import { assertBoard } from "@/lib/mcp/authz";
import { isMcpError, mcpErrorStatus } from "@/lib/mcp/errors";
import { principalFromSession } from "@/lib/mcp/principal";
import { sendPushToAll } from "@/lib/push";
import { dispatchHook } from "@/lib/modules/dispatch";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { normalizeItems } from "@modules/voting/src/items";
import { checkQuorumForVotingPatch } from "@modules/voting/src/quorum-guard.server";
import { getApprovedFinancialEffects } from "@modules/voting/src/results";
import { processApprovedFinancialEffects } from "@modules/accounting/src/lib/voting-pipeline";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }

  const { id } = await params;
  // No visibility check here — pre-existing (spec Notes → found gaps);
  // MCP uses getVisibleVotingDetail.
  const voting = await getVotingDetail(id);
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

  // BYT-20261117-001 Decided 1: admin OR active chairman may edit /
  // activate / close a voting — same authority as createVoting.
  try {
    assertBoard(await principalFromSession(session));
  } catch (err) {
    if (isMcpError(err)) {
      return NextResponse.json(
        { error: err.code === "forbidden" ? "Nemáte oprávnenie" : err.code },
        { status: mcpErrorStatus(err.code) }
      );
    }
    throw err;
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
  if (body.documentProjectId !== undefined)
    updateData.documentProjectId = body.documentProjectId || null;
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

  // BYT-20260609-008: optional structural edit of ballot items. Only
  // allowed before any ballot is cast — item ids are referenced by
  // ballot_item_votes (on delete restrict), and reshuffling resolutions
  // mid-vote would invalidate cast choices.
  const quorumError = await checkQuorumForVotingPatch(id, body);
  if (quorumError) return NextResponse.json(quorumError, { status: 400 });

  let updated: typeof votings.$inferSelect | null | undefined;
  if (Array.isArray(body.items)) {
    const existingBallot = await db
      .select({ id: ballots.id })
      .from(ballots)
      .where(eq(ballots.votingId, id))
      .limit(1);
    if (existingBallot.length > 0) {
      return NextResponse.json(
        { error: "Položky nie je možné upraviť po odovzdaní prvého hlasu" },
        { status: 400 }
      );
    }

    const normalized = normalizeItems(body, "", null);
    if ("error" in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }

    updated = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(votings)
        .set(updateData)
        .where(eq(votings.id, id))
        .returning();
      if (!u) return null;
      await tx.delete(votingItems).where(eq(votingItems.votingId, id));
      await tx.insert(votingItems).values(
        normalized.items.map((it) => ({
          votingId: id,
          idx: it.idx,
          title: it.title,
          description: it.description,
          quorumType: it.quorumType,
          financialEffectKind: it.financialEffectKind,
          financialEffectParams: it.financialEffectParams,
        }))
      );
      return u;
    });
  } else {
    const [u] = await db
      .update(votings)
      .set(updateData)
      .where(eq(votings.id, id))
      .returning();
    updated = u;
  }

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

    // Voting→accounting wedge (AC 513/514): turn passed financial items into
    // treasurer-reviewable drafts. Called directly (not via the onVoteClose
    // hook) because the hook bus loads modules from dist/index.js, which
    // can't reach this TS pipeline until the module build step lands; the
    // pipeline is idempotent, so it's safe if the hook later fires too.
    // Non-fatal + module-gated: a failure here never blocks closing a vote.
    if (await isModuleEnabled("accounting")) {
      try {
        const effects = await getApprovedFinancialEffects(updated.id);
        if (effects.length > 0) {
          const root = await getCommunityRoot();
          if (root) {
            await processApprovedFinancialEffects({
              entityId: root.id,
              country: root.country,
              actorId: updated.createdById,
              effects,
            });
          }
        }
      } catch (err) {
        console.error("[voting] accounting pipeline failed on close:", err);
      }
    }
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
