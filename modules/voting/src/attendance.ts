import "server-only";

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  communityNotificationsSent,
  communityPosts,
  entities,
  eventRsvps,
  users,
} from "@/db/schema";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { normalizeVotingMethod } from "@/lib/voting-method";
import { timeZoneForCountry } from "@/lib/time-zone";
import { isResidentialUnit } from "@/lib/unit-type";
import type { Principal } from "@/lib/mcp/principal";
import type { Country } from "@/types";
import { canRecordForVoting } from "./counter-authz.server";
import { attendance, ballots, mandates, votingItems, votings } from "./db/schema";
import { listEligibleVoters } from "./participation";
import { validateNotice } from "./workflow/notice";
import {
  attendanceWriteError,
  buildAttendanceExport,
  buildAttendanceLines,
  buildAttendanceSummary,
  buildRsvpOverview,
  meetingRsvpWriteError,
  type AttendanceErrorCode,
  type AttendanceRowIn,
  type EligibleLine,
  type ExportDocument,
  type ExportRowMode,
  type MeetingErrorCode,
  type MeetingRsvpErrorCode,
  type RsvpSource,
  type RsvpStatus,
} from "./workflow/attendance";
import { getDisplayTemplateSlug } from "@/lib/templates/display-slug";

// BYT-20261118-001 — owners' meeting: announcement post, RSVP, attendance
// list (prezenčná listina). Query functions only; routes gate authz and map
// codes to HTTP. No polling, no background work, no in-memory state.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class MeetingError extends Error {
  constructor(
    readonly code: AttendanceErrorCode | MeetingRsvpErrorCode | MeetingErrorCode,
    readonly status: number = 400,
    readonly details?: Record<string, unknown>
  ) {
    super(code);
    this.name = "MeetingError";
  }
}

export interface MeetingVoting {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "active" | "closed";
  votingType: "written" | "meeting";
  startsAt: Date;
  endsAt: Date;
  entityId: string;
  place: string | null;
  voteCounterId: string | null;
  meetingPostId: string | null;
  meetingChangeSeq: number;
}

const votingCols = {
  id: votings.id,
  title: votings.title,
  description: votings.description,
  status: votings.status,
  votingType: votings.votingType,
  startsAt: votings.startsAt,
  endsAt: votings.endsAt,
  entityId: votings.entityId,
  place: votings.place,
  voteCounterId: votings.voteCounterId,
  meetingPostId: votings.meetingPostId,
  meetingChangeSeq: votings.meetingChangeSeq,
};

export async function loadMeetingVoting(votingId: string): Promise<MeetingVoting | null> {
  const [v] = await db.select(votingCols).from(votings).where(eq(votings.id, votingId)).limit(1);
  return v ?? null;
}

export async function loadMeetingVotingByPost(postId: string): Promise<MeetingVoting | null> {
  const [v] = await db
    .select(votingCols)
    .from(votings)
    .where(eq(votings.meetingPostId, postId))
    .limit(1);
  return v ?? null;
}

/**
 * Who may run the door list and see names (spec §6, §9): the board
 * (admin / active chairman) and the vote counter OF THIS VOTING
 * (votings.voteCounterId — 2026-11-18 review; the global vote_counter role
 * alone no longer suffices). Caretaker / tenant / owner: no.
 */
export function canManageAttendance(
  p: Pick<Principal, "userId" | "role" | "status" | "boardRoles">,
  voting: { voteCounterId: string | null } | null
): boolean {
  return canRecordForVoting(p, voting);
}

export async function eligibleLines(votingId: string): Promise<EligibleLine[]> {
  return listEligibleVoters(votingId);
}

async function communityContext(): Promise<{ country: Country; votingMethod: ReturnType<typeof normalizeVotingMethod> }> {
  const root = await getCommunityRoot();
  return {
    country: (root?.country ?? "sk") as Country,
    votingMethod: normalizeVotingMethod(root?.votingMethod),
  };
}

// ── Announcement post (§1) ─────────────────────────────

/**
 * Creates the event post that announces a meeting voting and links it.
 * Call inside the transaction that creates / announces the voting.
 */
