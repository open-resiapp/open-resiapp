CREATE TYPE "public"."mod_accounting_bank_provider" AS ENUM('fio');--> statement-breakpoint
CREATE TABLE "mod_accounting_bank_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"provider" "mod_accounting_bank_provider" NOT NULL,
	"token" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_sync_at" timestamp,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_accounting_bank_connections" ADD CONSTRAINT "mod_accounting_bank_connections_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_bank_connections" ADD CONSTRAINT "mod_accounting_bank_connections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_bank_connections_entity_provider_idx" ON "mod_accounting_bank_connections" USING btree ("entity_id","provider");