CREATE TABLE "mcp_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"client_id" varchar(2048),
	"tool" varchar(64) NOT NULL,
	"args_redacted" jsonb,
	"result_code" varchar(64) NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_authorization_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"code_challenge" varchar(128) NOT NULL,
	"redirect_uri" text NOT NULL,
	"resource" text NOT NULL,
	"scopes" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" varchar(2048) NOT NULL,
	"source" varchar(8) NOT NULL,
	"name" varchar(255) NOT NULL,
	"logo_uri" text,
	"client_uri" text,
	"redirect_uris" jsonb NOT NULL,
	"fetched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"access_hash" varchar(64) NOT NULL,
	"refresh_hash" varchar(64),
	"family_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scopes" jsonb NOT NULL,
	"resource" text NOT NULL,
	"access_expires_at" timestamp NOT NULL,
	"refresh_expires_at" timestamp,
	"refresh_used_at" timestamp,
	"revoked_at" timestamp,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcp_audit_log" ADD CONSTRAINT "mcp_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_client_id_oauth_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_audit_log_created_at_idx" ON "mcp_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mcp_audit_log_user_idx" ON "mcp_audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_codes_code_hash_idx" ON "oauth_authorization_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_clients_client_id_idx" ON "oauth_clients" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_access_hash_idx" ON "oauth_tokens" USING btree ("access_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_tokens_refresh_hash_idx" ON "oauth_tokens" USING btree ("refresh_hash") WHERE "oauth_tokens"."refresh_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "oauth_tokens_family_idx" ON "oauth_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "oauth_tokens_user_idx" ON "oauth_tokens" USING btree ("user_id");