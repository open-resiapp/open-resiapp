-- BYT-20260609-008 Phase 1: multi-item votings — additive schema + backfill.
--
-- One voting → many items (resolutions); one signed ballot per
-- (voting, unit, owner-share) committing to all item choices at once.
--
-- ADDITIVE / NON-DESTRUCTIVE. This migration only CREATEs the four new
-- tables and backfills them from the legacy single-question model. The
-- legacy `mod_voting_votes` table and `mod_voting_votings.quorum_type`
-- column are intentionally left in place so the running app (which still
-- reads/writes them until the cast/results/consumer paths are switched
-- in Phases 2–6) keeps working. This mirrors the housing_unit_data
-- dual-write window that preceded the destructive drop in migration 0036.
-- The DROP of mod_voting_votes + votings.quorum_type lands in a later
-- cleanup migration once every reader/writer is migrated.
--
-- Hashes are secretless (Option B — no NEXTAUTH_SECRET, unlike the legacy
-- generateAuditHash) and use Postgres core sha256() (built-in since PG11;
-- no pgcrypto extension required). The canonical forms pinned here MUST be
-- reproduced byte-for-byte by the app engine (Phase 2) and the audit
-- bundle (BYT-20260518-001, follow-up):
--
--   ballotHash    = sha256_hex( JCS([{itemId, choice}] sorted by itemId) )
--                   single-item canonical string:
--                     [{"choice":"<choice>","itemId":"<item uuid>"}]
--                   (object keys sorted lexicographically: choice < itemId)
--
--   itemAuditHash = sha256_hex( votingId|itemId|entityId|ownerId|choice|recordedAt )
--                   recordedAt = ISO-8601 UTC, millisecond precision, e.g.
--                     2026-06-09T10:20:30.123Z
--                   (matches JS Date.prototype.toISOString())

CREATE TABLE "mod_voting_voting_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voting_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"quorum_type" "mod_voting_quorum_type" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_voting_ballots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voting_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"vote_type" "mod_voting_vote_type" DEFAULT 'electronic' NOT NULL,
	"recorded_by_id" uuid,
	"mandate_id" uuid,
	"ballot_hash" varchar(64) NOT NULL,
	"signature" text,
	"recorded_at" timestamp DEFAULT now() NOT NULL,
	"disputed" boolean DEFAULT false NOT NULL,
	"dispute_note" text
);
--> statement-breakpoint
CREATE TABLE "mod_voting_ballot_item_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ballot_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"choice" "mod_voting_vote_choice" NOT NULL,
	"item_audit_hash" varchar(64) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mod_voting_ballot_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ballot_id" uuid NOT NULL,
	"storage_key" varchar(1024) NOT NULL,
	"idx" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_voting_voting_items" ADD CONSTRAINT "mod_voting_voting_items_voting_id_mod_voting_votings_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."mod_voting_votings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD CONSTRAINT "mod_voting_ballots_voting_id_mod_voting_votings_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."mod_voting_votings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD CONSTRAINT "mod_voting_ballots_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD CONSTRAINT "mod_voting_ballots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD CONSTRAINT "mod_voting_ballots_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD CONSTRAINT "mod_voting_ballots_mandate_id_mod_voting_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mod_voting_mandates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_ballot_item_votes" ADD CONSTRAINT "mod_voting_ballot_item_votes_ballot_id_mod_voting_ballots_id_fk" FOREIGN KEY ("ballot_id") REFERENCES "public"."mod_voting_ballots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_ballot_item_votes" ADD CONSTRAINT "mod_voting_ballot_item_votes_item_id_mod_voting_voting_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."mod_voting_voting_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_ballot_photos" ADD CONSTRAINT "mod_voting_ballot_photos_ballot_id_mod_voting_ballots_id_fk" FOREIGN KEY ("ballot_id") REFERENCES "public"."mod_voting_ballots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mod_voting_voting_items_voting_idx" ON "mod_voting_voting_items" USING btree ("voting_id","idx");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_voting_ballots_voting_entity_owner_idx" ON "mod_voting_ballots" USING btree ("voting_id","entity_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mod_voting_ballot_item_votes_ballot_item_idx" ON "mod_voting_ballot_item_votes" USING btree ("ballot_id","item_id");--> statement-breakpoint
-- Backfill 1: one voting_item per existing voting (idx 0), carrying the
-- voting's title/description and its (soon-to-be-legacy) quorum_type.
INSERT INTO "mod_voting_voting_items"
	("id","voting_id","idx","title","description","quorum_type","created_at")
SELECT gen_random_uuid(), v."id", 0, v."title", v."description", v."quorum_type", v."created_at"
FROM "mod_voting_votings" v;--> statement-breakpoint
-- Backfill 2: one ballot per legacy vote row. The legacy unique index
-- (voting_id, entity_id) guarantees at most one row per unit, so each
-- maps 1:1 to a distinct (voting_id, entity_id, owner_id) ballot.
INSERT INTO "mod_voting_ballots"
	("id","voting_id","entity_id","owner_id","vote_type","recorded_by_id",
	 "mandate_id","ballot_hash","signature","recorded_at","disputed","dispute_note")
SELECT
	gen_random_uuid(), vt."voting_id", vt."entity_id", vt."owner_id",
	vt."vote_type", vt."recorded_by_id", NULL,
	encode(sha256(convert_to(
		'[{"choice":"' || vt."choice"::text || '","itemId":"' || vi."id"::text || '"}]',
		'UTF8')), 'hex'),
	NULL,
	vt."created_at", vt."disputed", vt."dispute_note"
FROM "mod_voting_votes" vt
JOIN "mod_voting_voting_items" vi
	ON vi."voting_id" = vt."voting_id" AND vi."idx" = 0;--> statement-breakpoint
-- Backfill 3: one ballot_item_vote per legacy vote row (the single item).
INSERT INTO "mod_voting_ballot_item_votes"
	("id","ballot_id","item_id","choice","item_audit_hash")
SELECT
	gen_random_uuid(), b."id", vi."id", vt."choice",
	encode(sha256(convert_to(
		vt."voting_id"::text || '|' || vi."id"::text || '|' || vt."entity_id"::text || '|' ||
		vt."owner_id"::text || '|' || vt."choice"::text || '|' ||
		to_char(b."recorded_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
		'UTF8')), 'hex')
FROM "mod_voting_votes" vt
JOIN "mod_voting_voting_items" vi
	ON vi."voting_id" = vt."voting_id" AND vi."idx" = 0
JOIN "mod_voting_ballots" b
	ON b."voting_id" = vt."voting_id"
	AND b."entity_id" = vt."entity_id"
	AND b."owner_id"  = vt."owner_id";--> statement-breakpoint
-- Backfill 4: one ballot_photo per legacy paper vote that has a photo.
INSERT INTO "mod_voting_ballot_photos"
	("id","ballot_id","storage_key","idx","created_at")
SELECT gen_random_uuid(), b."id", vt."paper_photo_url", 0, vt."created_at"
FROM "mod_voting_votes" vt
JOIN "mod_voting_ballots" b
	ON b."voting_id" = vt."voting_id"
	AND b."entity_id" = vt."entity_id"
	AND b."owner_id"  = vt."owner_id"
WHERE vt."paper_photo_url" IS NOT NULL;
