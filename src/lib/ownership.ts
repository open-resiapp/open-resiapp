// BYT-20261118-007 — client-safe types + error codes for ownership history,
// transfer, remove-from-community, merge, anonymise and hard delete.
// Server logic: src/lib/ownership.server.ts, src/lib/user-merge.server.ts.
// Every service returns a stable CODE; the UI maps it to
// messages/*.json → OwnerLifecycle.errors.<code>.

import type { UserFkGroup } from "@/lib/user-fk-registry";

export const END_REASONS = [
  "sale",
  "inheritance",
  "gift",
  "removed",
  "merged",
  "correction",
] as const;
export type EndReason = (typeof END_REASONS)[number];

export const TRANSFER_KINDS = ["sale", "inheritance", "gift", "correction"] as const;
export type TransferKind = (typeof TRANSFER_KINDS)[number];

export type LifecycleErrorCode =
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "plan_stale"
  | "not_confirmed"
  | "failed"
  // transfer
  | "transfer_date_in_future"
  | "transfer_date_invalid"
  | "transfer_date_before_start"
  | "transfer_no_sellers"
  | "transfer_seller_not_owner"
  | "transfer_buyer_already_owner"
  | "transfer_buyer_invalid"
  | "share_sum_not_one"
  | "invalid_share"
  // remove / restore
  | "nothing_to_remove"
  | "restore_conflict"
  // merge
  | "merge_same_user"
  | "merge_tombstone"
  | "merge_conflict_open_ballot"
  // anonymise / delete
  | "anonymize_has_current_ownership"
  | "already_anonymized"
  | "user_has_history"
  | "self_action";

/** Block-class conflicts stop the action; warnings are shown and do not. */
export type ImpactBlockerCode =
  | "merge_conflict_open_ballot"
  | "anonymize_has_current_ownership"
  | "user_has_history"
  | "self_action"
  | "merge_tombstone";

export type ImpactWarningCode =
  | "backdated_seller_ballot"
  | "backdated_buyer_missed_voting"
  | "assessments_after_date"
  | "merge_closed_duplicate_ballot"
  | "merge_self_mandate"
  | "merge_membership_overlap"
  | "share_sum_not_one"
  | "account_deactivated"
  | "no_undo";

export interface ImpactLine {
  group: UserFkGroup | "ownership_periods" | "account";
  /** i18n key under OwnerLifecycle.lines.<key> */
  key: string;
  count: number;
}

export interface ImpactNotice<C extends string> {
  code: C;
  /** Interpolation values (voting titles, unit labels, dates). */
  params?: Record<string, string | number>;
}

/**
 * Read-only plan shared by the preview (ImpactSummaryDialog) and the
 * mutation. The mutation recomputes the plan in its transaction and refuses
 * with `plan_stale` when `hash` differs from the one the user confirmed.
 */
export interface ImpactPlan {
  action: "end" | "transfer" | "remove" | "restore" | "merge" | "anonymize" | "hard_delete";
  archive: ImpactLine[];
  move: ImpactLine[];
  keep: ImpactLine[];
  destroy: ImpactLine[];
  blockers: ImpactNotice<ImpactBlockerCode>[];
  warnings: ImpactNotice<ImpactWarningCode>[];
  /** Values for the one-sentence summary (OwnerLifecycle.summary.<action>). */
  summary: Record<string, string | number>;
  hash: string;
}

export type LifecycleResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: LifecycleErrorCode; plan?: ImpactPlan };

export interface OwnershipPeriod {
  membershipId: string;
  unitId: string;
  unitLabel: string;
  role: string;
  shareNum: number;
  shareDen: number;
  validFrom: string;
  validTo: string | null;
  endReason: EndReason | null;
}

export interface UnitOwnerPeriod {
  membershipId: string;
  userId: string;
  name: string;
  role: string;
  shareNum: number;
  shareDen: number;
  validFrom: string;
  validTo: string | null;
  endReason: EndReason | null;
}

/** Today's date (UTC) as YYYY-MM-DD — the `date` column format. */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}
