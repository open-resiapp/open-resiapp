CREATE TYPE "public"."mod_accounting_notification_kind" AS ENUM('settlement_published');--> statement-breakpoint
CREATE TABLE "mod_accounting_notifications_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"kind" "mod_accounting_notification_kind" NOT NULL,
	"recipient_id" uuid NOT NULL,
	"settlement_id" uuid,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_accounting_notifications_sent" ADD CONSTRAINT "mod_accounting_notifications_sent_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_notifications_sent" ADD CONSTRAINT "mod_accounting_notifications_sent_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_notifications_sent" ADD CONSTRAINT "mod_accounting_notifications_sent_settlement_id_mod_accounting_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."mod_accounting_settlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_notifications_sent_dedupe_idx" ON "mod_accounting_notifications_sent" USING btree ("kind","settlement_id","recipient_id");