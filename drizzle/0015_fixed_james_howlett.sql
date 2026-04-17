CREATE TYPE "public"."community_post_status" AS ENUM('active', 'resolved', 'expired');--> statement-breakpoint
CREATE TYPE "public"."community_post_type" AS ENUM('sale', 'free', 'borrow', 'help_request', 'help_offer', 'event');--> statement-breakpoint
CREATE TABLE "community_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "community_post_type" NOT NULL,
	"status" "community_post_status" DEFAULT 'active' NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text NOT NULL,
	"photo_url" varchar(1000),
	"author_id" uuid NOT NULL,
	"event_date" timestamp,
	"event_location" varchar(255),
	"entrance_id" uuid,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "building" ADD COLUMN "community_cross_entrance_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_entrance_id_entrances_id_fk" FOREIGN KEY ("entrance_id") REFERENCES "public"."entrances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_responses" ADD CONSTRAINT "community_responses_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_responses" ADD CONSTRAINT "community_responses_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;