export async function createMeetingPost(
  tx: Tx,
  voting: Pick<MeetingVoting, "id" | "title" | "description" | "startsAt" | "place" | "entityId">,
  authorId: string
): Promise<string> {
  const [post] = await tx
    .insert(communityPosts)
    .values({
      type: "event",
      eventKind: "owners_meeting",
      title: voting.title.slice(0, 255),
      content: voting.description?.trim() || voting.title,
      authorId,
      eventDate: voting.startsAt,
      eventLocation: voting.place ? voting.place.slice(0, 255) : null,
      entityId: voting.entityId,
      // A statutory announcement, not a discussion thread.
      responsesAllowed: false,
    })
    .returning({ id: communityPosts.id });
  await tx.update(votings).set({ meetingPostId: post.id }).where(eq(votings.id, voting.id));
  return post.id;
}

/** Board action "Oznámiť schôdzu vlastníkom" for a meeting voting without a post. */
export async function announceMeeting(
  votingId: string,
  actorId: string,
  placeInput?: string | null
): Promise<string> {
  const v = await loadMeetingVoting(votingId);
  if (!v) throw new MeetingError("ATTENDANCE_NOT_FOUND", 404);
  if (v.votingType !== "meeting") throw new MeetingError("MEETING_NOT_MEETING_VOTING");
  if (v.meetingPostId) throw new MeetingError("MEETING_ALREADY_ANNOUNCED", 409);
  if (v.status !== "active") throw new MeetingError("MEETING_VOTING_NOT_ACTIVE");
  const place = (placeInput?.trim() || v.place || "").slice(0, 500) || null;
  if (!place) throw new MeetingError("MEETING_PLACE_REQUIRED");
  if (v.startsAt.getTime() <= Date.now()) throw new MeetingError("MEETING_IN_PAST");
  return db.transaction(async (tx) => {
    if (place !== v.place) {
      await tx.update(votings).set({ place }).where(eq(votings.id, v.id));
    }
    return createMeetingPost(tx, { ...v, place }, actorId);
  });
}

/**
 * Date / place change. The new date must again respect the 7-full-day notice
 * (workflow/notice.ts, announced now). RSVP rows are kept; the change counter
 * is bumped so a new meeting_change e-mail can be claimed.
 */
export async function changeMeeting(
  votingId: string,
  input: { startsAt?: Date; place?: string | null }
): Promise<MeetingVoting> {
  const v = await loadMeetingVoting(votingId);
  if (!v) throw new MeetingError("ATTENDANCE_NOT_FOUND", 404);
  if (v.votingType !== "meeting") throw new MeetingError("MEETING_NOT_MEETING_VOTING");
  if (!v.meetingPostId) throw new MeetingError("MEETING_NOT_ANNOUNCED");
  if (v.status !== "active") throw new MeetingError("MEETING_VOTING_NOT_ACTIVE");

  const startsAt = input.startsAt ?? v.startsAt;
  const place = input.place === undefined ? v.place : input.place?.trim() || null;
  if (!place) throw new MeetingError("MEETING_PLACE_REQUIRED");
  const endsAt = new Date(startsAt.getTime() + (v.endsAt.getTime() - v.startsAt.getTime()));

  if (startsAt.getTime() !== v.startsAt.getTime()) {
    const { country } = await communityContext();
    const notice = validateNotice({
      country,
      announcedAt: new Date(),
      startsAt,
      endsAt,
      timeZone: timeZoneForCountry(country),
    });
    if (notice) {
      throw new MeetingError("MEETING_NOTICE_TOO_SHORT", 400, { minDate: notice.minDate ?? null });
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(votings)
      .set({
        startsAt,
        endsAt,
        place: place.slice(0, 500),
        meetingChangeSeq: sql`${votings.meetingChangeSeq} + 1`,
      })
      .where(eq(votings.id, votingId));
    await tx
      .update(communityPosts)
      .set({ eventDate: startsAt, eventLocation: place.slice(0, 255), updatedAt: new Date() })
      .where(eq(communityPosts.id, v.meetingPostId!));
  });
  return (await loadMeetingVoting(votingId))!;
}

/**
 * Cancels the meeting announcement: the post expires, the counter is bumped.
 * Only while the voting is active. Idempotent: a second call (post already
 * expired) changes nothing and returns `cancelled: false`, so the caller
 * sends no second round of e-mails.
 */
