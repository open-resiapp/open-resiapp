// BYT-20261118-007 — ONE registry of every foreign key to users.id.
//
// Every FK column that points at users.id gets exactly one merge strategy
// and one retention flag. Merge (src/lib/user-merge.server.ts), hard delete
// and the impact planner all read this list, so preview and execution cannot
// drift, and a new FK without an entry is caught by
// `findUnregisteredUserFks()` (compares against information_schema, read-only).
//
// Pure data — no DB access here; client-safe (the impact dialog maps
// `group` to i18n labels).
//
// Strategies:
//   repoint          UPDATE t SET col = survivor WHERE col = loser
//   repoint-dedupe   like repoint, but rows of the loser that would collide
//                    with a survivor row on `uniqueWith` are deleted first
//                    (settings / dedupe history, never statutory records)
//   single-survivor  unique(user_id): the survivor's row wins, the loser's
//                    row is deleted; moved when the survivor has none
//   drop             delete the loser's rows (credentials: re-authorise)
//   custom           handled explicitly in user-merge.server.ts (memberships,
//                    ballots, mandates, RSVPs, board members, aliases)
//
// `retained`: the row is a statutory / history record (ownership, voting,
// accounting, consent, authored content, audit). A user with any retained
// row can NOT be hard-deleted (409 user_has_history) — remove / anonymise
// instead. Non-retained rows (credentials, settings, dedupe state) are
// removed with the user by the FK cascade / set null.

export type UserFkMergeStrategy =
  | { kind: "repoint" }
  | { kind: "repoint-dedupe"; uniqueWith: string[] }
  | { kind: "single-survivor" }
  | { kind: "drop" }
  | { kind: "custom" };

export type UserFkGroup =
  | "ownership"
  | "voting"
  | "accounting"
  | "content"
  | "consent"
  | "audit"
  | "meetings"
  | "credentials"
  | "settings"
  | "notifications";

export interface UserFkEntry {
  table: string;
  column: string;
  onDelete: "cascade" | "set null" | "restrict" | "no action";
  merge: UserFkMergeStrategy;
  retained: boolean;
  group: UserFkGroup;
}

const repoint = { kind: "repoint" } as const;
const custom = { kind: "custom" } as const;
const drop = { kind: "drop" } as const;
const single = { kind: "single-survivor" } as const;
const dedupe = (...uniqueWith: string[]) => ({ kind: "repoint-dedupe", uniqueWith }) as const;

