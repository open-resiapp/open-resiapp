CREATE TYPE "public"."entity_audit_action" AS ENUM('entity.create', 'entity.set_parent', 'entity.set_kind', 'entity.archive', 'entity.hard_delete', 'membership.create', 'membership.update_role', 'membership.remove');--> statement-breakpoint
CREATE TYPE "public"."entity_kind" AS ENUM('housing_community', 'housing_block', 'housing_entrance', 'housing_unit', 'generic_group');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('admin', 'owner', 'tenant', 'vote_counter', 'caretaker');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('pending', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('member', 'superadmin');--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"kind" "entity_kind" NOT NULL,
	"name" varchar(255) NOT NULL,
	"path" text NOT NULL,
	"depth" integer DEFAULT 0 NOT NULL,
	"root_id" uuid NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" "entity_audit_action" NOT NULL,
	"entity_id" uuid,
	"before_json" text,
	"after_json" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "housing_root_data" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"address" varchar(500) NOT NULL,
	"ico" varchar(20),
	"voting_method" "voting_method" DEFAULT 'per_share' NOT NULL,
	"country" "country" DEFAULT 'sk' NOT NULL,
	"governance_model" "governance_model" DEFAULT 'chairman_council' NOT NULL,
	"legal_notice" text,
	"community_cross_entrance_visible" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "housing_unit_data" (
	"entity_id" uuid PRIMARY KEY NOT NULL,
	"flat_number" varchar(20) NOT NULL,
	"floor" integer DEFAULT 0 NOT NULL,
	"share_numerator" integer NOT NULL,
	"share_denominator" integer NOT NULL,
	"area" integer
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'owner' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_role" "platform_role" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_parent_id_entities_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_audit_log" ADD CONSTRAINT "entity_audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_audit_log" ADD CONSTRAINT "entity_audit_log_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housing_root_data" ADD CONSTRAINT "housing_root_data_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "housing_unit_data" ADD CONSTRAINT "housing_unit_data_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_parent_idx" ON "entities" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "entities_root_idx" ON "entities" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "entities_kind_idx" ON "entities" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "entities_archived_idx" ON "entities" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "entities_path_idx" ON "entities" USING btree ("path" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "entity_audit_entity_idx" ON "entity_audit_log" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "entity_audit_action_idx" ON "entity_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "entity_audit_actor_idx" ON "entity_audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_entity_idx" ON "memberships" USING btree ("user_id","entity_id");--> statement-breakpoint
CREATE INDEX "memberships_entity_idx" ON "memberships" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");