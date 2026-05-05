# Phase 9 cutover plan — drop legacy schema

**Status:** prep only. Do NOT run until the Phase 6/7/8 deploy has been
in production for at least 14 days, the dual-write data has been
spot-checked across every affected table, and a full pg_dump exists.

## Pre-cutover checks

Run before generating the migration:

```sql
-- 1. Every voting must have a non-null entity_id matching its entrance_id
SELECT count(*) FROM mod_voting_votings
WHERE entity_id IS NULL
   OR (entrance_id IS NOT NULL AND entity_id <> entrance_id);
-- Expected: 0

-- 2. Every vote / mandate has entity_id == flat_id
SELECT count(*) FROM mod_voting_votes
WHERE entity_id IS NULL OR entity_id <> flat_id;
SELECT count(*) FROM mod_voting_mandates
WHERE from_entity_id IS NULL OR from_entity_id <> from_flat_id;
-- Expected: 0 / 0

-- 3. Every post / document / community_post / board_member /
--    core_module_grant has entity_id populated
SELECT 'posts' AS t, count(*) FROM posts WHERE entity_id IS NULL
UNION ALL SELECT 'documents', count(*) FROM documents WHERE entity_id IS NULL
UNION ALL SELECT 'community_posts', count(*) FROM community_posts WHERE entity_id IS NULL
UNION ALL SELECT 'board_members', count(*) FROM board_members WHERE entity_id IS NULL
UNION ALL SELECT 'core_module_grants', count(*) FROM core_module_grants WHERE entity_id IS NULL;
-- Expected: 0 across the board

-- 4. Every active user with a flat has a matching membership
SELECT count(*) FROM users u
LEFT JOIN memberships m
  ON m.user_id = u.id AND m.entity_id = u.flat_id AND m.status = 'active'
WHERE u.flat_id IS NOT NULL AND m.id IS NULL;
-- Expected: 0

-- 5. user_flats fully mirrored in memberships
SELECT count(*) FROM user_flats uf
LEFT JOIN memberships m
  ON m.user_id = uf.user_id AND m.entity_id = uf.flat_id AND m.status = 'active'
WHERE m.id IS NULL;
-- Expected: 0
```

If any check returns a nonzero count, abort and run a backfill before
proceeding.

## Code prep (PR before the destructive deploy)

These edits replace the remaining legacy reads with entity / membership
reads. They land in a separate PR ahead of the migration so the running
app can survive the column drops.

1. **`hasPermissionForUser(user, perm)` callers** — replace with
   `requireEntityPermission(userId, entityId, perm)`. Every server
   action / route handler that currently reads `session.user.role` for
   gating gains an `entityId` parameter (current entity from the cookie
   resolver added in Phase 8).
2. **`users.role` reads** — drop the column. All role logic flows from
   `memberships.role` resolved via the entity. `users.platformRole`
   stays for the cross-tenant superadmin marker.
3. **`users.flatId` reads** — replace with a `memberships` query
   filtered to `kind = 'housing_unit'`. There can be N flats per user;
   any UI surface that assumes a single flat needs an explicit pick.
4. **`userFlats` reads** — every join becomes a `memberships` join with
   `housing_unit_data` for share/area/floor.
5. **`flats` reads** — replace with `entities + housing_unit_data`.
6. **`entrances` reads** — replace with `entities` filtered to
   `kind = 'housing_entrance'`. Display name lives on `entities.name`.
7. **`building` reads** — replace with the root entity row + the
   `housing_root_data` extension table for ICO / address / voting
   method / governance model / country / cross-entrance flag.
8. **Dual-write hot paths** — drop the legacy column writes. Search for
   `// Phase 4 dual-run` comments in `/api/posts`, `/api/community/posts`,
   `/api/votings`, `/api/votes`, `/api/mandates`, `/api/board-members`,
   `/api/invitations`, `/api/registrations/[id]/approve`, `/api/register`,
   `/api/users/[id]`, `/api/external/v1/users`, `/api/external/v1/users/[id]`,
   `src/lib/modules/install.ts`. Each comment marks a write to remove.
9. **`/api/flats/*`, `/api/entrances/*`** — repoint to the operator-only
   admin entities API. The end-user UI shouldn't have CRUD on these
   anyway; if any settings page still does, redirect it to a read-only
   tree view.
10. **External API contract** — `/api/external/v1/flats`,
    `/api/external/v1/building`, `/api/external/v1/users`. Decide
    per-endpoint whether to keep the legacy response shape (re-derive
    from entities) or version-bump to v2 with an entity payload. Until
    that decision, keep the v1 shape and re-derive.
11. **`UserRole` type** — remove. Replace with `MembershipRole` from
    `entity-tree`.

## Migration SQL outline

Generate via `pnpm db:generate` after the schema edits below:

```ts
// src/db/schema.ts — drop legacy columns / tables
// users — remove role + flatId columns
// votings — drop entranceId; make entityId NOT NULL
// votes — drop flatId; make entityId NOT NULL
// mandates — drop fromFlatId; make fromEntityId NOT NULL
// posts / documents / communityPosts — drop entranceId; entityId NOT NULL
// invitations — drop flatId
// boardMembers — drop buildingId; make entityId NOT NULL
// coreModuleGrants — drop buildingId; make entityId NOT NULL
// userFlats table — DROP
// flats table — DROP
// entrances table — DROP
// building table — DROP
// userRoleEnum — DROP TYPE
```

Drizzle-kit will generate a destructive migration. Review carefully —
**there is no rollback** beyond the pre-cutover pg_dump.

## Cutover order on deploy day

1. Take a fresh `pg_dump --format=custom`.
2. Deploy the code-prep PR (entity-only reads + dual-write removal).
3. Wait 24h for soak.
4. Run the destructive migration via `pnpm db:migrate`.
5. Smoke-test voting create/cast, post create, member assign,
   admin entity tree.
6. If anything regresses, restore from the dump.

## Acceptance criteria

- [ ] 5 sanity SQL queries return 0 before the destructive deploy.
- [ ] All `// Phase 4 dual-run` comments are removed from src/.
- [ ] `users.role`, `users.flatId`, `user_flats`, `flats`, `entrances`,
      `building`, `userRoleEnum` no longer exist in the schema.
- [ ] Every legacy FK column on the 9 dual-run tables is dropped and
      its `entity_id`/`from_entity_id` counterpart is `NOT NULL`.
- [ ] `pnpm dev` boots, voting flow runs end-to-end, all routes return
      identical data shape to pre-deploy.
- [ ] Rollback procedure documented with exact restore commands.
