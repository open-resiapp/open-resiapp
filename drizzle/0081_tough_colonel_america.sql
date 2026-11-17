CREATE TABLE "mcp_pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" varchar(2048),
	"kind" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"preview_hash" varchar(64) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"locale" varchar(8) DEFAULT 'sk' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	"result_code" varchar(64),
	"result" jsonb
);
--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ADD COLUMN "pending_action_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_pending_actions" ADD CONSTRAINT "mcp_pending_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_pending_actions_user_created_idx" ON "mcp_pending_actions" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ADD CONSTRAINT "mcp_audit_log_pending_action_id_mcp_pending_actions_id_fk" FOREIGN KEY ("pending_action_id") REFERENCES "public"."mcp_pending_actions"("id") ON DELETE set null ON UPDATE no action;