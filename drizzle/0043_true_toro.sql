ALTER TABLE "document_projects" RENAME TO "projects";--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "document_projects_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_project_id_document_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "project_comments" DROP CONSTRAINT "project_comments_project_id_document_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votings" DROP CONSTRAINT "mod_voting_votings_document_project_id_document_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD CONSTRAINT "mod_voting_votings_document_project_id_projects_id_fk" FOREIGN KEY ("document_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;