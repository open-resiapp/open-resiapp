CREATE TABLE "mod_voting_eligibility_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"voting_id" uuid NOT NULL,
	"unit_entity_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"unit_label" varchar(255) NOT NULL,
	"weight" double precision NOT NULL,
	"unit_share_numerator" integer,
	"unit_share_denominator" integer,
	"unit_area_m2" double precision,
	"owner_unit_share_numerator" integer NOT NULL,
	"owner_unit_share_denominator" integer NOT NULL,
	"membership_weight" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mod_voting_attendance" ADD COLUMN "weight" double precision;--> statement-breakpoint
ALTER TABLE "mod_voting_attendance" ADD COLUMN "unit_label" varchar(500);--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD COLUMN "unit_share_numerator" integer;--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD COLUMN "unit_share_denominator" integer;--> statement-breakpoint
ALTER TABLE "mod_voting_ballots" ADD COLUMN "unit_area_m2" double precision;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD COLUMN "frozen_total_weight" double precision;--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD COLUMN "frozen_voting_method" varchar(32);--> statement-breakpoint
ALTER TABLE "mod_voting_votings" ADD COLUMN "frozen_at" timestamp;--> statement-breakpoint
ALTER TABLE "mod_voting_eligibility_snapshots" ADD CONSTRAINT "mod_voting_eligibility_snapshots_voting_id_mod_voting_votings_id_fk" FOREIGN KEY ("voting_id") REFERENCES "public"."mod_voting_votings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_eligibility_snapshots" ADD CONSTRAINT "mod_voting_eligibility_snapshots_unit_entity_id_entities_id_fk" FOREIGN KEY ("unit_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_voting_eligibility_snapshots" ADD CONSTRAINT "mod_voting_eligibility_snapshots_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mod_voting_eligibility_snapshots_voting_unit_owner_idx" ON "mod_voting_eligibility_snapshots" USING btree ("voting_id","unit_entity_id","owner_id");--> statement-breakpoint
-- Hand-written backfills (2026-11-18 voting review), data only, snapshot unaffected.
-- Closed votings get the frozen data they would have been given at close, computed with the
-- CURRENT-membership logic results used before 0086 (memberships.status = 'active', live unit
-- shares, archived units excluded). Only NULL snapshot columns are filled; no choice, hash or
-- timestamp of a ballot is touched. Open / draft votings are untouched (frozen at their close).
-- (1) Voting method + total possible weight per closed voting.
WITH root AS (
  SELECT CASE COALESCE("data"->>'voting_method', '')
           WHEN 'per_share' THEN 'weighted_by_share'
           WHEN 'per_flat' THEN 'one_per_unit'
           WHEN 'weighted_by_share' THEN 'weighted_by_share'
           WHEN 'one_per_unit' THEN 'one_per_unit'
           WHEN 'per_area' THEN 'per_area'
           WHEN 'one_per_member' THEN 'one_per_member'
           WHEN 'custom_weight' THEN 'custom_weight'
           ELSE 'weighted_by_share' END AS "method"
  FROM "entities" WHERE "parent_id" IS NULL AND "archived_at" IS NULL
  ORDER BY "created_at" LIMIT 1
)
UPDATE "mod_voting_votings" v
SET "frozen_voting_method" = root."method",
    "frozen_at" = now(),
    "frozen_total_weight" = CASE
      WHEN root."method" IN ('weighted_by_share', 'one_per_unit', 'per_area') THEN (
        SELECT COALESCE(SUM(CASE root."method"
                 WHEN 'weighted_by_share' THEN ((u."data"->>'share_numerator')::int)::float8
                                               / NULLIF((u."data"->>'share_denominator')::int, 0)
                 WHEN 'one_per_unit' THEN 1::float8
                 ELSE COALESCE((u."data"->>'area_m2')::float8, 1) END), 0)
        FROM "entities" u, "entities" s
        WHERE s."id" = v."entity_id" AND u."kind" = 'unit' AND u."archived_at" IS NULL
          AND u."path" LIKE s."path" || '%')
      ELSE (
        SELECT COALESCE(SUM(CASE root."method" WHEN 'one_per_member' THEN 1 ELSE m."weight" END), 0)::float8
        FROM "memberships" m
        JOIN "entities" e ON e."id" = m."entity_id"
        JOIN "entities" s ON s."id" = v."entity_id"
        WHERE m."status" = 'active' AND e."archived_at" IS NULL AND e."path" LIKE s."path" || '%')
    END
FROM root
WHERE v."status" = 'closed' AND v."frozen_total_weight" IS NULL;--> statement-breakpoint
-- (2) Owner share / membership weight on ballots of closed votings that have none (the 0085
-- backfill did active votings only). Current active membership, owner role preferred.
UPDATE "mod_voting_ballots" b
SET "owner_unit_share_numerator" = m."owner_unit_share_numerator",
    "owner_unit_share_denominator" = m."owner_unit_share_denominator",
    "membership_weight" = m."weight"
FROM "mod_voting_votings" v,
     (
       SELECT DISTINCT ON (mm."entity_id", mm."user_id")
              mm."entity_id", mm."user_id",
              mm."owner_unit_share_numerator", mm."owner_unit_share_denominator", mm."weight"
       FROM "memberships" mm
       WHERE mm."status" = 'active'
       ORDER BY mm."entity_id", mm."user_id", (mm."role" = 'owner') DESC
     ) m
WHERE v."id" = b."voting_id" AND v."status" = 'closed'
  AND m."entity_id" = b."entity_id" AND m."user_id" = b."owner_id"
  AND b."owner_unit_share_numerator" IS NULL;--> statement-breakpoint
-- (3) Unit share / area on every ballot of a closed voting (live entities.data today).
UPDATE "mod_voting_ballots" b
SET "unit_share_numerator" = (u."data"->>'share_numerator')::int,
    "unit_share_denominator" = (u."data"->>'share_denominator')::int,
    "unit_area_m2" = (u."data"->>'area_m2')::float8
FROM "mod_voting_votings" v, "entities" u
WHERE v."id" = b."voting_id" AND v."status" = 'closed' AND u."id" = b."entity_id"
  AND b."unit_share_numerator" IS NULL AND b."unit_share_denominator" IS NULL AND b."unit_area_m2" IS NULL;--> statement-breakpoint
-- (4) Eligible (unit, owner) set of each closed voting — participation.ts rules: unit-scoped methods
-- take active OWNER memberships on non-archived units of the subtree (weight = unit weight × owner
-- share); member-scoped methods take every active membership (weight = 1 or memberships.weight).
INSERT INTO "mod_voting_eligibility_snapshots" (
  "voting_id", "unit_entity_id", "owner_id", "unit_label", "weight",
  "unit_share_numerator", "unit_share_denominator", "unit_area_m2",
  "owner_unit_share_numerator", "owner_unit_share_denominator", "membership_weight")
SELECT v."id", e."id", m."user_id",
       LEFT(COALESCE(e."data"->>'flat_number', e."name"), 255),
       CASE v."frozen_voting_method"
         WHEN 'weighted_by_share' THEN
           (COALESCE((e."data"->>'share_numerator')::int, 0)::float8 / COALESCE(NULLIF((e."data"->>'share_denominator')::int, 0), 1))
           * (m."owner_unit_share_numerator"::float8 / COALESCE(NULLIF(m."owner_unit_share_denominator", 0), 1))
         WHEN 'one_per_unit' THEN
           m."owner_unit_share_numerator"::float8 / COALESCE(NULLIF(m."owner_unit_share_denominator", 0), 1)
         WHEN 'per_area' THEN
           COALESCE((e."data"->>'area_m2')::float8, 1)
           * (m."owner_unit_share_numerator"::float8 / COALESCE(NULLIF(m."owner_unit_share_denominator", 0), 1))
         WHEN 'one_per_member' THEN 1::float8
         ELSE m."weight"::float8 END,
       (e."data"->>'share_numerator')::int, (e."data"->>'share_denominator')::int, (e."data"->>'area_m2')::float8,
       m."owner_unit_share_numerator", m."owner_unit_share_denominator", m."weight"
FROM "mod_voting_votings" v
JOIN "entities" s ON s."id" = v."entity_id"
JOIN "entities" e ON e."path" LIKE s."path" || '%' AND e."archived_at" IS NULL
JOIN "memberships" m ON m."entity_id" = e."id" AND m."status" = 'active'
WHERE v."status" = 'closed'
  AND v."frozen_voting_method" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "mod_voting_eligibility_snapshots" x WHERE x."voting_id" = v."id")
  AND (v."frozen_voting_method" IN ('one_per_member', 'custom_weight')
       OR (e."kind" = 'unit' AND m."role" = 'owner'))
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- (5) Weight + unit label(s) on the attendance rows of closed votings, from that snapshot.
UPDATE "mod_voting_attendance" a
SET "weight" = x."weight", "unit_label" = LEFT(x."labels", 500)
FROM (
  SELECT "voting_id", "owner_id", SUM("weight") AS "weight",
         string_agg("unit_label", ', ' ORDER BY "unit_label") AS "labels"
  FROM "mod_voting_eligibility_snapshots" GROUP BY "voting_id", "owner_id"
) x, "mod_voting_votings" v
WHERE x."voting_id" = a."voting_id" AND x."owner_id" = a."owner_id"
  AND v."id" = a."voting_id" AND v."status" = 'closed' AND a."weight" IS NULL;
