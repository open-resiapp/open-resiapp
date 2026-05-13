CREATE TABLE "sso_consumed_tokens" (
	"jti" varchar(64) PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sso_consumed_tokens_expires_idx" ON "sso_consumed_tokens" USING btree ("expires_at");