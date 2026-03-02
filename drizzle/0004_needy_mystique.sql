CREATE TABLE "user_flats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"flat_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_flats" ADD CONSTRAINT "user_flats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_flats" ADD CONSTRAINT "user_flats_flat_id_flats_id_fk" FOREIGN KEY ("flat_id") REFERENCES "public"."flats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_flats_user_flat_idx" ON "user_flats" USING btree ("user_id","flat_id");--> statement-breakpoint
INSERT INTO "user_flats" ("user_id", "flat_id")
SELECT "id", "flat_id" FROM "users" WHERE "flat_id" IS NOT NULL;