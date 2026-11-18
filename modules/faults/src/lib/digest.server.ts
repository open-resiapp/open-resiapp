import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";

import { daysOpen, isoWeek, STALE_DAYS } from "../engine/transitions";
import { faultNotificationsSent, faults } from "../db/schema";
import { listFaultManagers } from "./catalogs.server";
import { sendFaultStaleDigest } from "./email.server";

// Weekly stale digest (BYT-20261118-004 "Notifications → stale_digest").
// Called by POST /api/cron/faults (cron sidecar, Monday 07:00). Multi-run
// safe: each (fault, recipient) is CLAIMED with insert … on conflict do
// nothing on (kind, recipient, '<faultId>:<ISO week>') before any e-mail;
// only claimed rows are mailed. Repeat suppression: a (fault, recipient)
// that got a digest in the last 30 days is skipped (decided 2026-11-18:
// per recipient, so a newly assigned user is told right away).
// No DDL, no loops, short statements.

function appUrl(): string {
  return process.env.NEXTAUTH_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

export interface DigestResult {
  staleFaults: number;
  recipients: number;
  emailsSent: number;
  claimsReleased: number;
}

export async function runStaleDigest(now: Date = new Date()): Promise<DigestResult> {
  const stale = await db
    .select({
      id: faults.id,
      rootId: faults.rootEntityId,
      title: faults.title,
      createdAt: faults.createdAt,
      assigneeUserId: faults.assigneeUserId,
    })
    .from(faults)
    .where(
      and(
        inArray(faults.status, ["new", "in_progress"]),
        sql`${faults.createdAt} < ${now}::timestamp - ${sql.raw(`interval '${STALE_DAYS} days'`)}`
      )
    );
  if (stale.length === 0) return { staleFaults: 0, recipients: 0, emailsSent: 0, claimsReleased: 0 };

  // Recipients per fault: assignee user, else every fault manager of the
  // community (unassigned or contractor-assigned).
  const managersByRoot = new Map<string, string[]>();
  const pairs: { faultId: string; recipientId: string }[] = [];
  for (const f of stale) {
    if (f.assigneeUserId) {
      pairs.push({ faultId: f.id, recipientId: f.assigneeUserId });
      continue;
    }
    let managers = managersByRoot.get(f.rootId);
    if (!managers) {
      managers = (await listFaultManagers(f.rootId)).map((u) => u.id);
      managersByRoot.set(f.rootId, managers);
    }
    for (const m of managers) pairs.push({ faultId: f.id, recipientId: m });
  }
  if (pairs.length === 0) return { staleFaults: stale.length, recipients: 0, emailsSent: 0, claimsReleased: 0 };

  // Skip pairs digested within the last 30 days.
  const recent = await db
    .select({ faultId: faultNotificationsSent.faultId, recipientId: faultNotificationsSent.recipientId })
    .from(faultNotificationsSent)
    .where(
      and(
        eq(faultNotificationsSent.kind, "stale_digest"),
        inArray(faultNotificationsSent.faultId, stale.map((f) => f.id)),
        sql`${faultNotificationsSent.sentAt} > ${now}::timestamp - ${sql.raw(`interval '${STALE_DAYS} days'`)}`
      )
    );
  const recentKeys = new Set(recent.map((r) => `${r.faultId}:${r.recipientId}`));
  const due = pairs.filter((p) => !recentKeys.has(`${p.faultId}:${p.recipientId}`));
  if (due.length === 0) return { staleFaults: stale.length, recipients: 0, emailsSent: 0, claimsReleased: 0 };

  // Claim. Only rows actually inserted are ours to send.
  const week = isoWeek(now);
  const claimed = await db
    .insert(faultNotificationsSent)
    .values(
      due.map((p) => ({
        kind: "stale_digest" as const,
        faultId: p.faultId,
        recipientId: p.recipientId,
        dedupeKey: `${p.faultId}:${week}`,
        sentAt: now,
      }))
    )
    .onConflictDoNothing({
      target: [
        faultNotificationsSent.kind,
        faultNotificationsSent.recipientId,
        faultNotificationsSent.dedupeKey,
      ],
    })
    .returning({
      id: faultNotificationsSent.id,
      faultId: faultNotificationsSent.faultId,
      recipientId: faultNotificationsSent.recipientId,
    });

  const byRecipient = new Map<string, { claimIds: string[]; faultIds: string[] }>();
  for (const c of claimed) {
    const e = byRecipient.get(c.recipientId) ?? { claimIds: [], faultIds: [] };
    e.claimIds.push(c.id);
    e.faultIds.push(c.faultId);
    byRecipient.set(c.recipientId, e);
  }
  if (byRecipient.size === 0) return { staleFaults: stale.length, recipients: 0, emailsSent: 0, claimsReleased: 0 };

  const recipients = await db
    .select({ id: users.id, email: users.email, name: users.name, status: users.status })
    .from(users)
    .where(inArray(users.id, [...byRecipient.keys()]));
  const faultById = new Map(stale.map((f) => [f.id, f]));

  let emailsSent = 0;
  let claimsReleased = 0;
  for (const r of recipients) {
    const entry = byRecipient.get(r.id)!;
    let ok = false;
    if (r.email && r.status === "active") {
      ok = await sendFaultStaleDigest({
        recipientEmail: r.email,
        recipientName: r.name,
        faults: entry.faultIds.map((id) => {
          const f = faultById.get(id)!;
          return { title: f.title, days: daysOpen(f.createdAt, now), url: `${appUrl()}/poruchy/${id}` };
        }),
        listUrl: `${appUrl()}/poruchy?stare=1`,
      });
    }
    if (ok) {
      emailsSent++;
    } else {
      // Release the claims so next week retries.
      await db.delete(faultNotificationsSent).where(inArray(faultNotificationsSent.id, entry.claimIds));
      claimsReleased += entry.claimIds.length;
    }
  }
  return { staleFaults: stale.length, recipients: byRecipient.size, emailsSent, claimsReleased };
}
