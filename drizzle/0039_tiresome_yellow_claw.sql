CREATE TYPE "public"."document_project_status" AS ENUM('planned', 'active', 'done');--> statement-breakpoint
CREATE TABLE "document_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"audience" "document_audience" DEFAULT 'owner' NOT NULL,
	"status" "document_project_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "document_projects" ADD CONSTRAINT "document_projects_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_projects_entity_idx" ON "document_projects" USING btree ("entity_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_document_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."document_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_project_idx" ON "documents" USING btree ("project_id");