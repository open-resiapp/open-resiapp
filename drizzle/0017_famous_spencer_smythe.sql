CREATE TABLE "directory_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"share_phone" boolean DEFAULT false NOT NULL,
	"share_email" boolean DEFAULT false NOT NULL,
	"note" varchar(255),
	"skills" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "directory_entries_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "directory_entries" ADD CONSTRAINT "directory_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;