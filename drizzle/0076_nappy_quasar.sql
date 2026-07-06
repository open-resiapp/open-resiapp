CREATE TYPE "public"."mod_accounting_expense_inbox_source" AS ENUM('upload', 'email');--> statement-breakpoint
CREATE TYPE "public"."mod_accounting_expense_inbox_status" AS ENUM('pending', 'posted', 'dismissed');--> statement-breakpoint
CREATE TABLE "mod_accounting_expense_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"uploaded_by_id" uuid NOT NULL,
	"source_kind" "mod_accounting_expense_inbox_source" DEFAULT 'upload' NOT NULL,
	"pdf_storage_key" text NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"content_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"ocr_engine" varchar(20),
	"ocr_ico" varchar(20),
	"ocr_dic" varchar(20),
	"ocr_iban" varchar(34),
	"ocr_vs" varchar(10),
	"ocr_amount_cents" integer,
	"ocr_confidence_pct" integer,
	"status" "mod_accounting_expense_inbox_status" DEFAULT 'pending' NOT NULL,
	"posted_expense_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_accounting_expense_inbox" ADD CONSTRAINT "mod_accounting_expense_inbox_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expense_inbox" ADD CONSTRAINT "mod_accounting_expense_inbox_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expense_inbox" ADD CONSTRAINT "mod_accounting_expense_inbox_posted_expense_id_mod_accounting_expenses_id_fk" FOREIGN KEY ("posted_expense_id") REFERENCES "public"."mod_accounting_expenses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mod_accounting_expense_inbox_entity_idx" ON "mod_accounting_expense_inbox" USING btree ("entity_id","status");