export async function cancelMeeting(
  votingId: string
): Promise<{ voting: MeetingVoting; cancelled: boolean }> {
  const v = await loadMeetingVoting(votingId);
  if (!v) throw new MeetingError("ATTENDANCE_NOT_FOUND", 404);
  if (v.votingType !== "meeting") throw new MeetingError("MEETING_NOT_MEETING_VOTING");
  if (!v.meetingPostId) throw new MeetingError("MEETING_NOT_ANNOUNCED");
  if (v.status !== "active") throw new MeetingError("MEETING_VOTING_NOT_ACTIVE");
  const cancelled = await db.transaction(async (tx) => {
    // Guarded on the post status: two clicks / two replicas → one cancel.
    const [post] = await tx
      .update(communityPosts)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(communityPosts.id, v.meetingPostId!), eq(communityPosts.status, "active")))
      .returning({ id: communityPosts.id });
    if (!post) return false;
    await tx
      .update(votings)
      .set({ meetingChangeSeq: sql`${votings.meetingChangeSeq} + 1` })
      .where(and(eq(votings.id, votingId), eq(votings.status, "active")));
    return true;
  });
  return { voting: (await loadMeetingVoting(votingId))!, cancelled };
}

// ── RSVP (§2, §3) ──────────────────────────────────────

export async function isEligibleOwner(votingId: string, userId: string): Promise<boolean> {
  const lines = await eligibleLines(votingId);
  return lines.some((l) => l.ownerId === userId);
}

/**
 * Upserts (status) or clears (null) one owner's answer on a meeting post.
 * Checks the RSVP window and eligibility; returns codes via MeetingError.
 */
export async function setMeetingRsvp(input: {
  postId: string;
  userId: string;
  status: RsvpStatus | null;
  source: RsvpSource;
  recordedById?: string | null;
  now?: Date;
}): Promise<{ status: RsvpStatus | null }> {
  const [post] = await db
    .select({
      id: communityPosts.id,
      status: communityPosts.status,
      eventDate: communityPosts.eventDate,
      eventKind: communityPosts.eventKind,
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, input.postId))
    .limit(1);
  if (!post || post.eventKind !== "owners_meeting") {
    throw new MeetingError("MEETING_RSVP_NOT_ELIGIBLE", 404);
  }
  const windowError = meetingRsvpWriteError(post, input.now ?? new Date());
  if (windowError) throw new MeetingError(windowError, 409);
  const voting = await loadMeetingVotingByPost(post.id);
  if (!voting || !(await isEligibleOwner(voting.id, input.userId))) {
    throw new MeetingError("MEETING_RSVP_NOT_ELIGIBLE", 403);
  }

  if (input.status === null) {
    await db
      .delete(eventRsvps)
      .where(and(eq(eventRsvps.postId, post.id), eq(eventRsvps.userId, input.userId)));
    return { status: null };
  }
  const now = new Date();
  await db
    .insert(eventRsvps)
    .values({
      postId: post.id,
      userId: input.userId,
      status: input.status,
      source: input.source,
      recordedById: input.recordedById ?? null,
    })
    .onConflictDoUpdate({
      target: [eventRsvps.postId, eventRsvps.userId],
      set: {
        status: input.status,
        source: input.source,
        recordedById: input.recordedById ?? null,
        updatedAt: now,
      },
    });
  return { status: input.status };
}

export async function getOwnRsvp(postId: string, userId: string): Promise<RsvpStatus | null> {
  const [r] = await db
    .select({ status: eventRsvps.status })
    .from(eventRsvps)
    .where(and(eq(eventRsvps.postId, postId), eq(eventRsvps.userId, userId)))
    .limit(1);
  return r?.status ?? null;
}

// ── Board overview (§5) ────────────────────────────────

