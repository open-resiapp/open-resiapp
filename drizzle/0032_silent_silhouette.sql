CREATE TABLE "entity_kinds" (
	"slug" varchar(64) PRIMARY KEY NOT NULL,
	"display_name_key" varchar(200) NOT NULL,
	"icon" varchar(64),
	"allows_members" boolean DEFAULT false NOT NULL,
	"votable" boolean DEFAULT false NOT NULL,
	"allowed_parent_kinds" text[] DEFAULT '{}'::text[] NOT NULL,
	"data_schema" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "data" jsonb DEFAULT '{}'::jsonb NOT NULL;