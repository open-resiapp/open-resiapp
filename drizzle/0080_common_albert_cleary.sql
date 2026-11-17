CREATE TABLE "webauthn_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"transports" text[],
	"device_label" varchar(120),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"activated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD COLUMN "confirmation_method" varchar(16);--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD COLUMN "confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_idx" ON "webauthn_credentials" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "webauthn_credentials_user_idx" ON "webauthn_credentials" USING btree ("user_id");