export async function getMeetingRsvpOverview(votingId: string) {
  const v = await loadMeetingVoting(votingId);
  if (!v) return null;
  const [eligible, ctx, items] = await Promise.all([
    eligibleLines(votingId),
    communityContext(),
    db
      .select({
        id: votingItems.id,
        idx: votingItems.idx,
        title: votingItems.title,
        quorumType: votingItems.quorumType,
      })
      .from(votingItems)
      .where(eq(votingItems.votingId, votingId)),
  ]);
  const ownerIds = [...new Set(eligible.map((e) => e.ownerId))];

  const rsvps = new Map<string, { status: RsvpStatus; source: RsvpSource }>();
  const invited = new Set<string>();
  const withEmail = new Set<string>();
  if (ownerIds.length > 0) {
    const [rsvpRows, sentRows, emailRows] = await Promise.all([
      v.meetingPostId
        ? db
            .select({ userId: eventRsvps.userId, status: eventRsvps.status, source: eventRsvps.source })
            .from(eventRsvps)
            .where(eq(eventRsvps.postId, v.meetingPostId))
        : Promise.resolve([]),
      v.meetingPostId
        ? db
            .select({ recipientId: communityNotificationsSent.recipientId })
            .from(communityNotificationsSent)
            .where(
              and(
                eq(communityNotificationsSent.postId, v.meetingPostId),
                eq(communityNotificationsSent.kind, "meeting_invitation")
              )
            )
        : Promise.resolve([]),
      db
        .select({ id: users.id })
        .from(users)
        .where(and(inArray(users.id, ownerIds), isNotNull(users.email))),
    ]);
    for (const r of rsvpRows) rsvps.set(r.userId, { status: r.status, source: r.source });
    for (const r of sentRows) invited.add(r.recipientId);
    for (const r of emailRows) withEmail.add(r.id);
  }

  const overview = buildRsvpOverview({
    eligible,
    rsvps,
    invited,
    withEmail,
    items,
    votingMethod: ctx.votingMethod,
    country: ctx.country,
  });
  return {
    voting: {
      id: v.id,
      status: v.status,
      startsAt: v.startsAt.toISOString(),
      place: v.place,
      meetingPostId: v.meetingPostId,
      meetingChangeSeq: v.meetingChangeSeq,
    },
    ...overview,
  };
}

// ── Attendance list (§6) ───────────────────────────────

async function attendanceRows(votingId: string): Promise<AttendanceRowIn[]> {
  return db
    .select({
      id: attendance.id,
      ownerId: attendance.ownerId,
      status: attendance.status,
      representativeName: attendance.representativeName,
      mandateId: attendance.mandateId,
      checkedInAt: attendance.checkedInAt,
      leftAt: attendance.leftAt,
    })
    .from(attendance)
    .where(eq(attendance.votingId, votingId));
}

/** Verified, active mandates of this voting (for the "Zastúpený" dialog). */
async function verifiedMandates(votingId: string) {
  return db
    .select({
      id: mandates.id,
      fromOwnerId: mandates.fromOwnerId,
      toOwnerName: users.name,
    })
    .from(mandates)
    .leftJoin(users, eq(users.id, mandates.toOwnerId))
    .where(
      and(
        eq(mandates.votingId, votingId),
        eq(mandates.paperDocumentConfirmed, true),
        eq(mandates.isActive, true)
      )
    );
}

export async function getAttendanceList(votingId: string) {
  const v = await loadMeetingVoting(votingId);
  if (!v) return null;
  const [eligible, rows, mandateRows] = await Promise.all([
    eligibleLines(votingId),
    attendanceRows(votingId),
    verifiedMandates(votingId),
  ]);
  const closed = v.status === "closed";
  return {
    lines: buildAttendanceLines(eligible, rows, closed),
    summary: buildAttendanceSummary({ votingId, closed, eligible, rows }),
    mandates: mandateRows,
    writeError: attendanceWriteError(v, new Date()),
  };
}

/** Typed hand-off for the minutes (§10). Data only; VotingMinutesPDF is untouched. */
export async function getMeetingAttendanceSummary(votingId: string) {
  const v = await loadMeetingVoting(votingId);
  if (!v || v.votingType !== "meeting") return null;
  const [eligible, rows] = await Promise.all([eligibleLines(votingId), attendanceRows(votingId)]);
  return buildAttendanceSummary({ votingId, closed: v.status === "closed", eligible, rows });
}

async function assertWritable(votingId: string): Promise<MeetingVoting> {
  const v = await loadMeetingVoting(votingId);
  if (!v) throw new MeetingError("ATTENDANCE_NOT_FOUND", 404);
  const e = attendanceWriteError(v, new Date());
  if (e) throw new MeetingError(e, 409);
  return v;
}

/**
 * Runs an attendance write with the voting row locked FOR SHARE and the
 * write window re-checked on it — same lock order as ballot casts. The close
 * transaction locks the row FOR UPDATE and freezes the list, so no row can be
 * added / changed after (or while) the list is frozen.
 */
