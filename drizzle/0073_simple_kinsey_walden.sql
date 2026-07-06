CREATE TYPE "public"."mod_voting_financial_effect_kind" AS ENUM('fpuo_rate_change', 'expense_approval');--> statement-breakpoint
CREATE TYPE "public"."mod_accounting_expense_authorisation_status" AS ENUM('draft', 'used', 'cancelled');--> statement-breakpoint
CREATE TABLE "mod_accounting_expense_authorisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"voting_id" uuid,
	"voting_item_id" uuid,
	"amount_cents" integer NOT NULL,
	"description" text NOT NULL,
	"service_category_slug" varchar(64),
	"status" "mod_accounting_expense_authorisation_status" DEFAULT 'draft' NOT NULL,
	"used_expense_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_voting_voting_items" ADD COLUMN "financial_effect_kind" "mod_voting_financial_effect_kind";--> statement-breakpoint
ALTER TABLE "mod_voting_voting_items" ADD COLUMN "financial_effect_params" jsonb;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_schedules" ADD COLUMN "origin_voting_item_id" uuid;--> statement-breakpoint
ALTER TABLE "mod_accounting_expense_authorisations" ADD CONSTRAINT "mod_accounting_expense_authorisations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expense_authorisations" ADD CONSTRAINT "mod_accounting_expense_authorisations_used_expense_id_mod_accounting_expenses_id_fk" FOREIGN KEY ("used_expense_id") REFERENCES "public"."mod_accounting_expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expense_authorisations" ADD CONSTRAINT "mod_accounting_expense_authorisations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mod_accounting_expense_authorisations_entity_idx" ON "mod_accounting_expense_authorisations" USING btree ("entity_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_expense_authorisations_voting_item_idx" ON "mod_accounting_expense_authorisations" USING btree ("voting_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_fee_schedules_origin_voting_item_idx" ON "mod_accounting_fee_schedules" USING btree ("origin_voting_item_id");