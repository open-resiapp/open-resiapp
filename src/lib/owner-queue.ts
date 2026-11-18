// BYT-20261118-003 — "Na riešenie": the owner to-do queue of the board.
//
// Client-safe and pure: no DB, no Date.now(), no prose. Input = people of the
// community as the Vlastníci page already loads them (OwnerRow) plus their
// last sign-in; output = one item per person with a stable `code` that the UI
// maps to `OwnerHealth.queue.<code>.*`. Items are derived at read time from
// live data, so an item disappears as soon as its condition does (no job, no
// write on read). The board can hide an item ("vyriešené"); that hides only
// the exact `fingerprint` — a changed situation yields a new fingerprint.

import type { OwnerStatus } from "@/lib/owners-board";

/** Invitation not finished after this many days → queue item. */
export const INVITE_UNFINISHED_AFTER_DAYS = 7;
/** Active account with no sign-in this many days after creation → queue item. */
export const NEVER_LOGGED_IN_AFTER_DAYS = 14;
/** Last sign-in older than this many days → low-priority queue item. */
export const INACTIVE_AFTER_DAYS = 365;
/**
 * Release date of last-login tracking (users.last_login_at). Accounts that
 * existed before it have NULL without meaning "never" — they are not flagged
 * `never_logged_in`; the profile shows "bez záznamu (sledujeme od …)".
 */
export const LAST_LOGIN_TRACKING_SINCE = "2026-11-18T00:00:00.000Z";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Priority order (most urgent first). */
export const QUEUE_CODES = [
  "registration_pending",
  "missing_email",
  "invite_unfinished",
  "never_logged_in",
  "inactive_long",
] as const;
export type QueueCode = (typeof QUEUE_CODES)[number];

/**
 * Codes counted in the nav badge and on Domov. `inactive_long` is
 * informative (owners may use paper on purpose) — listed, collapsed, never
 * counted.
 */
export const QUEUE_BADGE_CODES: readonly QueueCode[] = [
  "registration_pending",
  "missing_email",
  "invite_unfinished",
  "never_logged_in",
];

export interface QueuePerson {
  id: string;
  status: OwnerStatus;
  deactivated: boolean;
  email: string | null;
  /** Number of units the person owns / is linked to. */
  flatCount: number;
  /** ISO — users.created_at. */
  createdAt: string;
  /** Latest open invitation (status = invited). */
  invite: { id: string; sentAt: string; expiresAt: string; expired: boolean } | null;
  /** ISO — users.last_login_at, null when no sign-in was recorded. */
  lastLoginAt: string | null;
}

export interface QueueItem {
  code: QueueCode;
  userId: string;
  /** Stable key of the facts behind the item (dismissals match on it). */
  fingerprint: string;
  /** ISO date the reason sentence refers to (registered / invited / last login). */
  since: string | null;
  /** invite_unfinished only: the invitation is past its expiry. */
  expired?: boolean;
  /** invite_unfinished only: no e-mail → resend as printed QR. */
  qr?: boolean;
}

function candidate(p: QueuePerson, now: number): QueueItem | null {
  const createdAt = Date.parse(p.createdAt);

  if (p.status === "pending") {
    return {
      code: "registration_pending",
      userId: p.id,
      fingerprint: `registration_pending:${p.id}`,
      since: p.createdAt,
    };
  }

  if (p.status === "no_account" && !p.email && p.flatCount > 0) {
    return {
      code: "missing_email",
      userId: p.id,
      fingerprint: `missing_email:${p.id}`,
      since: null,
    };
  }

  if (p.status === "invited" && p.invite) {
    const sent = Date.parse(p.invite.sentAt);
    const stale = now - sent >= INVITE_UNFINISHED_AFTER_DAYS * DAY_MS;
    if (p.invite.expired || stale) {
      return {
        code: "invite_unfinished",
        userId: p.id,
        // A new invitation = a new id = a new item, even after a dismissal.
        fingerprint: `invite_unfinished:${p.invite.id}`,
        since: p.invite.expired ? p.invite.expiresAt : p.invite.sentAt,
        expired: p.invite.expired,
        qr: !p.email,
      };
    }
    return null;
  }

  if (p.status === "active" && !p.deactivated) {
    const since = Date.parse(LAST_LOGIN_TRACKING_SINCE);
    if (p.lastLoginAt === null) {
      if (createdAt >= since) {
        return now - createdAt >= NEVER_LOGGED_IN_AFTER_DAYS * DAY_MS
          ? {
              code: "never_logged_in",
              userId: p.id,
              fingerprint: `never_logged_in:${p.id}`,
              since: p.createdAt,
            }
          : null;
      }
      // Account older than the tracking: NULL means "no record", not
      // "never". Flag as inactive only once tracking has run long enough.
      return now - since >= INACTIVE_AFTER_DAYS * DAY_MS
        ? {
            code: "inactive_long",
            userId: p.id,
            fingerprint: `inactive_long:${p.id}:none`,
            since: null,
          }
        : null;
    }
    const last = Date.parse(p.lastLoginAt);
    if (now - last >= INACTIVE_AFTER_DAYS * DAY_MS) {
      return {
        code: "inactive_long",
        userId: p.id,
        // Signing in again and lapsing again = a new item.
        fingerprint: `inactive_long:${p.id}:${p.lastLoginAt.slice(0, 10)}`,
        since: p.lastLoginAt,
      };
    }
  }
  return null;
}

/**
 * At most ONE item per person (the highest-priority condition), sorted by
 * code priority, then oldest first.
 */
export function computeOwnerQueue(people: readonly QueuePerson[], now: Date): QueueItem[] {
  const t = now.getTime();
  const items: QueueItem[] = [];
  for (const p of people) {
    const item = candidate(p, t);
    if (item) items.push(item);
  }
  const rank = (c: QueueCode) => QUEUE_CODES.indexOf(c);
  return items.sort(
    (a, b) =>
      rank(a.code) - rank(b.code) ||
      (a.since ?? "").localeCompare(b.since ?? "") ||
      a.userId.localeCompare(b.userId)
  );
}

/** Items that count towards the nav badge / Domov row. */
export function countBadgeItems(items: readonly Pick<QueueItem, "code">[]): number {
  return items.filter((i) => QUEUE_BADGE_CODES.includes(i.code)).length;
}

/** True when the last-login value predates tracking (show "bez záznamu"). */
export function lastLoginUnknown(createdAt: string, lastLoginAt: string | null): boolean {
  return lastLoginAt === null && Date.parse(createdAt) < Date.parse(LAST_LOGIN_TRACKING_SINCE);
}