async function inWritableVoting<T>(votingId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    const [v] = await tx
      .select({ votingType: votings.votingType, status: votings.status, startsAt: votings.startsAt })
      .from(votings)
      .where(eq(votings.id, votingId))
      .limit(1)
      .for("share");
    if (!v) throw new MeetingError("ATTENDANCE_NOT_FOUND", 404);
    const e = attendanceWriteError(v, new Date());
    if (e) throw new MeetingError(e, 409);
    return fn(tx);
  });
}

export async function recordAttendance(input: {
  votingId: string;
  ownerId: string;
  status: "present" | "represented";
  mandateId?: string | null;
  representativeName?: string | null;
  idCheckMethod?: "photo_id" | "known_in_person";
  note?: string | null;
  actorId: string;
}) {
  await assertWritable(input.votingId);
  // The owner's lines → eligibility + the weight / unit label stored on the row.
  const ownLines = (await eligibleLines(input.votingId)).filter((l) => l.ownerId === input.ownerId);
  if (ownLines.length === 0) {
    throw new MeetingError("ATTENDANCE_NOT_ELIGIBLE", 400);
  }
  const ownWeight = ownLines.reduce((acc, l) => acc + l.weight, 0);
  const ownLabel = ownLines.map((l) => l.unitLabel).join(", ").slice(0, 500);

  let mandateId: string | null = null;
  let representativeName: string | null = null;
  if (input.status === "represented") {
    // §14 ods. 4: only a verified paper PoA for THIS voting from THIS owner.
    if (!input.mandateId) throw new MeetingError("ATTENDANCE_MANDATE_REQUIRED");
    const [m] = await db
      .select({ id: mandates.id, toOwnerName: users.name })
      .from(mandates)
      .leftJoin(users, eq(users.id, mandates.toOwnerId))
      .where(
        and(
          eq(mandates.id, input.mandateId),
          eq(mandates.votingId, input.votingId),
          eq(mandates.fromOwnerId, input.ownerId),
          eq(mandates.paperDocumentConfirmed, true),
          eq(mandates.isActive, true)
        )
      )
      .limit(1);
    if (!m) throw new MeetingError("ATTENDANCE_MANDATE_REQUIRED");
    mandateId = m.id;
    representativeName =
      (input.representativeName?.trim() || m.toOwnerName || "").slice(0, 255) || null;
  }

  const [row] = await inWritableVoting(input.votingId, (tx) =>
    tx
      .insert(attendance)
      .values({
        votingId: input.votingId,
        ownerId: input.ownerId,
        status: input.status,
        mandateId,
        representativeName,
        identifiedById: input.actorId,
        // TODO(decision): default "known in person" keeps door ticking to one tap.
        idCheckMethod: input.idCheckMethod ?? "known_in_person",
        source: "board",
        note: input.note?.trim().slice(0, 500) || null,
        weight: ownWeight,
        unitLabel: ownLabel || null,
      })
      .onConflictDoNothing({ target: [attendance.votingId, attendance.ownerId] })
      .returning({ id: attendance.id })
  );
  if (!row) throw new MeetingError("ATTENDANCE_ALREADY_RECORDED", 409);
  return row;
}

export async function removeAttendance(votingId: string, ownerId: string) {
  await assertWritable(votingId);
  // A ballot recorded for this owner in this voting is bound to the
  // attendance (kiosk adds ballots.attendanceId later; until then any
  // ballot of the owner blocks the undo).
  const [b] = await db
    .select({ id: ballots.id })
    .from(ballots)
    .where(and(eq(ballots.votingId, votingId), eq(ballots.ownerId, ownerId)))
    .limit(1);
  if (b) throw new MeetingError("ATTENDANCE_HAS_BALLOT", 409);
  const deleted = await inWritableVoting(votingId, (tx) =>
    tx
      .delete(attendance)
      .where(and(eq(attendance.votingId, votingId), eq(attendance.ownerId, ownerId)))
      .returning({ id: attendance.id })
  );
  if (deleted.length === 0) throw new MeetingError("ATTENDANCE_NOT_FOUND", 404);
}

export async function setAttendanceLeft(votingId: string, ownerId: string, left: boolean) {
  await assertWritable(votingId);
  const updated = await inWritableVoting(votingId, (tx) =>
    tx
      .update(attendance)
      .set({ leftAt: left ? new Date() : null })
      .where(and(eq(attendance.votingId, votingId), eq(attendance.ownerId, ownerId)))
      .returning({ id: attendance.id })
  );
  if (updated.length === 0) throw new MeetingError("ATTENDANCE_NOT_FOUND", 404);
}

