-- BYT-20260609-008 Phase 6: drop the legacy single-question voting model.
--
-- The legacy `mod_voting_votes` table (one choice + one paper_photo_url per
-- unit) and the `mod_voting_votings.quorum_type` column were superseded by the
-- multi-item ballot model (voting_items + ballots + ballot_item_votes +
-- ballot_photos), backfilled 1:1 in migration 0046. Every reader/writer —
-- cast/results UI, /api/ballots, external API, seed, shell-merge, admin +
-- user delete routes — was switched to the new tables before this migration.
--
-- IRREVERSIBLE. The data is preserved in the ballot tables (0046 backfill);
-- restoring the legacy table requires a backup. The per-DB pre-migration
-- backup + S3 snapshots (docker-entrypoint.sh) are the safety net.
--
-- The enums `mod_voting_quorum_type` / `mod_voting_vote_choice` /
-- `mod_voting_vote_type` are intentionally kept — they are still used by
-- voting_items.quorum_type, ballot_item_votes.choice and ballots.vote_type.

DROP TABLE IF EXISTS "mod_voting_votes";--> statement-breakpoint
ALTER TABLE "mod_voting_votings" DROP COLUMN "quorum_type";
