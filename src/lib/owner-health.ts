// BYT-20261118-003 — client-safe payload of the "Na riešenie" + "Kontrola
// údajov" sections on /owners. Built by owner-health.server.ts from the same
// rows the Vlastníci page loads; engines: owner-queue.ts, owner-checks.ts.

import type { CheckCode, CheckFinding } from "@/lib/owner-checks";
import type { QueueItem } from "@/lib/owner-queue";

export interface QueueEntry extends QueueItem {
  name: string;
  email: string | null;
  flatNumbers: string[];
  /** Set when the board marked the item as handled. */
  dismissal: { id: string; handledAt: string } | null;
}

export interface CheckEntry extends CheckFinding {
  /** Unit labels (flat numbers) in the order of `unitIds`. */
  unitLabels: string[];
  /** Names in the order of `userIds`. */
  names: string[];
  dismissal: { id: string; handledAt: string } | null;
}

export interface OwnerHealthData {
  /** Open (not dismissed) queue items, priority order. */
  queue: QueueEntry[];
  /** Items the board marked as handled — "Zobraziť vyriešené". */
  queueDismissed: QueueEntry[];
  checks: CheckEntry[];
  checksDismissed: CheckEntry[];
  /** Open queue items counted in the nav badge (excludes informative codes). */
  badgeCount: number;
  /** BSM / ordinal checks ran (SK/CZ HOA community). */
  lvChecks: boolean;
}

export const EMPTY_OWNER_HEALTH: OwnerHealthData = {
  queue: [],
  queueDismissed: [],
  checks: [],
  checksDismissed: [],
  badgeCount: 0,
  lvChecks: false,
};

export type DismissErrorCode = "forbidden" | "not_found" | "failed";

export type { CheckCode };
