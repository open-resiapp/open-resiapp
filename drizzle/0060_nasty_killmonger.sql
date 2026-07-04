ALTER TYPE "public"."mod_accounting_source_type" ADD VALUE 'expense';--> statement-breakpoint
CREATE TABLE "mod_accounting_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"supplier_name" varchar(255) NOT NULL,
	"supplier_ico" varchar(20),
	"supplier_dic" varchar(20),
	"supplier_iban" varchar(34),
	"invoice_no" varchar(100) NOT NULL,
	"invoice_date" timestamp NOT NULL,
	"due_date" timestamp,
	"service_category_id" uuid,
	"okruh" "mod_accounting_okruh" NOT NULL,
	"amount_cents" integer NOT NULL,
	"amount_netto_cents" integer,
	"dph_rate_bp" integer,
	"dph_cents" integer,
	"next_inspection_due_at" timestamp,
	"journal_entry_id" uuid,
	"paid_at" timestamp,
	"payment_journal_entry_id" uuid,
	"payment_method" "mod_accounting_payment_method",
	"voided_at" timestamp,
	"voided_by_id" uuid,
	"void_reason" text,
	"void_journal_entry_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mod_accounting_expenses_amount_check" CHECK ("mod_accounting_expenses"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "mod_accounting_expenses" ADD CONSTRAINT "mod_accounting_expenses_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expenses" ADD CONSTRAINT "mod_accounting_expenses_service_category_id_mod_accounting_service_categories_id_fk" FOREIGN KEY ("service_category_id") REFERENCES "public"."mod_accounting_service_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expenses" ADD CONSTRAINT "mod_accounting_expenses_journal_entry_id_mod_accounting_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."mod_accounting_journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expenses" ADD CONSTRAINT "mod_accounting_expenses_payment_journal_entry_id_mod_accounting_journal_entries_id_fk" FOREIGN KEY ("payment_journal_entry_id") REFERENCES "public"."mod_accounting_journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expenses" ADD CONSTRAINT "mod_accounting_expenses_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expenses" ADD CONSTRAINT "mod_accounting_expenses_void_journal_entry_id_mod_accounting_journal_entries_id_fk" FOREIGN KEY ("void_journal_entry_id") REFERENCES "public"."mod_accounting_journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_expenses" ADD CONSTRAINT "mod_accounting_expenses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mod_accounting_expenses_entity_idx" ON "mod_accounting_expenses" USING btree ("entity_id","invoice_date");