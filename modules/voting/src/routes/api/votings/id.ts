import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db } from "@/db";
import { votings, votingItems, ballots } from "@modules/voting/src/db/schema";
import { getVotingDetail } from "@modules/voting/src/votings";
import { notifyVotingStarted } from "@modules/voting/src/voting-notify.server";
import { assertBoard } from "@/lib/mcp/authz";
import { isMcpError, mcpErrorStatus } from "@/lib/mcp/errors";
import { principalFromSession } from "@/lib/mcp/principal";
import { dispatchHook } from "@/lib/modules/dispatch";
import { isModuleEnabled } from "@/lib/modules/route-guard";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { applyRepeatEscalation, normalizeItems } from "@modules/voting/src/items";
import { transitionVoting } from "@modules/voting/src/transitions.server";
import {
  VOTING_ACTIONS,
  actionForLegacyStatus,
  type VotingAction,
} from "@modules/voting/src/workflow/transitions";
import type { Country, VotingStatus } from "@/types";
import { listOfficials, replaceOfficials } from "@modules/voting/src/officials";
import { listVotingEvents, recordVotingEvent } from "@modules/voting/src/events";
import { normalizeOfficials } from "@modules/voting/src/workflow/officials";
import { minutesHistory } from "@modules/voting/src/workflow/minutes";
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

  // BYT-20261118-002: officials are printed on the public announcement, so
  // every viewer gets them (the owner UI does not render them); the audit
  // history (actor names, reopen notes) is board-only.
  const officials = await listOfficials(id);
  let isBoard = false;
  try {
    assertBoard(await principalFromSession(session));
    isBoard = true;
  } catch {
    isBoard = false;
  }
  const events = isBoard ? await listVotingEvents(id) : undefined;
  // Spec §6: minutes generated before a reopen are flagged superseded.
  const minutes = events ? minutesHistory(events) : undefined;

  return NextResponse.json({
    ...voting,
    officials,
    ...(events ? { events, minutes } : {}),
  });
}

