ALTER TABLE "notification_preferences" ADD COLUMN "evyuct_consent_at" timestamp;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "evyuct_consent_source" text;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD COLUMN "evyuct_withdrawn_at" timestamp;