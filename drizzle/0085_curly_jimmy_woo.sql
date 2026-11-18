CREATE TYPE "public"."document_audit_action" AS ENUM('document.upload', 'document.set_audience', 'document.set_subject', 'document.delete', 'document.email_sent');--> statement-breakpoint
CREATE TYPE "public"."mod_voting_event_kind" AS ENUM('announced', 'closed', 'reopened', 'result_published', 'ballot_superseded', 'document_generated', 'minutes_finalised');--> statement-breakpoint
CREATE TYPE "public"."mod_voting_official_role" AS ENUM('chair', 'recorder', 'verifier');--> statement-breakpoint
CREATE TYPE "public"."mod_faults_event_type" AS ENUM('created', 'edited', 'status_changed', 'field_changed', 'photo_added', 'photo_removed');--> statement-breakpoint
CREATE TYPE "public"."mod_faults_notification_kind" AS ENUM('status_changed', 'stale_digest');--> statement-breakpoint
CREATE TYPE "public"."mod_faults_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."mod_faults_status" AS ENUM('new', 'in_progress', 'resolved', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."mod_faults_visibility" AS ENUM('community', 'entrance', 'private');--> statement-breakpoint
ALTER TYPE "public"."community_notification_kind" ADD VALUE 'document_sent';--> statement-breakpoint
ALTER TYPE "public"."entity_audit_action" ADD VALUE 'unit_note.update';--> statement-breakpoint
ALTER TYPE "public"."entity_audit_action" ADD VALUE 'unit_note.clear';--> statement-breakpoint
ALTER TYPE "public"."mod_voting_quorum_type" ADD VALUE 'four_fifths_all' BEFORE 'all_unanimous';--> statement-breakpoint
ALTER TYPE "public"."mod_accounting_notification_kind" ADD VALUE 'reading_reminder';--> statement-breakpoint
CREATE TABLE "document_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid,
	"actor_user_id" uuid,
	"action" "document_audit_action" NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_queue_dismissals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_id" uuid NOT NULL,
	"code" text NOT NULL,
	"subject_user_id" uuid,
	"subject_unit_id" uuid,
	"fingerprint" varchar(128) NOT NULL,
	"handled_by_id" uuid,
	"handled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "unit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_by_id" uuid,
	"updated_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_voting_voting_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voting_id" uuid NOT NULL,
	"kind" "mod_voting_event_kind" NOT NULL,
	"actor_id" uuid,
	"note" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_voting_voting_officials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voting_id" uuid NOT NULL,
	"role" "mod_voting_official_role" NOT NULL,
	"user_id" uuid,
	"name" varchar(255) NOT NULL,
	"refused_to_sign" boolean DEFAULT false NOT NULL,
	"refusal_statement" text,
	"idx" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_building_meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"round_id" uuid,
	"meter_type" "mod_accounting_meter_type" NOT NULL,
	"label" varchar(120) NOT NULL,
	"reading_date" timestamp NOT NULL,
	"value_milli" bigint NOT NULL,
	"photo_storage_key" varchar(512),
	"note" varchar(500),
	"voided_at" timestamp,
	"voided_by_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mod_accounting_building_meter_readings_value_check" CHECK ("mod_accounting_building_meter_readings"."value_milli" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_person_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"unit_entity_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"persons_count" integer NOT NULL,
	"submission_id" uuid NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp,
	"resolved_by_id" uuid,
	"applied_unit_persons_id" uuid,
	"voided_at" timestamp,
	"voided_by_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mod_accounting_person_months_month_check" CHECK ("mod_accounting_person_months"."month" BETWEEN 1 AND 12),
	CONSTRAINT "mod_accounting_person_months_persons_check" CHECK ("mod_accounting_person_months"."persons_count" BETWEEN 0 AND 50)
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_reading_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"opens_at" timestamp NOT NULL,
	"deadline_at" timestamp NOT NULL,
	"closed_for_owners_at" timestamp,
	"allow_late" boolean DEFAULT true NOT NULL,
	"collect_persons" boolean NOT NULL,
	"meter_types" "mod_accounting_meter_type"[] DEFAULT '{}'::mod_accounting_meter_type[] NOT NULL,
	"reminder_days_before" integer DEFAULT 5 NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mod_accounting_reading_rounds_reminder_check" CHECK ("mod_accounting_reading_rounds"."reminder_days_before" BETWEEN 0 AND 30),
	CONSTRAINT "mod_accounting_reading_rounds_dates_check" CHECK ("mod_accounting_reading_rounds"."deadline_at" >= "mod_accounting_reading_rounds"."opens_at")
);
--> statement-breakpoint
CREATE TABLE "mod_faults_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_entity_id" uuid NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name_key" varchar(200),
	"custom_name" varchar(120),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_faults_contractors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_entity_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone" varchar(40),
	"email" varchar(255),
	"ico" varchar(20),
	"note" text,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_faults_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fault_id" uuid NOT NULL,
	"actor_id" uuid,
	"type" "mod_faults_event_type" NOT NULL,
	"field" varchar(64),
	"old_value" jsonb,
	"new_value" jsonb,
	"public_message" text,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_faults_notifications_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "mod_faults_notification_kind" NOT NULL,
	"fault_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"event_id" uuid,
	"dedupe_key" varchar(120) NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_faults_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fault_id" uuid NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"uploaded_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_faults_faults" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_entity_id" uuid NOT NULL,
	"location_entity_id" uuid NOT NULL,
	"scope_entity_id" uuid NOT NULL,
	"location_note" varchar(255),
	"reporter_id" uuid,
	"title" varchar(120) NOT NULL,
	"description" text,
	"status" "mod_faults_status" DEFAULT 'new' NOT NULL,
	"visibility" "mod_faults_visibility" NOT NULL,
	"priority" "mod_faults_priority" DEFAULT 'normal' NOT NULL,
	"category_id" uuid,
	"assignee_user_id" uuid,
	"contractor_id" uuid,
	"invoiced" boolean DEFAULT false NOT NULL,
	"expense_id" uuid,
	"internal_note" text,
	"board_touched_at" timestamp,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mod_faults_faults_assignee_check" CHECK (NOT ("mod_faults_faults"."assignee_user_id" IS NOT NULL AND "mod_faults_faults"."contractor_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" DROP CONSTRAINT "mod_voting_mandates_voting_id_mod_voting_votings_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" DROP CONSTRAINT "mod_voting_mandates_from_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" DROP CONSTRAINT "mod_voting_mandates_to_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" DROP CONSTRAINT "mod_voting_mandates_verified_by_admin_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votings" DROP CONSTRAINT "mod_voting_votings_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votings" DROP CONSTRAINT "mod_voting_votings_vote_counter_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "community_notifications_sent" ADD COLUMN "document_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "subject_user_id" uuid;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "lv_ordinal" integer;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "ownership_form" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD COLUMN "owner_unit_share_numerator" integer;--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD COLUMN "owner_unit_share_denominator" integer;--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD COLUMN "membership_weight" integer;--> statement-breakpoint
