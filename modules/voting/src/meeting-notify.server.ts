import "server-only";

import { and, eq, gt, inArray, lte } from "drizzle-orm";

import { db } from "@/db";
import { communityNotificationsSent, communityPosts, eventRsvps, users } from "@/db/schema";
import { routing } from "@/i18n/routing";
import {
  sendMeetingChange,
  sendMeetingInvitation,
  sendMeetingReminder,
  type MeetingEmailParams,
} from "@/lib/email";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { signToken } from "@/lib/signed-token.server";
import { timeZoneForCountry } from "@/lib/time-zone";
import type { Country } from "@/types";
import { votings } from "./db/schema";
import { MeetingError, eligibleLines, loadMeetingVoting, type MeetingVoting } from "./attendance";
import { validateNotice } from "./workflow/notice";

// BYT-20261118-001 §4 — meeting e-mails. Every send is preceded by a CLAIM:
// INSERT … ON CONFLICT DO NOTHING RETURNING on the partial unique index
// (post, recipient, kind, change_seq) — two clicks, two replicas or two
// overlapping cron runs can never send the same e-mail twice. A failed SMTP
// send RELEASES its claim (2026-11-18 review), so the next click / cron run
// retries it; a concurrent run that lost the claim race never sends.

type MeetingKind = "meeting_invitation" | "meeting_reminder" | "meeting_change";

export interface MeetingRsvpClaims {
  postId: string;
  userId: string;
}

