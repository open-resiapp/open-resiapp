import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { communityPosts } from "@/db/schema";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { ConfirmationUnavailableError, verifyToken } from "@/lib/signed-token.server";
import { timeZoneForCountry } from "@/lib/time-zone";
import type { Country } from "@/types";
import { MeetingError, getOwnRsvp, loadMeetingVotingByPost, setMeetingRsvp } from "./attendance";
import type { MeetingRsvpClaims } from "./meeting-notify.server";
import { meetingRsvpWriteError, type MeetingRsvpErrorCode, type RsvpStatus } from "./workflow/attendance";

// BYT-20261118-001 §3 — the one-click answer from the e-mail. The token
// (purpose meeting-rsvp, claims { postId, userId }) can do exactly one thing:
// set or clear THAT user's answer on THAT meeting post, until the meeting
// starts. It creates no session and shows nothing but the recipient's own
// state. Rendering the page (GET — what mail scanners do) never writes.

export type MeetingTokenView =
  | { status: "invalid" | "expired" | "closed" | "unavailable" }
  | {
      status: "ready";
      title: string;
      startsAt: string;
      place: string | null;
      timeZone: string;
      myRsvp: RsvpStatus | null;
    };

function check(token: unknown):
  | { ok: true; claims: MeetingRsvpClaims }
  | { ok: false; code: MeetingRsvpErrorCode | "UNAVAILABLE" } {
  try {
    const v = verifyToken<MeetingRsvpClaims>("meeting-rsvp", token);
    if (!v.ok) {
      return { ok: false, code: v.error === "TOKEN_EXPIRED" ? "MEETING_RSVP_TOKEN_EXPIRED" : "MEETING_RSVP_TOKEN_INVALID" };
    }
    if (typeof v.claims.postId !== "string" || typeof v.claims.userId !== "string") {
      return { ok: false, code: "MEETING_RSVP_TOKEN_INVALID" };
    }
    return { ok: true, claims: v.claims };
  } catch (e) {
    if (e instanceof ConfirmationUnavailableError) return { ok: false, code: "UNAVAILABLE" };
    throw e;
  }
}

export async function describeMeetingRsvpToken(token: string | null): Promise<MeetingTokenView> {
  const c = check(token);
  if (!c.ok) {
    return {
      status:
        c.code === "UNAVAILABLE" ? "unavailable" : c.code === "MEETING_RSVP_TOKEN_EXPIRED" ? "expired" : "invalid",
    };
  }
  const [post] = await db
    .select({
      status: communityPosts.status,
      eventDate: communityPosts.eventDate,
      eventKind: communityPosts.eventKind,
    })
    .from(communityPosts)
    .where(eq(communityPosts.id, c.claims.postId))
    .limit(1);
  const voting = post ? await loadMeetingVotingByPost(c.claims.postId) : null;
  if (!post || post.eventKind !== "owners_meeting" || !voting) return { status: "invalid" };
  if (meetingRsvpWriteError(post, new Date())) return { status: "closed" };
  const root = await getCommunityRoot();
  return {
    status: "ready",
    title: voting.title,
    startsAt: voting.startsAt.toISOString(),
    place: voting.place,
    timeZone: timeZoneForCountry((root?.country ?? "sk") as Country),
    myRsvp: await getOwnRsvp(c.claims.postId, c.claims.userId),
  };
}

/** POST /api/meeting-rsvp — body { token, status: yes|no|maybe|null }. */
export async function answerWithToken(
  token: unknown,
  status: RsvpStatus | null
): Promise<{ ok: true; status: RsvpStatus | null } | { ok: false; code: string; httpStatus: number }> {
  const c = check(token);
  if (!c.ok) {
    return c.code === "UNAVAILABLE"
      ? { ok: false, code: "CONFIRMATION_UNAVAILABLE", httpStatus: 503 }
      : { ok: false, code: c.code, httpStatus: 400 };
  }
  try {
    const r = await setMeetingRsvp({
      postId: c.claims.postId,
      userId: c.claims.userId,
      status,
      source: "email_link",
    });
    return { ok: true, status: r.status };
  } catch (e) {
    if (e instanceof MeetingError) return { ok: false, code: e.code, httpStatus: e.status };
    throw e;
  }
}
