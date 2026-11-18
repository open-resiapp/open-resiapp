import "server-only";

import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { entities, memberships, users } from "@/db/schema";
import { sendReadingReminder } from "@/lib/email";
import { accountingNotificationsSent, readingRounds } from "../db/schema";
import { isReadingYearLocked } from "./reading-lock";
import { getBoardRoundData, isUnitMissing } from "./reading-rounds";

// Pre-deadline reminder for reading rounds (BYT-20261118-006), run by the
// daily cron route /api/cron/accounting-readings. Multi-replica safe: no
// in-memory state; each (round, recipient) is CLAIMED with
// INSERT … ON CONFLICT DO NOTHING RETURNING on the partial unique index
// (kind, round_id, recipient_id) and mailed only when this call inserted
// the row. A failed send releases its own claim so the next run retries.
// Only the reminder is mailed — no "round opened" e-mail (decision).

export interface ReminderRunSummary {
  rounds: number;
  sent: number;
  skippedAlreadySent: number;
  failed: number;
}

function appUrl(): string {
  return process.env.NEXTAUTH_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

export async function runReadingReminders(now = new Date()): Promise<ReminderRunSummary> {
  // Rounds open for owners whose deadline is ahead and inside the
  // reminder window (deadline − reminderDaysBefore days ≤ now).
  const rounds = await db
    .select({
      id: readingRounds.id,
      entityId: readingRounds.entityId,
      year: readingRounds.year,
      deadlineAt: readingRounds.deadlineAt,
      reminderDaysBefore: readingRounds.reminderDaysBefore,
      buildingName: entities.name,
    })
    .from(readingRounds)
    .innerJoin(entities, eq(entities.id, readingRounds.entityId))
    .where(
      and(
        isNull(readingRounds.closedForOwnersAt),
        lte(readingRounds.opensAt, now),
        gte(readingRounds.deadlineAt, now),
        sql`${readingRounds.deadlineAt} - make_interval(days => ${readingRounds.reminderDaysBefore}) <= ${now}`
      )
    );

  const summary: ReminderRunSummary = {
    rounds: 0,
    sent: 0,
    skippedAlreadySent: 0,
    failed: 0,
  };

  for (const round of rounds) {
    // reminderDaysBefore = 0 ⇒ no reminder.
    if (round.reminderDaysBefore === 0) continue;
    if (await isReadingYearLocked(round.entityId, round.year)) continue;
    summary.rounds += 1;

    const data = await getBoardRoundData(round.entityId, round.year);
    const missingUnitIds = data.units.filter(isUnitMissing).map((u) => u.unitEntityId);
    if (missingUnitIds.length === 0) continue;

    // Active owners of the incomplete units, one mail per owner.
    const recipients = await db
      .selectDistinct({ userId: users.id, name: users.name, email: users.email })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          inArray(memberships.entityId, missingUnitIds),
          eq(memberships.role, "owner"),
          eq(memberships.status, "active")
        )
      );

    for (const r of recipients) {
      if (!r.email) continue;
      const claimed = await db
        .insert(accountingNotificationsSent)
        .values({
          entityId: round.entityId,
          kind: "reading_reminder",
          recipientId: r.userId,
          roundId: round.id,
        })
        .onConflictDoNothing()
        .returning({ id: accountingNotificationsSent.id });
      if (claimed.length === 0) {
        summary.skippedAlreadySent += 1;
        continue;
      }
      // TODO(decision): users carry no locale column — reminders go out in
      // the default locale (routing.defaultLocale) until one exists.
      const ok = await sendReadingReminder({
        recipientEmail: r.email,
        recipientName: r.name,
        buildingName: round.buildingName,
        year: round.year,
        deadline: round.deadlineAt,
        url: `${appUrl()}/moje-platby#odpocty`,
      });
      if (ok) {
        summary.sent += 1;
      } else {
        summary.failed += 1;
        await db
          .delete(accountingNotificationsSent)
          .where(eq(accountingNotificationsSent.id, claimed[0].id));
      }
    }
  }
  return summary;
}
