CREATE TYPE "public"."module_status" AS ENUM('enabled', 'disabled', 'failed');--> statement-breakpoint
CREATE TABLE "core_module_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"building_id" uuid NOT NULL,
	"module_name" varchar(100) NOT NULL,
	"permissions" text[] NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"granted_by_id" uuid
);
--> statement-breakpoint
CREATE TABLE "core_modules" (
	"name" varchar(100) PRIMARY KEY NOT NULL,
	"version" varchar(50) NOT NULL,
	"status" "module_status" DEFAULT 'enabled' NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure_at" timestamp,
	"last_failure_message" text,
	"install_path" text NOT NULL,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core_module_grants" ADD CONSTRAINT "core_module_grants_building_id_building_id_fk" FOREIGN KEY ("building_id") REFERENCES "public"."building"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_module_grants" ADD CONSTRAINT "core_module_grants_module_name_core_modules_name_fk" FOREIGN KEY ("module_name") REFERENCES "public"."core_modules"("name") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_module_grants" ADD CONSTRAINT "core_module_grants_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "core_module_grants_building_module_idx" ON "core_module_grants" USING btree ("building_id","module_name");