function appUrl(): string {
  return (
    (process.env.NEXTAUTH_URL || process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")
  );
}

async function claim(postId: string, recipientId: string, kind: MeetingKind, changeSeq: number) {
  const [row] = await db
    .insert(communityNotificationsSent)
    .values({ postId, recipientId, kind, changeSeq })
    .onConflictDoNothing()
    .returning({ id: communityNotificationsSent.id });
  return Boolean(row);
}

/** Undo a claim whose send failed, so a later click / cron run can retry it. */
async function release(postId: string, recipientId: string, kind: MeetingKind, changeSeq: number) {
  await db
    .delete(communityNotificationsSent)
    .where(
      and(
        eq(communityNotificationsSent.postId, postId),
        eq(communityNotificationsSent.recipientId, recipientId),
        eq(communityNotificationsSent.kind, kind),
        eq(communityNotificationsSent.changeSeq, changeSeq)
      )
    );
}

interface Recipient {
  ownerId: string;
  name: string;
  email: string | null;
  unitLabels: string[];
}

async function recipients(votingId: string): Promise<Recipient[]> {
  const lines = await eligibleLines(votingId);
  const byOwner = new Map<string, Recipient>();
  for (const l of lines) {
    const r = byOwner.get(l.ownerId) ?? { ownerId: l.ownerId, name: l.ownerName ?? "", email: null, unitLabels: [] };
    r.unitLabels.push(l.unitLabel);
    byOwner.set(l.ownerId, r);
  }
  const ids = [...byOwner.keys()];
  if (ids.length > 0) {
    const rows = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(inArray(users.id, ids));
    for (const u of rows) {
      const r = byOwner.get(u.id);
      if (r) r.email = u.email || null;
    }
  }
  return [...byOwner.values()];
}

function baseParams(
  v: MeetingVoting,
  r: Recipient,
  timeZone: string,
  locale: string
): MeetingEmailParams {
  return {
    recipientEmail: r.email!,
    recipientName: r.name,
    meetingTitle: v.title,
    meetingDate: v.startsAt,
    meetingPlace: v.place,
    timeZone,
    detailUrl: `${appUrl()}/${locale}/voting/${v.id}`,
    locale,
  };
}

/** Signed answer links (purpose meeting-rsvp, valid until the meeting starts). */
function answerUrls(v: MeetingVoting, userId: string, locale: string) {
  const ttl = v.startsAt.getTime() - Date.now();
  const { token } = signToken<MeetingRsvpClaims>(
    "meeting-rsvp",
    { postId: v.meetingPostId!, userId },
    ttl
  );
  const base = `${appUrl()}/${locale}/schodza/odpoved?t=${encodeURIComponent(token)}`;
  return { yes: `${base}&s=yes`, no: `${base}&s=no`, maybe: `${base}&s=maybe` };
}

async function countryAndZone(): Promise<{ country: Country; timeZone: string }> {
  const root = await getCommunityRoot();
  const country = (root?.country ?? "sk") as Country;
  return { country, timeZone: timeZoneForCountry(country) };
}

/**
 * "Odoslať pozvánku": one invitation per eligible owner with an e-mail; a
 * second click reaches only owners not invited yet. Owners without e-mail
 * are returned so the board delivers on paper. `noticeWarning` is the
 * 7-full-day rule (workflow/notice.ts) evaluated for today — informative,
 * the app never claims the e-mail is the statutory notice.
 */
export async function sendMeetingInvitations(votingId: string, locale: string = routing.defaultLocale) {
  const v = await loadMeetingVoting(votingId);
  if (!v) throw new MeetingError("ATTENDANCE_NOT_FOUND", 404);
  if (!v.meetingPostId) throw new MeetingError("MEETING_NOT_ANNOUNCED");
  if (v.status !== "active") throw new MeetingError("MEETING_VOTING_NOT_ACTIVE");
  if (v.startsAt.getTime() <= Date.now()) throw new MeetingError("MEETING_IN_PAST");

  const { country, timeZone } = await countryAndZone();
  const notice = validateNotice({
    country,
    announcedAt: new Date(),
    startsAt: v.startsAt,
    endsAt: v.endsAt,
    timeZone,
  });

  const list = await recipients(votingId);
  let sent = 0;
  let alreadyInvited = 0;
  const failed: { ownerId: string; name: string }[] = [];
  const withoutEmail: { ownerId: string; name: string; units: string[] }[] = [];
  for (const r of list) {
    if (!r.email) {
      withoutEmail.push({ ownerId: r.ownerId, name: r.name, units: r.unitLabels });
      continue;
    }
    // Sign before claiming: a missing secret must not burn the claim.
    const urls = answerUrls(v, r.ownerId, locale);
    if (!(await claim(v.meetingPostId, r.ownerId, "meeting_invitation", 0))) {
      alreadyInvited += 1;
      continue;
    }
    const ok = await sendMeetingInvitation({
      ...baseParams(v, r, timeZone, locale),
      answerUrls: urls,
    });
    if (ok) sent += 1;
    else {
      await release(v.meetingPostId, r.ownerId, "meeting_invitation", 0);
      failed.push({ ownerId: r.ownerId, name: r.name });
    }
  }
  return {
    sent,
    alreadyInvited,
    failed,
    withoutEmail,
    noticeWarning: notice?.code === "NOTICE_LEAD_TIME_TOO_SHORT" ? { minDate: notice.minDate ?? null } : null,
  };
}

/** Date / place change or cancellation — one e-mail per owner per change. */
export async function sendMeetingChanges(
  votingId: string,
  opts: { cancelled: boolean; locale?: string }
) {
  const v = await loadMeetingVoting(votingId);
  if (!v) throw new MeetingError("ATTENDANCE_NOT_FOUND", 404);
  if (!v.meetingPostId) throw new MeetingError("MEETING_NOT_ANNOUNCED");
  const locale = opts.locale ?? routing.defaultLocale;
  const { timeZone } = await countryAndZone();
  const list = await recipients(votingId);
  let sent = 0;
  const failed: { ownerId: string; name: string }[] = [];
  const canAnswer = !opts.cancelled && v.startsAt.getTime() > Date.now();
  for (const r of list) {
    if (!r.email) continue;
    const urls = canAnswer ? answerUrls(v, r.ownerId, locale) : undefined;
    if (!(await claim(v.meetingPostId, r.ownerId, "meeting_change", v.meetingChangeSeq))) continue;
    const ok = await sendMeetingChange({
      ...baseParams(v, r, timeZone, locale),
      answerUrls: urls,
      cancelled: opts.cancelled,
    });
    if (ok) sent += 1;
    else {
      await release(v.meetingPostId, r.ownerId, "meeting_change", v.meetingChangeSeq);
      failed.push({ ownerId: r.ownerId, name: r.name });
    }
  }
  return { sent, failed };
}

/**
 * Cron (src/app/api/cron/community): reminders for meetings starting within
 * 24 h, to every eligible owner EXCEPT those who answered "no" (yes, maybe
 * and no answer). Claimed per (post, owner) — overlapping runs send once.
 */
export async function runMeetingReminders(now: Date = new Date()): Promise<number> {
  const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const posts = await db
    .select({ postId: communityPosts.id, votingId: votings.id })
    .from(communityPosts)
    .innerJoin(votings, eq(votings.meetingPostId, communityPosts.id))
    .where(
      and(
        eq(communityPosts.status, "active"),
        eq(communityPosts.eventKind, "owners_meeting"),
        gt(communityPosts.eventDate, now),
        lte(communityPosts.eventDate, windowEnd),
        eq(votings.status, "active")
      )
    );
  if (posts.length === 0) return 0;

  const locale = routing.defaultLocale;
  const { timeZone } = await countryAndZone();
  let sent = 0;
  for (const p of posts) {
    const v = await loadMeetingVoting(p.votingId);
    if (!v || !v.meetingPostId) continue;
    const answers = await db
      .select({ userId: eventRsvps.userId, status: eventRsvps.status })
      .from(eventRsvps)
      .where(eq(eventRsvps.postId, p.postId));
    const byUser = new Map(answers.map((a) => [a.userId, a.status]));
    for (const r of await recipients(v.id)) {
      const answer = byUser.get(r.ownerId) ?? null;
      if (!r.email || answer === "no") continue;
      const urls = answerUrls(v, r.ownerId, locale);
      // Keyed by the CURRENT change counter: after a date change the owner
      // gets a reminder for the new date too (one per change, not one ever).
      if (!(await claim(p.postId, r.ownerId, "meeting_reminder", v.meetingChangeSeq))) continue;
      const ok = await sendMeetingReminder({
        ...baseParams(v, r, timeZone, locale),
        answerUrls: urls,
        answered: answer !== null,
      });
      if (ok) sent += 1;
      else await release(p.postId, r.ownerId, "meeting_reminder", v.meetingChangeSeq);
    }
  }
  return sent;
}
