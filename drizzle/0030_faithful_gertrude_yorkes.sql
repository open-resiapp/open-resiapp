ALTER TYPE "public"."entity_audit_action" ADD VALUE 'user.claim_shell';--> statement-breakpoint
ALTER TYPE "public"."entity_audit_action" ADD VALUE 'user.merge_shell';--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "target_shell_user_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_target_shell_user_id_users_id_fk" FOREIGN KEY ("target_shell_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_target_shell_idx" ON "invitations" USING btree ("target_shell_user_id") WHERE "invitations"."target_shell_user_id" IS NOT NULL;