# Phase 9 cutover plan — drop legacy schema

**Status:** prep + compat layer ready. Destructive migration NOT
generated. Sequence the chunks below across multiple deploys.

## Audit — 31 files reading legacy tables

```
A. Building reads (single-tenant root config)
   - src/app/api/building/route.ts                     → getCommunityRoot()
   - src/app/api/manifest/route.ts                     → getCommunityRoot()
   - src/app/api/external/v1/building/route.ts         → getCommunityRoot() + listEntrances()
   - src/app/api/external-connections/route.ts         → getCommunityRoot()
   - src/app/[locale]/(dashboard)/community-info/page.tsx → getCommunityRoot()

B. Entrance / flat CRUD (will become operator-only via /api/admin/entities)
   - src/app/api/entrances/route.ts                    → /api/admin/entities (kind=housing_entrance)
   - src/app/api/entrances/[id]/route.ts
   - src/app/api/flats/route.ts                        → /api/admin/entities (kind=housing_unit)
   - src/app/api/flats/[id]/route.ts
   - src/app/api/flats/[id]/owners/route.ts            → listSubtreeMemberships() filtered to housing_unit
   - src/app/api/external/v1/flats/route.ts            → re-derive from entities + housing_unit_data
   - src/app/api/external/v1/stats/route.ts            → count via entities (kind filter)

C. User-flat link (replaced by memberships)
   - src/app/api/users/route.ts                        → listUserFlats() + memberships
   - src/app/api/users/[id]/route.ts                   → already partly switched in 6f; complete the user.flatId/role removal
   - src/app/api/external/v1/users/route.ts            → memberships
   - src/app/api/external/v1/users/[id]/route.ts       → memberships
   - src/app/api/external/v1/pair/route.ts             → memberships
   - src/app/api/register/route.ts                     → memberships only
   - src/app/api/registrations/[id]/approve/route.ts   → memberships only
   - src/app/api/invitations/[token]/route.ts          → entityId reference

D. Posts / community / nav (visibility filters already entity-aware in 6c/6d)
   - src/app/api/posts/route.ts                        → drop entrances leftJoin
   - src/app/api/community/posts/route.ts              → drop entrances leftJoin
   - src/app/api/community/posts/[id]/route.ts
   - src/app/api/community/directory/route.ts          → memberships

E. Module system (still references building.id as community marker)
   - src/lib/modules/install.ts                        → swap building.id for root entity id from getCommunityRoot()
   - src/lib/modules/loader.ts
   - src/lib/modules/sdk-runtime.ts
   - src/lib/modules/dispatch.ts
   - src/lib/modules/bootstrap-bundled.ts              → already uses entities; tighten away from building

F. Board members
   - src/app/api/board-members/route.ts                → drop building.id read; entityId already populated

G. Type re-exports
   - src/types/index.ts                                → drop Building/Entrance/Flat InferSelectModel exports
```

## Compat layer ready

`src/lib/legacy-compat.ts` exports drop-in helpers:
- `getCommunityRoot()` → replaces `db.select().from(building).limit(1)`
- `listCommunityRoots()` → replaces full `building` listing
- `listEntrances(rootId)` → replaces `entrances` per-building reads
- `getFlatById(flatId)` / `listFlatsForEntrance(entranceId)` → replace `flats` reads
- `listUserFlats(userId)` → replaces `userFlats→flats` joins
- `getUserPrimaryRole(userId)` → replaces direct `users.role` reads
- `getPrimaryFlatId(userId)` → replaces direct `users.flatId` reads

Mechanical migration path: each call site in the audit above changes
`from "@/db/schema"` import to `from "@/lib/legacy-compat"` and swaps
the Drizzle query for the helper call. Once every call site goes
through the shim file, the underlying tables can be dropped without
touching call sites again.

## Chunked deploy plan

Each chunk is a separate PR + deploy + 24h soak before the next.

1. **9.1a** — building reads → compat layer (5 files in section A).
   Verify dashboard / manifest still render. No schema change.
2. **9.1b** — entrance / flat CRUD → admin entities API (section B,
   ~7 files). UI surfaces become read-only on user side; operator gets
   `pnpm entity-admin` instead. No schema change.
