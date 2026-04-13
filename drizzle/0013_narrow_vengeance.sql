CREATE TYPE "public"."board_member_role" AS ENUM('chairman', 'council_member', 'committee_member', 'committee_chairman');--> statement-breakpoint
CREATE TYPE "public"."governance_model" AS ENUM('chairman_council', 'committee', 'chairman_only');--> statement-breakpoint
CREATE TABLE "board_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "board_member_role" NOT NULL,
	"elected_at" timestamp NOT NULL,
	"term_ends_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "building" ADD COLUMN "governance_model" "governance_model" DEFAULT 'chairman_council' NOT NULL;--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_building_id_building_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."building"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;