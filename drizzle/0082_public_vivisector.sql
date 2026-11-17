CREATE TYPE "public"."mod_voting_pending_ballot_status" AS ENUM('pending', 'confirmed', 'cancelled', 'superseded', 'expired', 'failed');--> statement-breakpoint
CREATE TABLE "mod_voting_pending_ballots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voting_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"items" jsonb NOT NULL,
	"ballot_hash" varchar(64) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"status" "mod_voting_pending_ballot_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"failure_code" varchar(64),
	"source" varchar(16) DEFAULT 'mcp' NOT NULL,
	"client_id" varchar(2048),
	"pending_action_id" uuid,
	"ballot_id" uuid,
	"locale" varchar(8) DEFAULT 'sk' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD COLUMN "confirmation_kind" varchar(16);--> statement-breakpoint
ALTER TABLE "mod_voting_pending_ballots" ADD CONSTRAINT "mod_voting_pending_ballots_voting_id_mod_voting_votings_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."mod_voting_votings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_pending_ballots" ADD CONSTRAINT "mod_voting_pending_ballots_unit_id_entities_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_pending_ballots" ADD CONSTRAINT "mod_voting_pending_ballots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_pending_ballots" ADD CONSTRAINT "mod_voting_pending_ballots_pending_action_id_mcp_pending_actions_id_fk" FOREIGN KEY ("pending_action_id") REFERENCES "public"."mcp_pending_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_pending_ballots" ADD CONSTRAINT "mod_voting_pending_ballots_ballot_id_mod_voting_ballots_id_fk" FOREIGN KEY ("ballot_id") REFERENCES "public"."mod_voting_ballots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mod_voting_pending_ballots_token_hash_idx" ON "mod_voting_pending_ballots" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_voting_pending_ballots_one_pending_idx" ON "mod_voting_pending_ballots" USING btree ("voting_id","unit_id","owner_id") WHERE "mod_voting_pending_ballots"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "mod_voting_pending_ballots_voting_owner_created_idx" ON "mod_voting_pending_ballots" USING btree ("voting_id","owner_id","created_at");