ALTER TABLE "mod_voting_voting_items" ADD COLUMN "repeat_of_quorum_type" "mod_voting_quorum_type";--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD COLUMN "place" varchar(500);--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD COLUMN "announced_at" timestamp;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD COLUMN "result_published_at" timestamp;--> statement-breakpoint
ALTER TABLE "mod_accounting_notifications_sent" ADD COLUMN "round_id" uuid;--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD COLUMN "round_id" uuid;--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD COLUMN "photo_storage_key" varchar(512);--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD COLUMN "note" varchar(500);--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD COLUMN "late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD COLUMN "resolved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "document_audit_log" ADD CONSTRAINT "document_audit_log_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_audit_log" ADD CONSTRAINT "document_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_queue_dismissals" ADD CONSTRAINT "owner_queue_dismissals_root_id_entities_id_fk" FOREIGN KEY ("root_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_queue_dismissals" ADD CONSTRAINT "owner_queue_dismissals_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_queue_dismissals" ADD CONSTRAINT "owner_queue_dismissals_subject_unit_id_entities_id_fk" FOREIGN KEY ("subject_unit_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_queue_dismissals" ADD CONSTRAINT "owner_queue_dismissals_handled_by_id_users_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_notes" ADD CONSTRAINT "unit_notes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_notes" ADD CONSTRAINT "unit_notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_notes" ADD CONSTRAINT "unit_notes_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_voting_events" ADD CONSTRAINT "mod_voting_voting_events_voting_id_mod_voting_votings_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."mod_voting_votings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_voting_events" ADD CONSTRAINT "mod_voting_voting_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_voting_officials" ADD CONSTRAINT "mod_voting_voting_officials_voting_id_mod_voting_votings_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."mod_voting_votings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_voting_officials" ADD CONSTRAINT "mod_voting_voting_officials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_building_meter_readings" ADD CONSTRAINT "mod_accounting_building_meter_readings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_building_meter_readings" ADD CONSTRAINT "mod_accounting_building_meter_readings_round_id_mod_accounting_reading_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."mod_accounting_reading_rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_building_meter_readings" ADD CONSTRAINT "mod_accounting_building_meter_readings_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_building_meter_readings" ADD CONSTRAINT "mod_accounting_building_meter_readings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_person_months" ADD CONSTRAINT "mod_accounting_person_months_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_person_months" ADD CONSTRAINT "mod_accounting_person_months_unit_entity_id_entities_id_fk" FOREIGN KEY ("unit_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_person_months" ADD CONSTRAINT "mod_accounting_person_months_round_id_mod_accounting_reading_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."mod_accounting_reading_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_person_months" ADD CONSTRAINT "mod_accounting_person_months_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_person_months" ADD CONSTRAINT "mod_accounting_person_months_applied_unit_persons_id_mod_accounting_unit_persons_id_fk" FOREIGN KEY ("applied_unit_persons_id") REFERENCES "public"."mod_accounting_unit_persons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_person_months" ADD CONSTRAINT "mod_accounting_person_months_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_person_months" ADD CONSTRAINT "mod_accounting_person_months_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_reading_rounds" ADD CONSTRAINT "mod_accounting_reading_rounds_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_reading_rounds" ADD CONSTRAINT "mod_accounting_reading_rounds_period_id_mod_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."mod_accounting_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_reading_rounds" ADD CONSTRAINT "mod_accounting_reading_rounds_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_categories" ADD CONSTRAINT "mod_faults_categories_root_entity_id_entities_id_fk" FOREIGN KEY ("root_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_contractors" ADD CONSTRAINT "mod_faults_contractors_root_entity_id_entities_id_fk" FOREIGN KEY ("root_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_events" ADD CONSTRAINT "mod_faults_events_fault_id_mod_faults_faults_id_fk" FOREIGN KEY ("fault_id") REFERENCES "public"."mod_faults_faults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_events" ADD CONSTRAINT "mod_faults_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_notifications_sent" ADD CONSTRAINT "mod_faults_notifications_sent_fault_id_mod_faults_faults_id_fk" FOREIGN KEY ("fault_id") REFERENCES "public"."mod_faults_faults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_notifications_sent" ADD CONSTRAINT "mod_faults_notifications_sent_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_notifications_sent" ADD CONSTRAINT "mod_faults_notifications_sent_event_id_mod_faults_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."mod_faults_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_photos" ADD CONSTRAINT "mod_faults_photos_fault_id_mod_faults_faults_id_fk" FOREIGN KEY ("fault_id") REFERENCES "public"."mod_faults_faults"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_photos" ADD CONSTRAINT "mod_faults_photos_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_faults" ADD CONSTRAINT "mod_faults_faults_root_entity_id_entities_id_fk" FOREIGN KEY ("root_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_faults" ADD CONSTRAINT "mod_faults_faults_location_entity_id_entities_id_fk" FOREIGN KEY ("location_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_faults" ADD CONSTRAINT "mod_faults_faults_scope_entity_id_entities_id_fk" FOREIGN KEY ("scope_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_faults" ADD CONSTRAINT "mod_faults_faults_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_faults" ADD CONSTRAINT "mod_faults_faults_category_id_mod_faults_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."mod_faults_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_faults" ADD CONSTRAINT "mod_faults_faults_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_faults_faults" ADD CONSTRAINT "mod_faults_faults_contractor_id_mod_faults_contractors_id_fk" FOREIGN KEY ("contractor_id") REFERENCES "public"."mod_faults_contractors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_audit_document_idx" ON "document_audit_log" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_queue_dismissals_root_fp_idx" ON "owner_queue_dismissals" USING btree ("root_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "unit_notes_entity_idx" ON "unit_notes" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "mod_voting_voting_events_voting_created_idx" ON "mod_voting_voting_events" USING btree ("voting_id","created_at");--> statement-breakpoint
CREATE INDEX "mod_voting_voting_officials_voting_idx" ON "mod_voting_voting_officials" USING btree ("voting_id");--> statement-breakpoint
CREATE INDEX "mod_accounting_building_meter_readings_entity_idx" ON "mod_accounting_building_meter_readings" USING btree ("entity_id","reading_date");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_person_months_unit_month_idx" ON "mod_accounting_person_months" USING btree ("unit_entity_id","year","month") WHERE "mod_accounting_person_months"."voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX "mod_accounting_person_months_round_idx" ON "mod_accounting_person_months" USING btree ("round_id");--> statement-breakpoint
CREATE INDEX "mod_accounting_person_months_submission_idx" ON "mod_accounting_person_months" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_reading_rounds_entity_year_idx" ON "mod_accounting_reading_rounds" USING btree ("entity_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_faults_categories_root_slug_idx" ON "mod_faults_categories" USING btree ("root_entity_id","slug");--> statement-breakpoint
CREATE INDEX "mod_faults_contractors_root_idx" ON "mod_faults_contractors" USING btree ("root_entity_id");--> statement-breakpoint
CREATE INDEX "mod_faults_events_fault_created_idx" ON "mod_faults_events" USING btree ("fault_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_faults_notifications_sent_dedupe_idx" ON "mod_faults_notifications_sent" USING btree ("kind","recipient_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "mod_faults_notifications_sent_fault_kind_idx" ON "mod_faults_notifications_sent" USING btree ("fault_id","kind","sent_at");--> statement-breakpoint
CREATE INDEX "mod_faults_photos_fault_idx" ON "mod_faults_photos" USING btree ("fault_id");--> statement-breakpoint
CREATE INDEX "mod_faults_faults_root_status_created_idx" ON "mod_faults_faults" USING btree ("root_entity_id","status","created_at");--> statement-breakpoint
CREATE INDEX "mod_faults_faults_reporter_idx" ON "mod_faults_faults" USING btree ("reporter_id");--> statement-breakpoint
CREATE INDEX "mod_faults_faults_assignee_idx" ON "mod_faults_faults" USING btree ("assignee_user_id");--> statement-breakpoint
ALTER TABLE "community_notifications_sent" ADD CONSTRAINT "community_notifications_sent_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD CONSTRAINT "mod_voting_mandates_voting_id_mod_voting_votings_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."mod_voting_votings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD CONSTRAINT "mod_voting_mandates_from_owner_id_users_id_fk" FOREIGN KEY ("from_owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD CONSTRAINT "mod_voting_mandates_to_owner_id_users_id_fk" FOREIGN KEY ("to_owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD CONSTRAINT "mod_voting_mandates_verified_by_admin_id_users_id_fk" FOREIGN KEY ("verified_by_admin_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD CONSTRAINT "mod_voting_votings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD CONSTRAINT "mod_voting_votings_vote_counter_id_users_id_fk" FOREIGN KEY ("vote_counter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_notifications_sent" ADD CONSTRAINT "mod_accounting_notifications_sent_round_id_mod_accounting_reading_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."mod_accounting_reading_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD CONSTRAINT "mod_accounting_meter_readings_round_id_mod_accounting_reading_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."mod_accounting_reading_rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD CONSTRAINT "mod_accounting_meter_readings_resolved_by_id_users_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_notifications_sent_document_idx" ON "community_notifications_sent" USING btree ("document_id","recipient_id","kind");--> statement-breakpoint
CREATE INDEX "documents_subject_idx" ON "documents" USING btree ("subject_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_notifications_sent_round_dedupe_idx" ON "mod_accounting_notifications_sent" USING btree ("kind","round_id","recipient_id") WHERE "mod_accounting_notifications_sent"."round_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mod_accounting_meter_readings_round_idx" ON "mod_accounting_meter_readings" USING btree ("round_id");--> statement-breakpoint
-- Hand-written backfills (BYT-20261118-002 / -005), data only, snapshot unaffected.
-- Freeze the owner's share/weight on ballots of ACTIVE votings only; closed votings keep NULL
-- and use the identical current-membership fallback (docs/domain/voting.md forbids editing closed ballots).
UPDATE "mod_voting_ballots" b
SET "owner_unit_share_numerator" = m."owner_unit_share_numerator",
    "owner_unit_share_denominator" = m."owner_unit_share_denominator",
    "membership_weight" = m."weight"
FROM "memberships" m, "mod_voting_votings" v
WHERE v."id" = b."voting_id" AND v."status" = 'active'
  AND m."entity_id" = b."entity_id" AND m."user_id" = b."owner_id" AND m."status" = 'active'
  AND b."owner_unit_share_numerator" IS NULL;--> statement-breakpoint
INSERT INTO "document_audit_log" ("document_id", "actor_user_id", "action", "after_json", "created_at")
SELECT d."id", d."uploaded_by_id", 'document.upload', jsonb_build_object('audience', d."audience", 'subjectUserId', NULL), d."created_at"
FROM "documents" d
WHERE NOT EXISTS (SELECT 1 FROM "document_audit_log" a WHERE a."document_id" = d."id" AND a."action" = 'document.upload');
