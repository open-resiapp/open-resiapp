CREATE TYPE "public"."document_link_target" AS ENUM('board_post', 'community_post');--> statement-breakpoint
CREATE TABLE "document_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"target_type" "document_link_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_links" ADD CONSTRAINT "document_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_links_target_idx" ON "document_links" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "document_links_document_idx" ON "document_links" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_links_unique_idx" ON "document_links" USING btree ("document_id","target_type","target_id");