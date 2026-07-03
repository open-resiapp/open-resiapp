CREATE TYPE "public"."mod_accounting_allocated_by" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."mod_accounting_allocation_key" AS ENUM('share', 'area_m2', 'persons', 'flat_count_equal', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."mod_accounting_allocation_strategy" AS ENUM('proportional', 'priority_ordered');--> statement-breakpoint
CREATE TYPE "public"."mod_accounting_okruh" AS ENUM('fpuo', 'svc', 'mgmt');--> statement-breakpoint
CREATE TYPE "public"."mod_accounting_payment_source" AS ENUM('manual', 'bank_import', 'fio_api');--> statement-breakpoint
CREATE TYPE "public"."mod_accounting_period_status" AS ENUM('open', 'reconciling', 'published', 'closed');--> statement-breakpoint
CREATE TYPE "public"."mod_accounting_schedule_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."mod_accounting_source_type" AS ENUM('opening_balance', 'fee_schedule_publish', 'payment', 'manual');--> statement-breakpoint
ALTER TYPE "public"."board_member_role" ADD VALUE 'treasurer';--> statement-breakpoint
CREATE TABLE "mod_accounting_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"status" "mod_accounting_period_status" DEFAULT 'open' NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"allocation_strategy" "mod_accounting_allocation_strategy" DEFAULT 'proportional' NOT NULL,
	"priority_order" jsonb,
	"effective_from" timestamp NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" "country" NOT NULL,
	"code" varchar(20) NOT NULL,
	"name" varchar(255) NOT NULL,
	"kind" varchar(20) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mod_accounting_accounts_kind_check" CHECK ("mod_accounting_accounts"."kind" IN ('asset', 'liability', 'equity', 'revenue', 'expense'))
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"table_name" varchar(100) NOT NULL,
	"record_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"justification" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_fee_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"unit_entity_id" uuid NOT NULL,
	"service_category_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"month" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"vs" varchar(10) NOT NULL,
	"allocation_basis_snapshot" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mod_accounting_fee_assessments_month_check" CHECK ("mod_accounting_fee_assessments"."month" BETWEEN 1 AND 12)
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_fee_schedule_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"service_category_id" uuid NOT NULL,
	"allocation_key" "mod_accounting_allocation_key" NOT NULL,
	"rate_cents" integer,
	"fixed_amount_cents" integer,
	CONSTRAINT "mod_accounting_fee_schedule_services_rate_check" CHECK (("mod_accounting_fee_schedule_services"."allocation_key" = 'fixed' AND "mod_accounting_fee_schedule_services"."fixed_amount_cents" IS NOT NULL) OR ("mod_accounting_fee_schedule_services"."allocation_key" <> 'fixed' AND "mod_accounting_fee_schedule_services"."rate_cents" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_fee_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"status" "mod_accounting_schedule_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"posted_at" timestamp NOT NULL,
	"description" text NOT NULL,
	"source_type" "mod_accounting_source_type" NOT NULL,
	"source_id" uuid,
	"voting_resolution_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_cents" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer DEFAULT 0 NOT NULL,
	"okruh" "mod_accounting_okruh" NOT NULL,
	"unit_entity_id" uuid,
	"service_category_id" uuid,
	CONSTRAINT "mod_accounting_journal_lines_amounts_check" CHECK ("mod_accounting_journal_lines"."debit_cents" >= 0 AND "mod_accounting_journal_lines"."credit_cents" >= 0 AND ("mod_accounting_journal_lines"."debit_cents" > 0) <> ("mod_accounting_journal_lines"."credit_cents" > 0))
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"allocated_by" "mod_accounting_allocated_by" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mod_accounting_payment_allocations_amount_check" CHECK ("mod_accounting_payment_allocations"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"source" "mod_accounting_payment_source" NOT NULL,
	"received_at" timestamp NOT NULL,
	"value_date" timestamp,
	"amount_cents" integer NOT NULL,
	"vs" varchar(10),
	"ss" varchar(10),
	"ks" varchar(4),
	"counterparty_iban" varchar(34),
	"counterparty_name" varchar(255),
	"narrative" text,
	"external_tx_id" varchar(100),
	"raw_payload" jsonb,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"voided_at" timestamp,
	"voided_by_id" uuid,
	"void_reason" text,
	CONSTRAINT "mod_accounting_payments_amount_check" CHECK ("mod_accounting_payments"."amount_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_service_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" "country" NOT NULL,
	"slug" varchar(50) NOT NULL,
	"okruh" "mod_accounting_okruh" NOT NULL,
	"name_key" varchar(100) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_unit_persons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"unit_entity_id" uuid NOT NULL,
	"persons_count" integer NOT NULL,
	"effective_from" timestamp NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mod_accounting_unit_persons_count_check" CHECK ("mod_accounting_unit_persons"."persons_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_unit_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"unit_entity_id" uuid NOT NULL,
	"vs" varchar(10) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_accounting_periods" ADD CONSTRAINT "mod_accounting_periods_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_settings" ADD CONSTRAINT "mod_accounting_settings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_settings" ADD CONSTRAINT "mod_accounting_settings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_audit_log" ADD CONSTRAINT "mod_accounting_audit_log_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_audit_log" ADD CONSTRAINT "mod_accounting_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_assessments" ADD CONSTRAINT "mod_accounting_fee_assessments_schedule_id_mod_accounting_fee_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."mod_accounting_fee_schedules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_assessments" ADD CONSTRAINT "mod_accounting_fee_assessments_unit_entity_id_entities_id_fk" FOREIGN KEY ("unit_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_assessments" ADD CONSTRAINT "mod_accounting_fee_assessments_service_category_id_mod_accounting_service_categories_id_fk" FOREIGN KEY ("service_category_id") REFERENCES "public"."mod_accounting_service_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_assessments" ADD CONSTRAINT "mod_accounting_fee_assessments_period_id_mod_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."mod_accounting_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_schedule_services" ADD CONSTRAINT "mod_accounting_fee_schedule_services_schedule_id_mod_accounting_fee_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."mod_accounting_fee_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_schedule_services" ADD CONSTRAINT "mod_accounting_fee_schedule_services_service_category_id_mod_accounting_service_categories_id_fk" FOREIGN KEY ("service_category_id") REFERENCES "public"."mod_accounting_service_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_schedules" ADD CONSTRAINT "mod_accounting_fee_schedules_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_schedules" ADD CONSTRAINT "mod_accounting_fee_schedules_period_id_mod_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."mod_accounting_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_schedules" ADD CONSTRAINT "mod_accounting_fee_schedules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_journal_entries" ADD CONSTRAINT "mod_accounting_journal_entries_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_journal_entries" ADD CONSTRAINT "mod_accounting_journal_entries_period_id_mod_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."mod_accounting_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_journal_entries" ADD CONSTRAINT "mod_accounting_journal_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_journal_lines" ADD CONSTRAINT "mod_accounting_journal_lines_journal_entry_id_mod_accounting_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."mod_accounting_journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_journal_lines" ADD CONSTRAINT "mod_accounting_journal_lines_account_id_mod_accounting_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mod_accounting_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_journal_lines" ADD CONSTRAINT "mod_accounting_journal_lines_unit_entity_id_entities_id_fk" FOREIGN KEY ("unit_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_journal_lines" ADD CONSTRAINT "mod_accounting_journal_lines_service_category_id_mod_accounting_service_categories_id_fk" FOREIGN KEY ("service_category_id") REFERENCES "public"."mod_accounting_service_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_payment_allocations" ADD CONSTRAINT "mod_accounting_payment_allocations_payment_id_mod_accounting_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."mod_accounting_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_payment_allocations" ADD CONSTRAINT "mod_accounting_payment_allocations_assessment_id_mod_accounting_fee_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."mod_accounting_fee_assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_payments" ADD CONSTRAINT "mod_accounting_payments_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_payments" ADD CONSTRAINT "mod_accounting_payments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_payments" ADD CONSTRAINT "mod_accounting_payments_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_unit_persons" ADD CONSTRAINT "mod_accounting_unit_persons_unit_entity_id_entities_id_fk" FOREIGN KEY ("unit_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_unit_persons" ADD CONSTRAINT "mod_accounting_unit_persons_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_unit_settings" ADD CONSTRAINT "mod_accounting_unit_settings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_unit_settings" ADD CONSTRAINT "mod_accounting_unit_settings_unit_entity_id_entities_id_fk" FOREIGN KEY ("unit_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_periods_entity_year_idx" ON "mod_accounting_periods" USING btree ("entity_id","year");--> statement-breakpoint
CREATE INDEX "mod_accounting_settings_entity_idx" ON "mod_accounting_settings" USING btree ("entity_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_accounts_country_code_idx" ON "mod_accounting_accounts" USING btree ("country","code");--> statement-breakpoint
CREATE INDEX "mod_accounting_audit_log_entity_created_idx" ON "mod_accounting_audit_log" USING btree ("entity_id","created_at");--> statement-breakpoint
CREATE INDEX "mod_accounting_audit_log_record_idx" ON "mod_accounting_audit_log" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "mod_accounting_fee_assessments_unit_period_idx" ON "mod_accounting_fee_assessments" USING btree ("unit_entity_id","period_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_fee_assessments_schedule_unit_svc_month_idx" ON "mod_accounting_fee_assessments" USING btree ("schedule_id","unit_entity_id","service_category_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_fee_schedule_services_schedule_category_idx" ON "mod_accounting_fee_schedule_services" USING btree ("schedule_id","service_category_id");--> statement-breakpoint
CREATE INDEX "mod_accounting_fee_schedules_entity_period_idx" ON "mod_accounting_fee_schedules" USING btree ("entity_id","period_id");--> statement-breakpoint
CREATE INDEX "mod_accounting_journal_entries_entity_period_idx" ON "mod_accounting_journal_entries" USING btree ("entity_id","period_id");--> statement-breakpoint
CREATE INDEX "mod_accounting_journal_entries_source_idx" ON "mod_accounting_journal_entries" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "mod_accounting_journal_lines_entry_idx" ON "mod_accounting_journal_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "mod_accounting_journal_lines_unit_idx" ON "mod_accounting_journal_lines" USING btree ("unit_entity_id");--> statement-breakpoint
CREATE INDEX "mod_accounting_payment_allocations_payment_idx" ON "mod_accounting_payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "mod_accounting_payment_allocations_assessment_idx" ON "mod_accounting_payment_allocations" USING btree ("assessment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_payments_external_tx_idx" ON "mod_accounting_payments" USING btree ("external_tx_id") WHERE "mod_accounting_payments"."external_tx_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mod_accounting_payments_entity_received_idx" ON "mod_accounting_payments" USING btree ("entity_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_service_categories_country_slug_idx" ON "mod_accounting_service_categories" USING btree ("country","slug");--> statement-breakpoint
CREATE INDEX "mod_accounting_unit_persons_unit_idx" ON "mod_accounting_unit_persons" USING btree ("unit_entity_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_unit_settings_unit_idx" ON "mod_accounting_unit_settings" USING btree ("unit_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_unit_settings_entity_vs_idx" ON "mod_accounting_unit_settings" USING btree ("entity_id","vs");