// ── Owner view (§8, §9) ────────────────────────────────

/**
 * What an owner may see about a meeting: their own answer, their own
 * attendance line and aggregate counts — never other owners' names.
 */
export async function getOwnMeetingState(votingId: string, userId: string) {
  const v = await loadMeetingVoting(votingId);
  if (!v || v.votingType !== "meeting") return null;
  const [eligible, rows, rsvpCounts] = await Promise.all([
    eligibleLines(votingId),
    attendanceRows(votingId),
    v.meetingPostId
      ? db
          .select({ status: eventRsvps.status, count: sql<number>`count(*)::int` })
          .from(eventRsvps)
          .where(eq(eventRsvps.postId, v.meetingPostId))
          .groupBy(eventRsvps.status)
      : Promise.resolve([] as { status: RsvpStatus; count: number }[]),
  ]);
  const eligibleOwner = eligible.some((e) => e.ownerId === userId);
  const closed = v.status === "closed";
  const summary = buildAttendanceSummary({ votingId, closed, eligible, rows });
  const own = summary.rows.find((r) => r.ownerId === userId) ?? null;
  const counts = { yes: 0, maybe: 0, no: 0 };
  for (const r of rsvpCounts) counts[r.status] = r.count;

  return {
    votingId: v.id,
    title: v.title,
    status: v.status,
    startsAt: v.startsAt.toISOString(),
    place: v.place,
    postId: v.meetingPostId,
    postActive: v.meetingPostId ? await postIsActive(v.meetingPostId) : false,
    eligible: eligibleOwner,
    myRsvp: v.meetingPostId && eligibleOwner ? await getOwnRsvp(v.meetingPostId, userId) : null,
    myAttendance: own
      ? { state: own.status, representativeName: own.representativeName }
      : null,
    counts,
    attendanceTotals: {
      eligibleOwners: summary.eligibleOwners,
      presentNowOwners: summary.presentNowOwners,
      presentSharePct:
        summary.eligibleWeight > 0
          ? Math.round((summary.presentWeight / summary.eligibleWeight) * 1000) / 10
          : 0,
    },
  };
}

async function postIsActive(postId: string): Promise<boolean> {
  const [p] = await db
    .select({ status: communityPosts.status })
    .from(communityPosts)
    .where(eq(communityPosts.id, postId))
    .limit(1);
  return p?.status === "active";
}

// ── Export (§7) ────────────────────────────────────────

export async function getAttendanceExport(
  votingId: string,
  document: ExportDocument,
  mode: ExportRowMode,
  opts: { residentialOnly?: boolean } = {}
) {
  const v = await loadMeetingVoting(votingId);
  if (!v) return null;
  const root = await getCommunityRoot();
  // Legal content rule: HOA template only until wording sign-off (spec L6).
  if ((getDisplayTemplateSlug(root?.templateSlug) ?? "hoa") !== "hoa" || v.votingType !== "meeting") {
    throw new MeetingError("MEETING_EXPORT_UNAVAILABLE", 400);
  }
  const [eligible, rows] = await Promise.all([eligibleLines(votingId), attendanceRows(votingId)]);
  // "Len byty": hide non-residential units / garages from the ROWS only
  // (unit type from entities.data.unit_type; absent = flat). Totals keep
  // every unit — each NP votes too (SK §14(3)).
  let includeUnit: ((unitId: string) => boolean) | undefined;
  if (opts.residentialOnly && eligible.length > 0) {
    const unitIds = [...new Set(eligible.map((e) => e.unitId))];
    const typed = await db
      .select({ id: entities.id, unitType: sql<string | null>`${entities.data}->>'unit_type'` })
      .from(entities)
      .where(inArray(entities.id, unitIds));
    const nonResidential = new Set(typed.filter((u) => !isResidentialUnit(u.unitType)).map((u) => u.id));
    includeUnit = (unitId) => !nonResidential.has(unitId);
  }
  return {
    voting: {
      title: v.title,
      startsAt: v.startsAt.toISOString(),
      place: v.place,
      country: (root?.country ?? "sk") as Country,
    },
    community: { name: root?.name ?? "" },
    ...buildAttendanceExport({ document, mode, eligible, rows, closed: v.status === "closed", includeUnit }),
  };
}
