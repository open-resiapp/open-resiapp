-- BYT-20260515-001 Phase 2a: backfill entities.data jsonb from the
-- legacy housing_root_data and housing_unit_data extension tables.
--
-- Behaviour:
--  - Merges into existing entities.data (via the `||` operator) so any
--    writes that landed between the Phase 1a column add and this
--    backfill are preserved.
--  - Strips NULLs so downstream queries don't have to special-case
--    `data->>'ico' IS NULL` vs missing key.
--  - Idempotent: re-running re-applies identical values.
--
-- The legacy tables stay in place after this migration. Reads switch
-- to entities.data in Phase 2b (per-file), writes in Phase 2c, drop
-- in Phase 8. This preserves a clean rollback window.
--
-- Field mapping (legacy → jsonb key):
--   housing_root_data.address                           → data.address
--   housing_root_data.ico                               → data.ico
--   housing_root_data.voting_method                     → data.voting_method
--   housing_root_data.country                           → data.country
--   housing_root_data.governance_model                  → data.governance_model
--   housing_root_data.legal_notice                      → data.legal_notice
--   housing_root_data.community_cross_entrance_visible  → data.community_cross_entrance_visible
--   housing_unit_data.flat_number                       → data.flat_number
--   housing_unit_data.floor                             → data.floor
--   housing_unit_data.share_numerator                   → data.share_numerator
--   housing_unit_data.share_denominator                 → data.share_denominator
--   housing_unit_data.area                              → data.area_m2 (renamed for clarity)

-- 1. Backfill from housing_root_data (community / building roots).
UPDATE "entities" e
SET "data" = e."data" || jsonb_strip_nulls(jsonb_build_object(
  'address',                          h."address",
  'ico',                              h."ico",
  'voting_method',                    h."voting_method"::text,
  'country',                          h."country"::text,
  'governance_model',                 h."governance_model"::text,
  'legal_notice',                     h."legal_notice",
  'community_cross_entrance_visible', h."community_cross_entrance_visible"
))
FROM "housing_root_data" h
WHERE h."entity_id" = e."id";
--> statement-breakpoint

-- 2. Backfill from housing_unit_data (units / flats).
UPDATE "entities" e
SET "data" = e."data" || jsonb_strip_nulls(jsonb_build_object(
  'flat_number',       h."flat_number",
  'floor',             h."floor",
  'share_numerator',   h."share_numerator",
  'share_denominator', h."share_denominator",
  'area_m2',           h."area"
))
FROM "housing_unit_data" h
WHERE h."entity_id" = e."id";
--> statement-breakpoint

-- 3. Verification — these counts MUST match after the backfill.
--    Run them out-of-band post-migrate; left here as documentation.
--
--   SELECT COUNT(*) FROM housing_root_data;
--   SELECT COUNT(*) FROM entities WHERE kind IN ('community','building') AND data ? 'address';
--
--   SELECT COUNT(*) FROM housing_unit_data;
--   SELECT COUNT(*) FROM entities WHERE kind = 'unit' AND data ? 'share_numerator';
--
--   -- Vote weight parity (HOA): every unit's share fraction in data
--   -- must equal the legacy housing_unit_data fraction.
--   SELECT e.id, h.share_numerator, h.share_denominator,
--          (e.data->>'share_numerator')::int   AS d_num,
--          (e.data->>'share_denominator')::int AS d_den
--   FROM entities e JOIN housing_unit_data h ON h.entity_id = e.id
--   WHERE h.share_numerator <> (e.data->>'share_numerator')::int
--      OR h.share_denominator <> (e.data->>'share_denominator')::int;
--   -- Expect: 0 rows.
