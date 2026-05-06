-- Phase 9.2 — destructive drop of legacy schema.
-- After this migration the entity tree (entities + housing_*_data + memberships)
-- is the only source of truth. There is no rollback beyond the pre-migration
-- pg_dump produced by docker-entrypoint.sh.
--
-- Pre-flight sanity (every count must be 0):
--   1. mod_voting_votings: entity_id IS NULL
--   2. mod_voting_votes:   entity_id IS NULL
--   3. mod_voting_mandates: from_entity_id IS NULL
--   4. posts/documents/community_posts/board_members/core_module_grants:
--      entity_id IS NULL
--   5. user_flats fully mirrored in memberships
--   6. users.flat_id fully mirrored in memberships

BEGIN;

-- ── 1. Drop legacy FK constraints first so column drops succeed ───
ALTER TABLE mod_voting_votings  DROP CONSTRAINT IF EXISTS mod_voting_votings_entrance_id_entrances_id_fk;
ALTER TABLE mod_voting_votes    DROP CONSTRAINT IF EXISTS mod_voting_votes_flat_id_flats_id_fk;
ALTER TABLE mod_voting_mandates DROP CONSTRAINT IF EXISTS mod_voting_mandates_from_flat_id_flats_id_fk;
ALTER TABLE posts               DROP CONSTRAINT IF EXISTS posts_entrance_id_entrances_id_fk;
ALTER TABLE documents           DROP CONSTRAINT IF EXISTS documents_entrance_id_entrances_id_fk;
ALTER TABLE community_posts     DROP CONSTRAINT IF EXISTS community_posts_entrance_id_entrances_id_fk;
ALTER TABLE invitations         DROP CONSTRAINT IF EXISTS invitations_flat_id_flats_id_fk;
ALTER TABLE board_members       DROP CONSTRAINT IF EXISTS board_members_building_id_building_id_fk;
ALTER TABLE core_module_grants  DROP CONSTRAINT IF EXISTS core_module_grants_building_id_building_id_fk;
ALTER TABLE users               DROP CONSTRAINT IF EXISTS users_flat_id_flats_id_fk;

-- ── 2. Drop legacy unique indexes that key on dropped columns ────
DROP INDEX IF EXISTS mod_voting_votes_voting_flat_idx;
DROP INDEX IF EXISTS mod_voting_mandates_voting_flat_idx;
DROP INDEX IF EXISTS core_module_grants_building_module_idx;
DROP INDEX IF EXISTS user_flats_user_flat_idx;

-- ── 3. Drop legacy columns from dual-run tables ──────────────────
ALTER TABLE mod_voting_votings  DROP COLUMN IF EXISTS entrance_id;
ALTER TABLE mod_voting_votes    DROP COLUMN IF EXISTS flat_id;
ALTER TABLE mod_voting_mandates DROP COLUMN IF EXISTS from_flat_id;
ALTER TABLE posts               DROP COLUMN IF EXISTS entrance_id;
ALTER TABLE documents           DROP COLUMN IF EXISTS entrance_id;
ALTER TABLE community_posts     DROP COLUMN IF EXISTS entrance_id;
ALTER TABLE invitations         DROP COLUMN IF EXISTS flat_id;
ALTER TABLE board_members       DROP COLUMN IF EXISTS building_id;
ALTER TABLE core_module_grants  DROP COLUMN IF EXISTS building_id;

-- ── 4. Promote entity_id to NOT NULL where applicable ───────────
ALTER TABLE mod_voting_votings  ALTER COLUMN entity_id SET NOT NULL;
ALTER TABLE mod_voting_votes    ALTER COLUMN entity_id SET NOT NULL;
ALTER TABLE mod_voting_mandates ALTER COLUMN from_entity_id SET NOT NULL;
ALTER TABLE posts               ALTER COLUMN entity_id SET NOT NULL;
ALTER TABLE documents           ALTER COLUMN entity_id SET NOT NULL;
ALTER TABLE community_posts     ALTER COLUMN entity_id SET NOT NULL;
ALTER TABLE board_members       ALTER COLUMN entity_id SET NOT NULL;
ALTER TABLE core_module_grants  ALTER COLUMN entity_id SET NOT NULL;
-- invitations.entity_id stays nullable (matches legacy invitations.flat_id).

-- ── 5. Re-create unique indexes keyed on entity_id ──────────────
CREATE UNIQUE INDEX mod_voting_votes_voting_entity_idx
  ON mod_voting_votes USING btree (voting_id, entity_id);

CREATE UNIQUE INDEX mod_voting_mandates_voting_entity_idx
  ON mod_voting_mandates USING btree (voting_id, from_entity_id);

CREATE UNIQUE INDEX core_module_grants_entity_module_idx
  ON core_module_grants USING btree (entity_id, module_name);

-- ── 6. Drop legacy users columns (FK only — keep role enum) ────
-- users.role stays as a denormalized cache for hasPermission().
-- users.flat_id is gone (memberships are authoritative for owner-flat).
ALTER TABLE users DROP COLUMN IF EXISTS flat_id;

-- ── 7. Drop legacy tables in dependency order ───────────────────
DROP TABLE IF EXISTS user_flats;
DROP TABLE IF EXISTS flats;
DROP TABLE IF EXISTS entrances;
DROP TABLE IF EXISTS building;
-- userRoleEnum kept; full drop deferred to a later release.

-- ── 9. Sanity ───────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name IN
             ('building','entrances','flats','user_flats')) THEN
    RAISE EXCEPTION 'Phase 9.2 failed — legacy table still present';
  END IF;
END $$;

COMMIT;
