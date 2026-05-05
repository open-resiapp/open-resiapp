ALTER TABLE "community_notifications_sent" ALTER COLUMN "post_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "community_notifications_sent" ADD COLUMN "subject_user_id" uuid;--> statement-breakpoint
ALTER TABLE "community_notifications_sent" ADD CONSTRAINT "community_notifications_sent_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "community_notifications_sent_subject_idx" ON "community_notifications_sent" USING btree ("subject_user_id","recipient_id","kind");