-- Backfill the new entity / membership tables from the legacy
-- building / entrances / flats / users / user_flats tables.
--
-- Strategy: reuse existing building.id, entrances.id, and flats.id
-- AS entities.id. UUIDs are universally unique, so this is safe and
-- means the upcoming FK repoint (Phase 4) can rename columns without
-- remapping primary keys.
--
-- Idempotent guard: every INSERT uses ON CONFLICT DO NOTHING so the
-- migration can be re-run safely if the deploy is retried.

-- ── 1. Building → root entity (housing_community) ────────────────
INSERT INTO entities (id, parent_id, kind, name, path, depth, root_id, created_at)
SELECT
  b.id,
  NULL,
  'housing_community'::entity_kind,
  b.name,
  '/' || b.id::text || '/',
  0,
  b.id,
  b.created_at
FROM building b
ON CONFLICT (id) DO NOTHING;

-- ── 2. Building → housing_root_data ──────────────────────────────
INSERT INTO housing_root_data (
  entity_id, address, ico, voting_method, country, governance_model,
  legal_notice, community_cross_entrance_visible
)
SELECT
  b.id,
  b.address,
  b.ico,
  b.voting_method,
  b.country,
  b.governance_model,
  b.legal_notice,
  b.community_cross_entrance_visible
FROM building b
ON CONFLICT (entity_id) DO NOTHING;

-- ── 3. Entrances → housing_entrance entities ─────────────────────
INSERT INTO entities (id, parent_id, kind, name, path, depth, root_id, created_at)
SELECT
  e.id,
  e.building_id,
  'housing_entrance'::entity_kind,
  e.name,
  '/' || e.building_id::text || '/' || e.id::text || '/',
  1,
  e.building_id,
  e.created_at
FROM entrances e
ON CONFLICT (id) DO NOTHING;

-- ── 4. Flats → housing_unit entities ─────────────────────────────
INSERT INTO entities (id, parent_id, kind, name, path, depth, root_id, created_at)
SELECT
  f.id,
  f.entrance_id,
  'housing_unit'::entity_kind,
  f.flat_number,
  '/' || e.building_id::text || '/' || f.entrance_id::text || '/' || f.id::text || '/',
  2,
  e.building_id,
  f.created_at
FROM flats f
JOIN entrances e ON e.id = f.entrance_id
ON CONFLICT (id) DO NOTHING;

-- ── 5. Flats → housing_unit_data ────────────────────────────────
INSERT INTO housing_unit_data (
  entity_id, flat_number, floor, share_numerator, share_denominator, area
)
SELECT
  f.id,
  f.flat_number,
  f.floor,
  f.share_numerator,
  f.share_denominator,
  f.area
FROM flats f
ON CONFLICT (entity_id) DO NOTHING;

-- ── 6. Users WITH flat_id → membership at the flat entity ────────
-- users.role enum values (admin/owner/tenant/vote_counter/caretaker)
-- match membership_role 1:1, so a text round-trip cast is safe.
INSERT INTO memberships (user_id, entity_id, role, weight, status, created_at)
SELECT
  u.id,
  u.flat_id,
  u.role::text::membership_role,
  1,
  CASE
    WHEN u.is_active AND u.status = 'active' THEN 'active'::membership_status
    WHEN u.status = 'pending' THEN 'pending'::membership_status
    ELSE 'archived'::membership_status
  END,
  u.created_at
FROM users u
WHERE u.flat_id IS NOT NULL
ON CONFLICT (user_id, entity_id) DO NOTHING;

-- ── 7. Users WITHOUT flat_id → membership at the (single) root ───
-- Single-tenant app: there is exactly one building today. If multiple
-- exist, every flat-less user is attached to the oldest building so
-- they keep platform-wide access. Operator can rebalance via the
-- admin API after the deploy.
INSERT INTO memberships (user_id, entity_id, role, weight, status, created_at)
SELECT
  u.id,
  (SELECT id FROM building ORDER BY created_at ASC LIMIT 1),
  u.role::text::membership_role,
  1,
  CASE
    WHEN u.is_active AND u.status = 'active' THEN 'active'::membership_status
    WHEN u.status = 'pending' THEN 'pending'::membership_status
    ELSE 'archived'::membership_status
  END,
  u.created_at
FROM users u
WHERE u.flat_id IS NULL
  AND EXISTS (SELECT 1 FROM building)
ON CONFLICT (user_id, entity_id) DO NOTHING;

-- ── 8. user_flats → additional memberships at flat entities ──────
-- Carries the user's existing role; skips duplicates created in step 6.
INSERT INTO memberships (user_id, entity_id, role, weight, status, created_at)
SELECT
  uf.user_id,
  uf.flat_id,
  u.role::text::membership_role,
  1,
  CASE
    WHEN u.is_active AND u.status = 'active' THEN 'active'::membership_status
    WHEN u.status = 'pending' THEN 'pending'::membership_status
    ELSE 'archived'::membership_status
  END,
  uf.created_at
FROM user_flats uf
JOIN users u ON u.id = uf.user_id
ON CONFLICT (user_id, entity_id) DO NOTHING;

-- ── 9. Sanity check ──────────────────────────────────────────────
-- Fail loudly if any entity row is missing path/depth/root_id.
DO $$
DECLARE
  bad_count integer;
BEGIN
  SELECT count(*) INTO bad_count
  FROM entities
  WHERE path IS NULL OR root_id IS NULL OR depth IS NULL;
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Backfill produced % entity rows with NULL path/root_id/depth', bad_count;
  END IF;
END $$;
