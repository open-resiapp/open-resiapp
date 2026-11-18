ALTER TYPE "public"."board_member_role" ADD VALUE 'board_member';--> statement-breakpoint
ALTER TYPE "public"."board_member_role" ADD VALUE 'supervisory_chairman';--> statement-breakpoint
ALTER TYPE "public"."board_member_role" ADD VALUE 'supervisory_member';--> statement-breakpoint
ALTER TYPE "public"."community_notification_kind" ADD VALUE 'post_notice';--> statement-breakpoint
ALTER TYPE "public"."community_notification_kind" ADD VALUE 'voting_started';--> statement-breakpoint
ALTER TYPE "public"."entity_audit_action" ADD VALUE 'user.update_contact';--> statement-breakpoint
ALTER TYPE "public"."governance_model" ADD VALUE 'board_supervisory';--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'member';--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'accountant';--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'spravca';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'member';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'accountant';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'spravca';--> statement-breakpoint
ALTER TYPE "public"."mod_voting_event_kind" ADD VALUE 'mandate_revoked';--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ALTER COLUMN "to_owner_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "community_notifications_sent" ADD COLUMN "board_post_id" uuid;--> statement-breakpoint
ALTER TABLE "community_notifications_sent" ADD COLUMN "voting_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "short_code" varchar(12);--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "apps_ui_declared" boolean;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "mcp_protocol_version" varchar(32);--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "capabilities_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "paper_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD COLUMN "proxy_name" varchar(255);--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD COLUMN "proxy_birth_date" date;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD COLUMN "proxy_address" varchar(500);--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD COLUMN "proxy_note" text;--> statement-breakpoint
ALTER TABLE "mod_accounting_fee_schedule_services" ADD COLUMN "rate_mode" varchar(16) DEFAULT 'total' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_notifications_sent" ADD CONSTRAINT "community_notifications_sent_board_post_id_posts_id_fk" FOREIGN KEY ("board_post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_notifications_sent_board_post_idx" ON "community_notifications_sent" USING btree ("board_post_id","recipient_id") WHERE "community_notifications_sent"."board_post_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "community_notifications_sent_voting_idx" ON "community_notifications_sent" USING btree ("voting_id","recipient_id") WHERE "community_notifications_sent"."voting_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_short_code_idx" ON "invitations" USING btree ("short_code") WHERE "invitations"."short_code" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD CONSTRAINT "mod_voting_mandates_proxy_chk" CHECK ("mod_voting_mandates"."to_owner_id" IS NOT NULL OR "mod_voting_mandates"."proxy_name" IS NOT NULL);--> statement-breakpoint
-- Hand-added: core schema cannot import the voting module table (circular import), so drizzle does not emit this FK.
ALTER TABLE "community_notifications_sent" ADD CONSTRAINT "community_notifications_sent_voting_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."mod_voting_votings"("id") ON DELETE cascade ON UPDATE no action;
