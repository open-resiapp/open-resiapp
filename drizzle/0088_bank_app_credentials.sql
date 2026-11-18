CREATE TABLE "mod_accounting_bank_app_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "mod_accounting_bank_provider" NOT NULL,
	"app_id" varchar(100) NOT NULL,
	"private_key_enc" text NOT NULL,
	"key_fingerprint" varchar(64) NOT NULL,
	"updated_by_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_accounting_bank_app_credentials" ADD CONSTRAINT "mod_accounting_bank_app_credentials_updated_by_id_users_id_fk" FOREIGN KEY ("updated_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_bank_app_credentials_provider_idx" ON "mod_accounting_bank_app_credentials" USING btree ("provider");