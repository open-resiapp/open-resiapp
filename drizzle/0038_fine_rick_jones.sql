CREATE TYPE "public"."document_audience" AS ENUM('admin', 'owner', 'resident');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('statutes', 'house_rules', 'minutes', 'vote_result', 'vendor_contract', 'works_contract', 'insurance', 'revision', 'budget', 'settlement', 'fund_statement', 'accounting', 'employment', 'technical', 'maintenance', 'notice', 'other');--> statement-breakpoint
CREATE TABLE "document_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid,
	"entity_id" uuid,
	"accessed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_uploaded_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "uploaded_by_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "storage_key" varchar(1024) NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "original_name" varchar(255);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "mime_type" varchar(127);--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "size_bytes" integer;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "type" "document_type" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "audience" "document_audience" DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "retain_until" date;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "document_access_log" ADD CONSTRAINT "document_access_log_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_log" ADD CONSTRAINT "document_access_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_log" ADD CONSTRAINT "document_access_log_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_access_document_idx" ON "document_access_log" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_access_user_idx" ON "document_access_log" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_entity_idx" ON "documents" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "documents_type_idx" ON "documents" USING btree ("type");--> statement-breakpoint
CREATE INDEX "documents_deleted_idx" ON "documents" USING btree ("deleted_at");--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "file_url";