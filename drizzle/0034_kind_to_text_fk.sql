-- BYT-20260515-001 Phase 1c: convert entities.kind from the legacy
-- entity_kind enum to a text FK against entity_kinds.slug.
--
-- This migration is data-preserving. The five legacy enum values map
-- 1:1 to canonical slugs seeded in 0033_seed_entity_kinds.sql:
--
--   housing_community → community
--   housing_block     → building
--   housing_entrance  → entrance
--   housing_unit      → unit
--   generic_group     → generic_group
--
-- After the column is converted, the enum type is dropped. Rollback
-- requires recreating the enum and reversing the CASE expression.
--
-- Drizzle's auto-generated migration for this schema diff would be
-- destructive (DROP COLUMN + ADD COLUMN) — replaced here with a safe
-- in-place USING conversion.

-- 1. Convert enum column to varchar(64) with explicit value mapping.
ALTER TABLE "entities"
  ALTER COLUMN "kind" TYPE varchar(64)
  USING (
    CASE "kind"::text
      WHEN 'housing_community' THEN 'community'
      WHEN 'housing_block'     THEN 'building'
      WHEN 'housing_entrance'  THEN 'entrance'
      WHEN 'housing_unit'      THEN 'unit'
      WHEN 'generic_group'     THEN 'generic_group'
    END
  );
--> statement-breakpoint

-- 2. Add FK to entity_kinds.slug. ON DELETE RESTRICT — a kind cannot
--    be removed while any entity still references it.
ALTER TABLE "entities"
  ADD CONSTRAINT "entities_kind_entity_kinds_slug_fk"
  FOREIGN KEY ("kind") REFERENCES "entity_kinds"("slug")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
--> statement-breakpoint

-- 3. Drop the legacy enum type. Safe because the column no longer
--    references it.
DROP TYPE "entity_kind";
