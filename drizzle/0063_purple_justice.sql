CREATE TABLE "mod_accounting_settlement_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"settlement_id" uuid NOT NULL,
	"unit_entity_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"total_cost_cents" integer NOT NULL,
	"total_advances_cents" integer NOT NULL,
	"total_difference_cents" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_accounting_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"journal_entry_id" uuid,
	"published_by_id" uuid NOT NULL,
	"published_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_accounting_settlement_units" ADD CONSTRAINT "mod_accounting_settlement_units_settlement_id_mod_accounting_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."mod_accounting_settlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_settlement_units" ADD CONSTRAINT "mod_accounting_settlement_units_unit_entity_id_entities_id_fk" FOREIGN KEY ("unit_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_settlements" ADD CONSTRAINT "mod_accounting_settlements_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_settlements" ADD CONSTRAINT "mod_accounting_settlements_period_id_mod_accounting_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."mod_accounting_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_settlements" ADD CONSTRAINT "mod_accounting_settlements_journal_entry_id_mod_accounting_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."mod_accounting_journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_settlements" ADD CONSTRAINT "mod_accounting_settlements_published_by_id_users_id_fk" FOREIGN KEY ("published_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_settlement_units_settlement_unit_idx" ON "mod_accounting_settlement_units" USING btree ("settlement_id","unit_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_settlements_period_idx" ON "mod_accounting_settlements" USING btree ("period_id");