3. **9.1c** — user-flat link → memberships only (section C, ~8 files).
   Drop `users.flatId` writes; keep column for now.
4. **9.1d** — module system + posts cleanup (D + E + F, ~9 files).
   No schema change.
5. **9.1e** — drop dual-write blocks across the 8 INSERT sites from
   Phase 6a. Now every new row writes only `entity_id`.
6. **9.2a** — pre-cutover sanity checks (5 SQL queries below).
7. **9.2b** — destructive migration: drop legacy columns, drop legacy
   tables in this order: `user_flats` → `flats` → `entrances` → `building`,
   drop `userRoleEnum`, drop `users.role` and `users.flatId` columns.
   **No rollback** beyond the pg_dump from the entrypoint.
8. **9.2c** — drop `src/lib/legacy-compat.ts` and `UserRole` type.

## Pre-cutover sanity checks

Run before chunk 9.2b. Every count must be 0.

```sql
-- 1. Voting refs vs. entities
SELECT count(*) FROM mod_voting_votings
WHERE entity_id IS NULL
   OR (entrance_id IS NOT NULL AND entity_id <> entrance_id);

SELECT count(*) FROM mod_voting_votes
WHERE entity_id IS NULL OR entity_id <> flat_id;

SELECT count(*) FROM mod_voting_mandates
WHERE from_entity_id IS NULL OR from_entity_id <> from_flat_id;

-- 2. Posts / documents / community / boards / grants
SELECT 'posts' AS t, count(*) FROM posts WHERE entity_id IS NULL
UNION ALL SELECT 'documents', count(*) FROM documents WHERE entity_id IS NULL
UNION ALL SELECT 'community_posts', count(*) FROM community_posts WHERE entity_id IS NULL
UNION ALL SELECT 'board_members', count(*) FROM board_members WHERE entity_id IS NULL
UNION ALL SELECT 'core_module_grants', count(*) FROM core_module_grants WHERE entity_id IS NULL;

-- 3. Memberships fully cover users.flat_id
SELECT count(*) FROM users u
LEFT JOIN memberships m
  ON m.user_id = u.id AND m.entity_id = u.flat_id AND m.status = 'active'
WHERE u.flat_id IS NOT NULL AND m.id IS NULL;

-- 4. user_flats fully mirrored in memberships
SELECT count(*) FROM user_flats uf
LEFT JOIN memberships m
  ON m.user_id = uf.user_id AND m.entity_id = uf.flat_id AND m.status = 'active'
WHERE m.id IS NULL;
```

If any check returns > 0, abort and run a backfill before proceeding.

## Destructive migration outline (chunk 9.2b)

Generated by `pnpm db:generate` after schema.ts edits below land:

```ts
// src/db/schema.ts — Phase 9.2 edits
// users
//   - drop `role: userRoleEnum(...)`
//   - drop `flatId: uuid("flat_id").references(() => flats.id)`
// votings
//   - drop `entranceId: uuid("entrance_id").references(...)`
//   - mark `entityId` NOT NULL
// votes / mandates / posts / documents / community_posts /
// invitations / board_members / core_module_grants
//   - drop the matching legacy FK column, mark entity_id NOT NULL
// table drops (in dependency order):
//   - user_flats     → DROP TABLE
//   - flats          → DROP TABLE
//   - entrances      → DROP TABLE
//   - building       → DROP TABLE
// enum drops:
//   - DROP TYPE user_role
```

Drizzle-kit will generate a destructive migration. Review before
applying. **There is no rollback** beyond restoring the pg_dump created
by the entrypoint pre-migration backup step.

## Acceptance criteria

- [ ] All 31 files migrated to legacy-compat or admin entities API.
- [ ] All `// Phase 4 dual-run` comments removed from src/.
- [ ] All sanity SQL queries return 0.
- [ ] Schema no longer references `users.role`, `users.flatId`,
      `user_flats`, `flats`, `entrances`, `building`, `userRoleEnum`.
- [ ] Every legacy FK column on the 9 dual-run tables is dropped and
      its entity_id counterpart is NOT NULL.
- [ ] `pnpm dev` boots, voting flow runs end-to-end, no API responses
      change shape from current dual-run state.
- [ ] Rollback procedure documented with exact restore commands.