// BYT-20261118-002 §4: record a generated document (board only). The
// version is derived (closed events + 1); nothing else is accepted.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Neautorizovaný prístup" }, { status: 401 });
  }
  try {
    assertBoard(await principalFromSession(session));
  } catch (err) {
    if (isMcpError(err)) {
      return NextResponse.json({ error: "FORBIDDEN" }, { status: mcpErrorStatus(err.code) });
    }
    throw err;
  }
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const DOCS = ["notice", "ballots_all", "ballot_blank", "minutes"];
  if (
    body.kind !== "document_generated" ||
    !DOCS.includes(body.doc as string) ||
    typeof body.contentHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(body.contentHash)
  ) {
    return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
  }
  const [exists] = await db
    .select({ id: votings.id, status: votings.status })
    .from(votings)
    .where(eq(votings.id, id))
    .limit(1);
  if (!exists) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  // Minutes exist only for a closed voting; while reopened the previous
  // version is superseded and no current minutes may be issued.
  if (body.doc === "minutes" && exists.status !== "closed") {
    return NextResponse.json({ error: "MINUTES_NOT_AVAILABLE" }, { status: 409 });
  }
  const history = await listVotingEvents(id);
  const closes = history.filter((e) => e.kind === "closed").length;
  // Minutes version = n-th close (v2 after close → reopen → close).
  const version = body.doc === "minutes" ? Math.max(1, closes) : closes + 1;
  await recordVotingEvent(db, {
    votingId: id,
    kind: "document_generated",
    actorId: session.user.id,
    payload: { doc: body.doc, version, contentHash: body.contentHash },
  });
  return NextResponse.json({ ok: true, version }, { status: 201 });
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
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const [current] = await db
    .select({
      status: votings.status,
      endsAt: votings.endsAt,
      resultPublishedAt: votings.resultPublishedAt,
    })
    .from(votings)
    .where(eq(votings.id, id))
    .limit(1);
  if (!current) {
    return NextResponse.json({ error: "Hlasovanie nenájdené" }, { status: 404 });
  }

  // ── Officials (BYT-20261118-002 §2) ───────────────────
  // Whole-list replace, allowed until the result is published (2026-11-18):
  // draft = preparation; active = the meeting elects its chair / recorder /
  // verifiers, or a verifier of a written vote is replaced; closed +
  // unpublished = the minutes step (incl. a verifier's refusal to sign,
  // §14a ods. 8 zák. 182/1993 Z.z.). After publication the minutes are
  // final → read-only.
  if (body.officials !== undefined && body.action === undefined && body.status === undefined) {
    if (current.resultPublishedAt) {
      return NextResponse.json({ error: "VOTING_LOCKED" }, { status: 400 });
    }
    const normalized = normalizeOfficials(body.officials);
    if ("error" in normalized) {
      return NextResponse.json({ error: normalized.error }, { status: 400 });
    }
    // Re-check under a row lock so a concurrent publish cannot slip in between.
    const locked = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({ resultPublishedAt: votings.resultPublishedAt })
        .from(votings)
        .where(eq(votings.id, id))
        .limit(1)
        .for("update");
      if (!row || row.resultPublishedAt) return true;
      await replaceOfficials(tx, id, normalized.officials);
      return false;
    });
    if (locked) {
      return NextResponse.json({ error: "VOTING_LOCKED" }, { status: 400 });
    }
    if (Object.keys(body).length === 1) {
      return NextResponse.json({ officials: await listOfficials(id) });
    }
    delete body.officials;
  }

  // ── Status transitions (BYT-20261118-002 §6) ──────────
  // A raw `status` is no longer written as-is: it is mapped onto the guarded
  // state machine (draft→active, active→closed, closed→active with a note
  // while the result is unpublished, publish). Field edits are ignored in a
  // transition request.
  if (body.action !== undefined || body.status !== undefined) {
    const action = VOTING_ACTIONS.includes(body.action as VotingAction)
      ? (body.action as VotingAction)
      : body.action === undefined
        ? actionForLegacyStatus(current.status as VotingStatus, body.status)
        : null;
    if (!action) {
      return NextResponse.json({ error: "TRANSITION_NOT_ALLOWED" }, { status: 409 });
    }
    const publishedAt =
      typeof body.publishedAt === "string" && body.publishedAt
        ? new Date(body.publishedAt)
        : null;
    const result = await transitionVoting({
      votingId: id,
      actorId: session.user.id,
      action,
      note: typeof body.note === "string" ? body.note : null,
      publishedAt,
    });
    if (!result.ok) {
      return NextResponse.json(
        result.minDate ? { error: result.code, minDate: result.minDate } : { error: result.code },
        { status: result.status }
      );
    }
    const updated = result.voting;
    if (action === "close") await afterClose(updated);
    // Only the announcement notifies owners; a reopen (correction mode) must
    // not re-send the "new voting" push.
    // Push + e-mail fallback (voting-notify.server.ts); never throws, not
    // awaited so the e-mail loop does not hold the response.
    if (action === "announce") void notifyVotingStarted(updated);
    return NextResponse.json(updated);
  }

  // ── Field edits ────────────────────────────────────────
  // After the announcement the notified content (title, questions, place,
  // dates, type, scope) is frozen (§14a ods. 2). Only `endsAt` may move LATER
  // while active, plus the counter / attached dossier.
  if (current.status !== "draft") {
    const frozen = [
      "title",
      "description",
      "startsAt",
      "votingType",
      "initiatedBy",
      "entityId",
      "entranceId",
      "items",
      "quorumType",
      "place",
    ].filter((k) => body[k] !== undefined);
    if (frozen.length > 0) {
      return NextResponse.json({ error: "VOTING_LOCKED", fields: frozen }, { status: 400 });
    }
    const lockedUpdate: Record<string, unknown> = {};
    if (body.endsAt !== undefined) {
      const end = new Date(body.endsAt as string);
      // TODO(decision): spec Decisions 5 — may endsAt be extended at all
      // after announcement? Safest minimal: only later, only while active.
      if (
        current.status !== "active" ||
        Number.isNaN(end.getTime()) ||
        end.getTime() < current.endsAt.getTime()
      ) {
        return NextResponse.json({ error: "ENDS_AT_ONLY_LATER" }, { status: 400 });
      }
      lockedUpdate.endsAt = end;
    }
    if (body.voteCounterId !== undefined) lockedUpdate.voteCounterId = body.voteCounterId || null;
    if (body.documentProjectId !== undefined)
      lockedUpdate.documentProjectId = body.documentProjectId || null;
    if (Object.keys(lockedUpdate).length === 0) {
      return NextResponse.json({ error: "VOTING_LOCKED" }, { status: 400 });
    }
    const [u] = await db.update(votings).set(lockedUpdate).where(eq(votings.id, id)).returning();
    return NextResponse.json(u);
  }

  const updateData: Record<string, unknown> = {};
  if (body.title !== undefined) updateData.title = body.title;
  if (body.description !== undefined) updateData.description = body.description;
  if (body.startsAt !== undefined) updateData.startsAt = new Date(body.startsAt as string);
  if (body.endsAt !== undefined) updateData.endsAt = new Date(body.endsAt as string);
  if (body.voteCounterId !== undefined) updateData.voteCounterId = body.voteCounterId || null;
  if (body.votingType !== undefined) updateData.votingType = body.votingType;
  if (body.initiatedBy !== undefined) updateData.initiatedBy = body.initiatedBy;
  if (body.place !== undefined)
    updateData.place =
      typeof body.place === "string" && body.place.trim() ? body.place.trim().slice(0, 500) : null;
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
    // SK §14b ods. 6 repeated-vote escalation (needs the country).
    const root = await getCommunityRoot();
    const escalated = applyRepeatEscalation(
      normalized.items,
      (root?.country ?? "sk") as Country
    );
    if ("error" in escalated) {
      return NextResponse.json(escalated, { status: 400 });
    }

    updated = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(votings)
        .set(updateData)
        .where(and(eq(votings.id, id), eq(votings.status, "draft")))
        .returning();
      if (!u) return null;
      await tx.delete(votingItems).where(eq(votingItems.votingId, id));
      await tx.insert(votingItems).values(
        escalated.items.map((it) => ({
          votingId: id,
          idx: it.idx,
          title: it.title,
          description: it.description,
          quorumType: it.quorumType,
          repeatOfQuorumType: it.repeatOfQuorumType,
          financialEffectKind: it.financialEffectKind,
          financialEffectParams: it.financialEffectParams,
        }))
      );
      return u;
    });
  } else if (Object.keys(updateData).length > 0) {
    const [u] = await db
      .update(votings)
      .set(updateData)
      .where(and(eq(votings.id, id), eq(votings.status, "draft")))
      .returning();
    updated = u;
  } else {
    const [u] = await db.select().from(votings).where(eq(votings.id, id)).limit(1);
    updated = u;
  }

  if (!updated) {
    // Status moved away from draft between the read and the write.
    return NextResponse.json({ error: "VOTING_LOCKED" }, { status: 409 });
  }

  return NextResponse.json(updated);
}

/** Side effects of a close (run on every close, also after a reopen). */
async function afterClose(updated: typeof votings.$inferSelect) {
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
  // pipeline is idempotent, so it's safe if the hook later fires too (and on
  // a second close after a reopen).
  // Spec §6: an item that flipped passed → not passed after a reopen keeps
  // its draft (nothing is deleted or reversed automatically); the impacts
  // route flags it (`notPassedAnymore`, results.ts getItemPassedMap).
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