export const USER_FK_REGISTRY: readonly UserFkEntry[] = [
  // ── Ownership ──
  { table: "memberships", column: "user_id", onDelete: "cascade", merge: custom, retained: true, group: "ownership" },
  { table: "memberships", column: "ended_by_id", onDelete: "set null", merge: repoint, retained: false, group: "audit" },
  { table: "ownership_transfers", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "ownership" },
  { table: "board_members", column: "user_id", onDelete: "no action", merge: custom, retained: true, group: "ownership" },
  { table: "users", column: "merged_into_user_id", onDelete: "restrict", merge: repoint, retained: true, group: "audit" },
  { table: "user_merges", column: "from_user_id", onDelete: "restrict", merge: custom, retained: true, group: "audit" },
  { table: "user_merges", column: "into_user_id", onDelete: "restrict", merge: repoint, retained: true, group: "audit" },
  { table: "user_merges", column: "actor_user_id", onDelete: "set null", merge: repoint, retained: true, group: "audit" },

  // ── Voting (§9 ods. 5 písm. a zák. 182/1993 — kept without end date) ──
  { table: "mod_voting_ballots", column: "owner_id", onDelete: "restrict", merge: custom, retained: true, group: "voting" },
  { table: "mod_voting_ballots", column: "recorded_by_id", onDelete: "set null", merge: repoint, retained: true, group: "voting" },
  { table: "mod_voting_mandates", column: "from_owner_id", onDelete: "restrict", merge: custom, retained: true, group: "voting" },
  { table: "mod_voting_mandates", column: "to_owner_id", onDelete: "restrict", merge: custom, retained: true, group: "voting" },
  { table: "mod_voting_mandates", column: "verified_by_admin_id", onDelete: "set null", merge: repoint, retained: true, group: "voting" },
  { table: "mod_voting_votings", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "voting" },
  { table: "mod_voting_votings", column: "vote_counter_id", onDelete: "set null", merge: repoint, retained: true, group: "voting" },
  { table: "mod_voting_voting_events", column: "actor_id", onDelete: "set null", merge: repoint, retained: true, group: "voting" },
  { table: "mod_voting_voting_officials", column: "user_id", onDelete: "set null", merge: repoint, retained: true, group: "voting" },
  // Meeting attendance / prezenčná listina (BYT-20261118-001): unique
  // (voting, owner). Both checked in → survivor keeps its row, the loser's
  // stays on the tombstone (statutory evidence, never dropped).
  { table: "mod_voting_attendance", column: "owner_id", onDelete: "restrict", merge: custom, retained: true, group: "meetings" },
  { table: "mod_voting_attendance", column: "identified_by_id", onDelete: "set null", merge: repoint, retained: true, group: "meetings" },
  { table: "mod_voting_eligibility_snapshots", column: "owner_id", onDelete: "restrict", merge: custom, retained: true, group: "voting" },
  { table: "mod_voting_pending_ballots", column: "owner_id", onDelete: "cascade", merge: dedupe("voting_id", "unit_id"), retained: false, group: "voting" },

  // ── Meetings / community ──
  { table: "event_rsvps", column: "user_id", onDelete: "cascade", merge: custom, retained: true, group: "meetings" },
  { table: "event_rsvps", column: "recorded_by_id", onDelete: "set null", merge: repoint, retained: false, group: "meetings" },
  { table: "community_posts", column: "author_id", onDelete: "no action", merge: repoint, retained: true, group: "content" },
  { table: "community_responses", column: "author_id", onDelete: "no action", merge: repoint, retained: true, group: "content" },
  { table: "posts", column: "author_id", onDelete: "no action", merge: repoint, retained: true, group: "content" },
  { table: "project_comments", column: "author_id", onDelete: "set null", merge: repoint, retained: true, group: "content" },
  { table: "project_interest", column: "user_id", onDelete: "cascade", merge: dedupe("project_id"), retained: false, group: "settings" },
  { table: "pairing_requests", column: "created_by_id", onDelete: "no action", merge: repoint, retained: true, group: "content" },

  // ── Documents ──
  { table: "documents", column: "uploaded_by_id", onDelete: "set null", merge: repoint, retained: true, group: "content" },
  // Owner folder (BYT-20261118-005): set null would widen the doc to the unit.
  { table: "documents", column: "subject_user_id", onDelete: "set null", merge: repoint, retained: true, group: "content" },
  { table: "document_access_log", column: "user_id", onDelete: "set null", merge: repoint, retained: true, group: "audit" },
  { table: "document_audit_log", column: "actor_user_id", onDelete: "set null", merge: repoint, retained: true, group: "audit" },
  { table: "unit_notes", column: "created_by_id", onDelete: "set null", merge: repoint, retained: false, group: "content" },
  { table: "unit_notes", column: "updated_by_id", onDelete: "set null", merge: repoint, retained: false, group: "content" },

  // ── Consent / audit ──
  { table: "consent_records", column: "user_id", onDelete: "cascade", merge: repoint, retained: true, group: "consent" },
  { table: "entity_audit_log", column: "actor_user_id", onDelete: "set null", merge: repoint, retained: true, group: "audit" },
  { table: "mcp_audit_log", column: "user_id", onDelete: "set null", merge: repoint, retained: true, group: "audit" },
  { table: "core_module_grants", column: "granted_by_id", onDelete: "set null", merge: repoint, retained: true, group: "audit" },

  // ── Invitations ──
  { table: "invitations", column: "created_by_id", onDelete: "cascade", merge: repoint, retained: true, group: "content" },
  { table: "invitations", column: "used_by_user_id", onDelete: "set null", merge: repoint, retained: false, group: "audit" },
  // An open invitation is an access token to the loser — never carry it over.
  { table: "invitations", column: "target_shell_user_id", onDelete: "cascade", merge: drop, retained: false, group: "credentials" },
  { table: "registration_tokens", column: "created_by_id", onDelete: "cascade", merge: repoint, retained: true, group: "content" },

  // ── Credentials (dropped on merge / anonymise) ──
  { table: "webauthn_credentials", column: "user_id", onDelete: "cascade", merge: drop, retained: false, group: "credentials" },
  { table: "push_subscriptions", column: "user_id", onDelete: "cascade", merge: dedupe("endpoint"), retained: false, group: "credentials" },
  { table: "email_verifications", column: "user_id", onDelete: "cascade", merge: drop, retained: false, group: "credentials" },
  { table: "oauth_authorization_codes", column: "user_id", onDelete: "cascade", merge: drop, retained: false, group: "credentials" },
  { table: "oauth_tokens", column: "user_id", onDelete: "cascade", merge: drop, retained: false, group: "credentials" },
  { table: "mcp_pending_actions", column: "user_id", onDelete: "cascade", merge: drop, retained: false, group: "credentials" },

  // ── Settings ──
  { table: "notification_preferences", column: "user_id", onDelete: "cascade", merge: single, retained: false, group: "settings" },
  { table: "directory_entries", column: "user_id", onDelete: "cascade", merge: single, retained: false, group: "settings" },
  // Fingerprints encode the old user id — stale after a merge, recomputed.
  { table: "owner_queue_dismissals", column: "subject_user_id", onDelete: "cascade", merge: drop, retained: false, group: "settings" },
  { table: "owner_queue_dismissals", column: "handled_by_id", onDelete: "set null", merge: repoint, retained: false, group: "settings" },

  // ── Notification dedupe ──
  { table: "community_notifications_sent", column: "subject_user_id", onDelete: "cascade", merge: repoint, retained: false, group: "notifications" },
  { table: "community_notifications_sent", column: "recipient_id", onDelete: "cascade", merge: repoint, retained: false, group: "notifications" },
  { table: "community_notifications_sent", column: "responder_id", onDelete: "set null", merge: repoint, retained: false, group: "notifications" },
  // Proof that settlement / debt / reading notices were sent → retained.
  { table: "mod_accounting_notifications_sent", column: "recipient_id", onDelete: "cascade", merge: dedupe("kind", "settlement_id", "round_id"), retained: true, group: "accounting" },
  { table: "mod_faults_notifications_sent", column: "recipient_id", onDelete: "cascade", merge: dedupe("kind", "dedupe_key"), retained: false, group: "notifications" },

  // ── Faults ──
  { table: "mod_faults_faults", column: "reporter_id", onDelete: "set null", merge: repoint, retained: true, group: "content" },
  { table: "mod_faults_faults", column: "assignee_user_id", onDelete: "set null", merge: repoint, retained: false, group: "content" },
  { table: "mod_faults_events", column: "actor_id", onDelete: "set null", merge: repoint, retained: true, group: "audit" },
  { table: "mod_faults_photos", column: "uploaded_by_id", onDelete: "set null", merge: repoint, retained: false, group: "content" },

  // ── Accounting (431/2002 §35: 10 years; authorship is part of the record) ──
  { table: "mod_accounting_audit_log", column: "actor_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_bank_connections", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_bank_app_credentials", column: "updated_by_id", onDelete: "set null", merge: repoint, retained: false, group: "accounting" },
  { table: "mod_accounting_building_meter_readings", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_building_meter_readings", column: "voided_by_id", onDelete: "set null", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_expense_attachments", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_expense_authorisations", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_expense_inbox", column: "uploaded_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_expenses", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_expenses", column: "voided_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_fee_schedules", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_journal_entries", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_meter_readings", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_meter_readings", column: "voided_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_meter_readings", column: "resolved_by_id", onDelete: "set null", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_okruh_transfer", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_payments", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_payments", column: "voided_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_periods", column: "zavierka_approved_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_person_months", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_person_months", column: "resolved_by_id", onDelete: "set null", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_person_months", column: "voided_by_id", onDelete: "set null", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_reading_rounds", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_settings", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_settlements", column: "published_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
  { table: "mod_accounting_unit_persons", column: "created_by_id", onDelete: "restrict", merge: repoint, retained: true, group: "accounting" },
];

export function registryKey(e: Pick<UserFkEntry, "table" | "column">): string {
  return `${e.table}.${e.column}`;
}
