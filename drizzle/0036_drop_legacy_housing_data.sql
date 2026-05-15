-- BYT-20260515-001 Phase 8b: drop legacy housing extension tables.
--
-- After Phase 8a (dual-write removal), `housing_root_data` and
-- `housing_unit_data` became orphan tables — no reader, no writer.
-- Their content is fully mirrored into `entities.data` jsonb via the
-- Phase 2a backfill (migration 0035) and the Phase 2b/2c dual-write
-- window.
--
-- This migration is **irreversible** without restoring from a backup
-- and re-running the Phase 2a backfill in reverse. Operators should
-- snapshot the tables before applying:
--
--   pg_dump -t housing_root_data -t housing_unit_data \
--     > housing_data_snapshot_$(date +%Y%m%d).sql
--
-- Tables are dropped in dependency order (housing_unit_data first
-- because nothing references it; housing_root_data second). Cascade
-- isn't needed — no other tables FK into these.

DROP TABLE IF EXISTS "housing_unit_data";
--> statement-breakpoint
DROP TABLE IF EXISTS "housing_root_data";
