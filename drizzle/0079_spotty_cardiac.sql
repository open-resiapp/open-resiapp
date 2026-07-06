CREATE TABLE "mod_accounting_okruh_transfer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"from_okruh" "mod_accounting_okruh" NOT NULL,
	"to_okruh" "mod_accounting_okruh" NOT NULL,
	"amount_cents" integer NOT NULL,
	"transfer_date" timestamp NOT NULL,
	"note" text,
	"return_due_flag" boolean DEFAULT false NOT NULL,
	"return_due_note" text,
	"returned_at" timestamp,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mod_accounting_okruh_transfer_amount_check" CHECK ("mod_accounting_okruh_transfer"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "mod_accounting_okruh_transfer" ADD CONSTRAINT "mod_accounting_okruh_transfer_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_okruh_transfer" ADD CONSTRAINT "mod_accounting_okruh_transfer_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mod_accounting_okruh_transfer_entity_idx" ON "mod_accounting_okruh_transfer" USING btree ("entity_id","return_due_flag");