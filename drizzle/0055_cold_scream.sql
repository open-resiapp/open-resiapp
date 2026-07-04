ALTER TABLE "mod_accounting_settings" DROP CONSTRAINT "mod_accounting_settings_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_accounting_audit_log" DROP CONSTRAINT "mod_accounting_audit_log_actor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_schedules" DROP CONSTRAINT "mod_accounting_fee_schedules_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_accounting_journal_entries" DROP CONSTRAINT "mod_accounting_journal_entries_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_accounting_payments" DROP CONSTRAINT "mod_accounting_payments_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_accounting_payments" DROP CONSTRAINT "mod_accounting_payments_voided_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_accounting_unit_persons" DROP CONSTRAINT "mod_accounting_unit_persons_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_accounting_settings" ADD CONSTRAINT "mod_accounting_settings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_audit_log" ADD CONSTRAINT "mod_accounting_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_schedules" ADD CONSTRAINT "mod_accounting_fee_schedules_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_journal_entries" ADD CONSTRAINT "mod_accounting_journal_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_payments" ADD CONSTRAINT "mod_accounting_payments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_payments" ADD CONSTRAINT "mod_accounting_payments_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_unit_persons" ADD CONSTRAINT "mod_accounting_unit_persons_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;