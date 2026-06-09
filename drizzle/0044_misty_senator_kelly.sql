CREATE TYPE "public"."project_interest_stance" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TABLE "project_interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"stance" "project_interest_stance" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_interest" ADD CONSTRAINT "project_interest_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_interest" ADD CONSTRAINT "project_interest_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_interest_user_project_idx" ON "project_interest" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_interest_project_idx" ON "project_interest" USING btree ("project_id");