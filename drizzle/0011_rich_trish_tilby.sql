CREATE TYPE "public"."country" AS ENUM('sk', 'cz');--> statement-breakpoint
ALTER TABLE "building" ADD COLUMN "country" "country" DEFAULT 'sk' NOT NULL;