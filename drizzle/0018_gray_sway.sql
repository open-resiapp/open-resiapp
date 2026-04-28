CREATE TYPE "public"."community_notification_kind" AS ENUM('response', 'expiry_reminder', 'event_reminder');--> statement-breakpoint
CREATE TABLE "community_notifications_sent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"kind" "community_notification_kind" NOT NULL,
	"responder_id" uuid,
	"sent_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_notifications_sent" ADD CONSTRAINT "community_notifications_sent_post_id_community_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."community_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_notifications_sent" ADD CONSTRAINT "community_notifications_sent_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_notifications_sent" ADD CONSTRAINT "community_notifications_sent_responder_id_users_id_fk" FOREIGN KEY ("responder_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_notifications_sent_lookup_idx" ON "community_notifications_sent" USING btree ("post_id","recipient_id","kind");--> statement-breakpoint
CREATE INDEX "community_notifications_sent_responder_idx" ON "community_notifications_sent" USING btree ("post_id","responder_id","kind");