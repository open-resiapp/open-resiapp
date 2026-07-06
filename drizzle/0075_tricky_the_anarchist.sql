ALTER TABLE "mod_accounting_periods" ADD COLUMN "zavierka_approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "mod_accounting_periods" ADD COLUMN "zavierka_approved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "mod_accounting_periods" ADD COLUMN "zavierka_voting_item_id" uuid;--> statement-breakpoint
ALTER TABLE "mod_accounting_periods" ADD CONSTRAINT "mod_accounting_periods_zavierka_approved_by_id_users_id_fk" FOREIGN KEY ("zavierka_approved_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;