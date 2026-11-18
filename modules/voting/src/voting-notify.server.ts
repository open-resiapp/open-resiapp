import "server-only";

// Voting announcement notifications (push + e-mail fallback). Fired once per
// announcement — from the "announce" transition (routes/api/votings/id.ts)
// and from createVoting when a voting is created already active. Not live,
// no polling: one recipient query, one push call, one e-mail per voter who
// has no push.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { db } from "@/db";
import { communityNotificationsSent, notificationPreferences, users } from "@/db/schema";
import { routing } from "@/i18n/routing";
import { sendPushToAll } from "@/lib/push";
import { isSmtpConfigured, sendVotingStartedNotice } from "@/lib/email";
import { pushSubscriberIds } from "@/lib/posts";
import { getCommunityRoot } from "@/lib/legacy-compat";
import { timeZoneForCountry } from "@/lib/time-zone";
import type { Country } from "@/types";
import { listEligibleVoters } from "./participation";

interface AnnouncedVoting {
  id: string;
  title: string;
  endsAt: Date;
}

/**
 * Push AND e-mail fallback to the voters ELIGIBLE in this voting
 * (participation.ts loadLiveEligible: active voting-role memberships —
 * owner / družstvo member — on non-archived entities in the scope subtree).
 * Errors are logged, never thrown: a notification must not fail an announce.
 */
export async function notifyVotingStarted(voting: AnnouncedVoting): Promise<void> {
  try {
    const eligible = await listEligibleVoters(voting.id);
    const voterIds = [...new Set(eligible.map((r) => r.ownerId))];
    // Never call sendPushToAll with an empty list — that means "everyone".
    if (voterIds.length === 0) return;
    const t = await getTranslations({ locale: routing.defaultLocale, namespace: "Voting" });
    sendPushToAll(
      { title: t("pushNewVotingTitle"), body: voting.title, url: `/voting/${voting.id}` },
      "votingStarted",
      voterIds
    ).catch(() => {});
    await sendVotingEmailFallback(voting, voterIds);
  } catch (err) {
    console.error("[voting] announcement notification failed:", err);
  }
}

/**
 * Voters without a push subscription get the announcement by e-mail —
 * otherwise owners / members without a smartphone never learn of the vote.
 * Respects the per-user `votingStarted` preference (default on) and skips
 * paper-only owners (the board delivers on paper). Dedupe: one row per
 * (voting, recipient) in community_notifications_sent (kind voting_started),
 * claimed with ON CONFLICT DO NOTHING so replicas / a re-announce after a
 * reopen never double-send; the claim is released when the send fails.
 */
export async function sendVotingEmailFallback(
  voting: AnnouncedVoting,
  voterIds: string[]
): Promise<{ sent: number; failed: number; skippedNoSmtp: boolean }> {
  if (voterIds.length === 0) return { sent: 0, failed: 0, skippedNoSmtp: false };
  if (!isSmtpConfigured()) return { sent: 0, failed: 0, skippedNoSmtp: true };

  const candidates = await db
    .select({ id: users.id, name: users.name, email: users.email, prefOn: notificationPreferences.votingStarted })
    .from(users)
    .leftJoin(notificationPreferences, eq(notificationPreferences.userId, users.id))
    .where(
      and(
        inArray(users.id, voterIds),
        eq(users.isActive, true),
        eq(users.status, "active"),
        eq(users.paperOnly, false),
        isNotNull(users.email)
      )
    );
  const pushUsers = await pushSubscriberIds(candidates.map((c) => c.id));

  const root = await getCommunityRoot();
  const country = (root?.country ?? "sk") as Country;
  // TODO(decision): users have no stored locale — instance default language.
  const locale = routing.defaultLocale;
  const endsAtLabel = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: timeZoneForCountry(country),
  }).format(voting.endsAt);
  const base = (process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "");

  let sent = 0;
  let failed = 0;
  for (const c of candidates) {
    if (!c.email || c.prefOn === false || pushUsers.has(c.id)) continue;
    const [claim] = await db
      .insert(communityNotificationsSent)
      .values({ votingId: voting.id, recipientId: c.id, kind: "voting_started" })
      .onConflictDoNothing()
      .returning({ id: communityNotificationsSent.id });
    if (!claim) continue; // already sent (other replica / earlier announce)

    const status = await sendVotingStartedNotice({
      recipientEmail: c.email,
      recipientName: c.name,
      votingTitle: voting.title,
      endsAtLabel,
      votingUrl: `${base}/${locale}/voting/${voting.id}`,
      buildingName: root?.name ?? null,
      locale,
    });
    if (status === "sent") {
      sent += 1;
    } else {
      failed += 1;
      await db
        .delete(communityNotificationsSent)
        .where(eq(communityNotificationsSent.id, claim.id));
    }
  }
  return { sent, failed, skippedNoSmtp: false };
}
