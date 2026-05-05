-- Phase 4 backfill: copy legacy building_id / entrance_id / flat_id
-- references into the new nullable entity_id columns added by 0024.
--
-- Because the 0023 backfill reused building.id, entrances.id, and
-- flats.id AS entities.id, this is a straight column copy — no
-- mapping table required.
--
-- For tables where the legacy column was nullable and represented
-- "building-wide" semantics (entrance_id IS NULL on votings/posts/
-- documents/community_posts), we point entity_id at the single root
-- entity (housing_community).

-- ── Helper: pick the (single-tenant) root entity ────────────────
-- The app is single-tenant in production today: exactly one building.
-- If a future migration creates multiple roots, building-wide rows
-- will need explicit per-row mapping.
DO $$
DECLARE
  root_count integer;
BEGIN
  SELECT count(*) INTO root_count FROM building;
  IF root_count > 1 THEN
    RAISE WARNING 'Multiple buildings detected (%); building-wide rows will resolve to the oldest root. Operator should rebalance after deploy.', root_count;
  END IF;
END $$;

-- ── votings: entrance_id → entity_id, NULL → root entity ────────
UPDATE votings
SET entity_id = COALESCE(
  entrance_id,
  (SELECT id FROM building ORDER BY created_at ASC LIMIT 1)
)
WHERE entity_id IS NULL;

-- ── votes: flat_id → entity_id ──────────────────────────────────
UPDATE votes
SET entity_id = flat_id
WHERE entity_id IS NULL;

-- ── mandates: from_flat_id → from_entity_id ─────────────────────
UPDATE mandates
SET from_entity_id = from_flat_id
WHERE from_entity_id IS NULL;

-- ── posts: entrance_id → entity_id, NULL → root entity ──────────
UPDATE posts
SET entity_id = COALESCE(
  entrance_id,
  (SELECT id FROM building ORDER BY created_at ASC LIMIT 1)
)
WHERE entity_id IS NULL;

-- ── documents: entrance_id → entity_id, NULL → root entity ──────
UPDATE documents
SET entity_id = COALESCE(
  entrance_id,
  (SELECT id FROM building ORDER BY created_at ASC LIMIT 1)
)
WHERE entity_id IS NULL;

-- ── invitations: flat_id → entity_id (NULL stays NULL) ──────────
-- Invitations may legitimately have flat_id = NULL (admin invites
-- without a pre-assigned flat). Keep that semantic.
UPDATE invitations
SET entity_id = flat_id
WHERE entity_id IS NULL AND flat_id IS NOT NULL;

-- ── community_posts: entrance_id → entity_id, NULL → root ───────
UPDATE community_posts
SET entity_id = COALESCE(
  entrance_id,
  (SELECT id FROM building ORDER BY created_at ASC LIMIT 1)
)
WHERE entity_id IS NULL;

-- ── core_module_grants: building_id → entity_id ─────────────────
UPDATE core_module_grants
SET entity_id = building_id
WHERE entity_id IS NULL;

-- ── board_members: building_id → entity_id ──────────────────────
UPDATE board_members
SET entity_id = building_id
WHERE entity_id IS NULL;

-- ── Sanity checks ───────────────────────────────────────────────
-- Every row that previously had a non-NULL legacy reference must now
-- have a non-NULL entity_id. NULL legacy rows may stay NULL on tables
-- that allow it (invitations.flat_id).
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count FROM votings WHERE entity_id IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'votings: % rows missing entity_id after backfill', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM votes WHERE entity_id IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'votes: % rows missing entity_id after backfill', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM mandates WHERE from_entity_id IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'mandates: % rows missing from_entity_id after backfill', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM posts WHERE entity_id IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'posts: % rows missing entity_id after backfill', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM documents WHERE entity_id IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'documents: % rows missing entity_id after backfill', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM community_posts WHERE entity_id IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'community_posts: % rows missing entity_id after backfill', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM core_module_grants WHERE entity_id IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'core_module_grants: % rows missing entity_id after backfill', bad_count;
  END IF;

  SELECT count(*) INTO bad_count FROM board_members WHERE entity_id IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'board_members: % rows missing entity_id after backfill', bad_count;
  END IF;
END $$;
