ALTER TYPE "public"."community_notification_kind" ADD VALUE 'meeting_invitation';--> statement-breakpoint
ALTER TYPE "public"."community_notification_kind" ADD VALUE 'meeting_reminder';--> statement-breakpoint
ALTER TYPE "public"."community_notification_kind" ADD VALUE 'meeting_change';--> statement-breakpoint
ALTER TYPE "public"."entity_audit_action" ADD VALUE 'membership.end';--> statement-breakpoint
ALTER TYPE "public"."entity_audit_action" ADD VALUE 'membership.transfer';--> statement-breakpoint
ALTER TYPE "public"."entity_audit_action" ADD VALUE 'membership.restore';--> statement-breakpoint
ALTER TYPE "public"."entity_audit_action" ADD VALUE 'user.remove_from_root';--> statement-breakpoint
ALTER TYPE "public"."entity_audit_action" ADD VALUE 'user.merge';--> statement-breakpoint
ALTER TYPE "public"."entity_audit_action" ADD VALUE 'user.anonymize';--> statement-breakpoint
ALTER TYPE "public"."entity_audit_action" ADD VALUE 'user.hard_delete';--> statement-breakpoint
CREATE TABLE "ownership_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_entity_id" uuid NOT NULL,
	"effective_date" date NOT NULL,
	"kind" varchar(32) NOT NULL,
	"note" text,
	"document_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_merges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_user_id" uuid NOT NULL,
	"into_user_id" uuid NOT NULL,
	"impact_json" jsonb NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_voting_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voting_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" varchar(16) NOT NULL,
	"mandate_id" uuid,
	"representative_name" varchar(255),
	"identified_by_id" uuid,
	"id_check_method" varchar(32) DEFAULT 'known_in_person' NOT NULL,
	"source" varchar(16) DEFAULT 'board' NOT NULL,
	"signature_storage_key" varchar(1024),
	"signature_sha256" varchar(64),
	"checked_in_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	"note" varchar(500)
);
--> statement-breakpoint
DROP INDEX "memberships_user_entity_idx";--> statement-breakpoint
ALTER TABLE "community_notifications_sent" ADD COLUMN "change_seq" integer;--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN "event_kind" varchar(24) DEFAULT 'social' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD COLUMN "source" varchar(16) DEFAULT 'app' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD COLUMN "recorded_by_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "valid_from" date DEFAULT CURRENT_DATE NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "valid_to" date;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "end_reason" varchar(32);--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "ended_by_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "merged_into_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "merged_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "anonymized_at" timestamp;--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD COLUMN "hash_owner_id" uuid;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD COLUMN "meeting_post_id" uuid;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD COLUMN "meeting_change_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_unit_entity_id_entities_id_fk" FOREIGN KEY ("unit_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ownership_transfers" ADD CONSTRAINT "ownership_transfers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_merges" ADD CONSTRAINT "user_merges_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_merges" ADD CONSTRAINT "user_merges_into_user_id_users_id_fk" FOREIGN KEY ("into_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_merges" ADD CONSTRAINT "user_merges_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_attendance" ADD CONSTRAINT "mod_voting_attendance_voting_id_mod_voting_votings_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."mod_voting_votings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_attendance" ADD CONSTRAINT "mod_voting_attendance_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_attendance" ADD CONSTRAINT "mod_voting_attendance_mandate_id_mod_voting_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mod_voting_mandates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_attendance" ADD CONSTRAINT "mod_voting_attendance_identified_by_id_users_id_fk" FOREIGN KEY ("identified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ownership_transfers_unit_idx" ON "ownership_transfers" USING btree ("unit_entity_id");--> statement-breakpoint
CREATE INDEX "user_merges_from_idx" ON "user_merges" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "user_merges_into_idx" ON "user_merges" USING btree ("into_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_voting_attendance_voting_owner_idx" ON "mod_voting_attendance" USING btree ("voting_id","owner_id");--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_ended_by_id_users_id_fk" FOREIGN KEY ("ended_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_transfer_id_ownership_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."ownership_transfers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_merged_into_user_id_users_id_fk" FOREIGN KEY ("merged_into_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD CONSTRAINT "mod_voting_votings_meeting_post_id_community_posts_id_fk" FOREIGN KEY ("meeting_post_id") REFERENCES "public"."community_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_notifications_sent_meeting_claim_idx" ON "community_notifications_sent" USING btree ("post_id","recipient_id","kind","change_seq") WHERE "community_notifications_sent"."change_seq" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "mod_voting_votings_meeting_post_idx" ON "mod_voting_votings" USING btree ("meeting_post_id") WHERE "mod_voting_votings"."meeting_post_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_entity_idx" ON "memberships" USING btree ("user_id","entity_id") WHERE "memberships"."valid_to" IS NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_valid_period_check" CHECK ("memberships"."valid_to" IS NULL OR "memberships"."valid_to" >= "memberships"."valid_from");--> statement-breakpoint
-- Hand-written backfills (BYT-20261118-007), data only, snapshot unaffected.
UPDATE "memberships" SET "valid_from" = "created_at"::date;--> statement-breakpoint
UPDATE "memberships" SET "valid_to" = GREATEST("created_at"::date, "valid_from"), "end_reason" = 'correction'
 WHERE "status" = 'archived' AND "valid_to" IS NULL;
-- Ballot share snapshots are NOT backfilled for closed votings: results fall back to memberships valid
-- on the voting's end date (docs/domain/voting.md forbids editing closed ballots). Active ones were done in 0085.
