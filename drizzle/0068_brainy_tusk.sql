CREATE TYPE "public"."mod_accounting_attachment_role" AS ENUM('original', 'redacted');--> statement-breakpoint
CREATE TYPE "public"."mod_accounting_attachment_visibility" AS ENUM('public', 'redacted_required', 'restricted');--> statement-breakpoint
CREATE TABLE "mod_accounting_expense_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"role" "mod_accounting_attachment_role" DEFAULT 'original' NOT NULL,
	"storage_key" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"voided_at" timestamp,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_accounting_expenses" ADD COLUMN "attachment_visibility" "mod_accounting_attachment_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "mod_accounting_expenses" ADD COLUMN "redaction_justification" text;--> statement-breakpoint
ALTER TABLE "mod_accounting_expense_attachments" ADD CONSTRAINT "mod_accounting_expense_attachments_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expense_attachments" ADD CONSTRAINT "mod_accounting_expense_attachments_expense_id_mod_accounting_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."mod_accounting_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expense_attachments" ADD CONSTRAINT "mod_accounting_expense_attachments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mod_accounting_expense_attachments_expense_idx" ON "mod_accounting_expense_attachments" USING btree ("expense_id");