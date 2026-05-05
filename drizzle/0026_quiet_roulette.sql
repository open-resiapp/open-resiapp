ALTER TYPE "public"."quorum_type" RENAME TO "mod_voting_quorum_type";--> statement-breakpoint
ALTER TYPE "public"."vote_choice" RENAME TO "mod_voting_vote_choice";--> statement-breakpoint
ALTER TYPE "public"."vote_type" RENAME TO "mod_voting_vote_type";--> statement-breakpoint
ALTER TYPE "public"."voting_initiated_by" RENAME TO "mod_voting_voting_initiated_by";--> statement-breakpoint
ALTER TYPE "public"."voting_status" RENAME TO "mod_voting_voting_status";--> statement-breakpoint
ALTER TYPE "public"."voting_type" RENAME TO "mod_voting_voting_type";--> statement-breakpoint
ALTER TABLE "mandates" RENAME TO "mod_voting_mandates";--> statement-breakpoint
ALTER TABLE "votes" RENAME TO "mod_voting_votes";--> statement-breakpoint
ALTER TABLE "votings" RENAME TO "mod_voting_votings";--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" DROP CONSTRAINT "mandates_voting_id_votings_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" DROP CONSTRAINT "mandates_from_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" DROP CONSTRAINT "mandates_from_flat_id_flats_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" DROP CONSTRAINT "mandates_from_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" DROP CONSTRAINT "mandates_to_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" DROP CONSTRAINT "mandates_verified_by_admin_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votes" DROP CONSTRAINT "votes_voting_id_votings_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votes" DROP CONSTRAINT "votes_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votes" DROP CONSTRAINT "votes_flat_id_flats_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votes" DROP CONSTRAINT "votes_entity_id_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votes" DROP CONSTRAINT "votes_recorded_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votings" DROP CONSTRAINT "votings_created_by_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votings" DROP CONSTRAINT "votings_vote_counter_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votings" DROP CONSTRAINT "votings_entrance_id_entrances_id_fk";
--> statement-breakpoint
ALTER TABLE "mod_voting_votings" DROP CONSTRAINT "votings_entity_id_entities_id_fk";
--> statement-breakpoint
DROP INDEX "mandates_voting_flat_idx";--> statement-breakpoint
DROP INDEX "votes_voting_flat_idx";--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD CONSTRAINT "mod_voting_mandates_voting_id_mod_voting_votings_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."mod_voting_votings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD CONSTRAINT "mod_voting_mandates_from_owner_id_users_id_fk" FOREIGN KEY ("from_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD CONSTRAINT "mod_voting_mandates_from_flat_id_flats_id_fk" FOREIGN KEY ("from_flat_id") REFERENCES "public"."flats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD CONSTRAINT "mod_voting_mandates_from_entity_id_entities_id_fk" FOREIGN KEY ("from_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD CONSTRAINT "mod_voting_mandates_to_owner_id_users_id_fk" FOREIGN KEY ("to_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_mandates" ADD CONSTRAINT "mod_voting_mandates_verified_by_admin_id_users_id_fk" FOREIGN KEY ("verified_by_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votes" ADD CONSTRAINT "mod_voting_votes_voting_id_mod_voting_votings_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."mod_voting_votings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votes" ADD CONSTRAINT "mod_voting_votes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votes" ADD CONSTRAINT "mod_voting_votes_flat_id_flats_id_fk" FOREIGN KEY ("flat_id") REFERENCES "public"."flats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votes" ADD CONSTRAINT "mod_voting_votes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votes" ADD CONSTRAINT "mod_voting_votes_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD CONSTRAINT "mod_voting_votings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD CONSTRAINT "mod_voting_votings_vote_counter_id_users_id_fk" FOREIGN KEY ("vote_counter_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD CONSTRAINT "mod_voting_votings_entrance_id_entrances_id_fk" FOREIGN KEY ("entrance_id") REFERENCES "public"."entrances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD CONSTRAINT "mod_voting_votings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mod_voting_mandates_voting_flat_idx" ON "mod_voting_mandates" USING btree ("voting_id","from_flat_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_voting_votes_voting_flat_idx" ON "mod_voting_votes" USING btree ("voting_id","flat_id");