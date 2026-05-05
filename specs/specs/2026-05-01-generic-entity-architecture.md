---
spec_id: RES-20260501-002
title: "Generalize building model into a flexible Entity primitive"
status: spec
created: 2026-05-01
updated: 2026-05-04
author: open-housing
owner: open-housing
last_verified: 2026-05-01
project_type: other
depends_on: []
related_handoffs: []
tags: [architecture, schema, multi-tenant, refactor, entity-model]
feature_branch: feature/generic-entity-architecture
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal
The app is currently hard-modelled around a single domain: an HOA building
with entrances, flats, ownership shares, and Slovak/Czech HOA voting law.
We want to broaden the addressable market — neighbourhood/street
associations, parents around a shared playground, garage cooperatives,
allotment garden communities, and similar groups all need the same core
features (membership, posts, voting, documents, notifications) but they do
not have flats or ownership shares. This spec generalizes the central
container concept from `building` into a flexible `entity` primitive with
a typed kind (housing, street, playground, garage, garden, …) so the same
codebase can serve all of these communities without forking the schema.
Ownership-share and entrance/flat semantics become characteristics of one
entity kind (housing) rather than assumptions baked into every table.

The app's identity stays governance-focused: voting, discussion, documents,
modules. It does not become a generic social network. Non-housing kinds
unlock the same governance feature set for groups that share property,
responsibilities, or duties — not casual social groups. This is enforced by
keeping kind onboarding restricted to operators (see Approach), not exposed
in end-user settings.

The default experience for existing and new tenants stays exactly as it is
today (single housing community, building → entrances → flats). Switching
to a different tree shape or non-housing kind requires deliberate operator
action (seed script, CLI, or authenticated admin API) — never an in-app
settings toggle. A regular community admin cannot accidentally re-architect
their tenant.

## Scope
**In scope:**
- New `entities` table modeling a self-referencing tree of arbitrary depth.
- `kind` enum on entities: at minimum `housing_community`, `housing_block`,
  `housing_entrance`, `housing_unit`, `street_community`, `playground_group`,
  `garage_cooperative`, `garden_allotment`, `generic_group`. Extensible.
- `memberships` table replacing the current implicit user↔flat link, with a
  per-membership role and optional `weight` for voting.
- Migration plan that turns each existing `building` into a root `entity`,
  each `entrance` into a child entity, each `flat` into a leaf entity, and
  each `users.flatId` / `userFlats` row into a `memberships` row — without
  data loss and without breaking voting history.
- Repointing of existing tables that currently reference
  `building`/`entrance`/`flat` IDs (votings, posts, documents, mandates,
  votes, registration_links once introduced, community posts, etc.) to use
  `entityId` instead, with visibility scoping resolved via tree ancestry.
- Read APIs for tree traversal (`getAncestors`, `getDescendants`,
  `getSubtreeMemberships`) plus the indexes needed to keep them fast.
- Updated permissions model: a user's role applies to the entity it was
  granted on and is inherited downward through the subtree unless
  overridden by a closer (descendant) membership row.

**Out of scope:**
- Renaming user-facing copy / translation keys for non-housing kinds beyond
  what is needed to remove "flat"/"entrance" hard-codes from the housing
  flow. Per-kind UI polish ships in follow-up specs.
- Cross-entity (multi-root) features like federated voting between
  unrelated communities.
- **Any in-app settings UI for editing the entity tree, changing entity
  kind, or restructuring parent/child relationships.** Tree mutation is
  an operator concern, not an end-user feature.
- Replacing the existing Slovak/Czech HOA voting law engine; it remains
  bound to the `housing_*` kinds.
- Billing / per-tenant isolation work — that is the open-resiapp-cloud
  project's concern.
- Turning the app into a generic community / social network. Non-housing
  kinds inherit only the governance features (voting, posts, documents,
  modules). Anything outside that frame is rejected.

## Approach

### Operator-only mutation surface
Tree shape and entity kind are infrastructure decisions, not user
preferences. Mutation is exposed exclusively through:

1. **First-time setup script.** A new tenant runs `pnpm setup:tenant`
   (or the equivalent inside the Docker entrypoint). Default seeds the
   familiar housing tree (1 community → 1 entrance → N flats placeholder).
   A `--kind playground_group` (or any other supported kind) flag swaps
   the seed for that kind's bootstrap shape. Documented in
   `docs/operations/tenant-bootstrap.md`.
2. **Authenticated admin API** under `/api/admin/entities/*`, gated by
   the existing API-key system (`src/lib/api-keys.ts`) with the `full`
   permission level. Endpoints: create, set-parent, set-kind (one-way,
   guarded), archive, attach extension data. No NextAuth session is
   accepted on these routes — only API keys, audit-logged.
3. **Operator CLI** wrapping the same admin API for shell use. Lives in
   `scripts/entity-admin/` with `--dry-run` by default and explicit
   `--apply` to persist. Mirrors the API one-to-one so behaviour is
   identical regardless of entry point.

The web settings UI is read-only with respect to entity tree shape: it can
display the current tree, breadcrumbs, and per-entity metadata, but offers
no buttons to add, move, re-kind, or remove entities. This keeps blast
radius low — a misconfigured tree breaks voting eligibility — and keeps
the surface unintimidating for non-technical community admins.

### Default behaviour preservation
For any existing or freshly-created tenant that does not opt in, the tree
collapses to today's experience: a single root entity of kind
`housing_community`, with `housing_entrance` children and `housing_unit`
leaves. Every existing UI screen, query, and permission check continues to
work because the only change underneath is which table the data lives in.
Operators only need to act when they want a non-housing kind or a deeper /
flatter tree.

### Naming
The container concept is renamed `entity` in the schema and code. User-facing
copy keeps domain words (`Building`, `Community`, `Group`) per `entity.kind`
via translation namespaces. The previous `building` / `entrances` / `flats`
tables are retired in favour of rows in `entities` discriminated by `kind`.

### Tree representation
Self-referencing table with a hybrid path strategy:
- `entities.parentId uuid references entities(id) on delete restrict`
- `entities.path text not null` — materialized path of ancestor IDs
  (`/<rootId>/<childId>/<...>/<selfId>/`) maintained by triggers or in the
  query layer. Indexed `text_pattern_ops` for prefix-match descendant
  queries.
- `entities.depth integer not null` — for cap-checks and breadcrumb UI.
- `entities.rootId uuid not null` — denormalized, equals the topmost ancestor
  for fast tenant-style scoping.
- Optional Postgres `ltree` extension can replace `path`; deferred unless
  query perf demands it. The materialized-path approach works without
  extensions and stays portable.

Cycle prevention is enforced at write-time by re-deriving `path` from
`parentId` and rejecting writes where the new path would contain `selfId`
already.

### Kinds and extension data
`kind` is an enum on `entities`. Kind-specific data lives in extension
tables joined 1:1 by `entityId`:
- `housing_unit_data` — `flatNumber`, `floor`, `shareNumerator`,
  `shareDenominator`, `area`. Required when `kind = 'housing_unit'`.
- `housing_root_data` — `address`, `ico`, `votingMethod`, `country`,
  `governanceModel`, `legalNotice`. Required when
  `kind in ('housing_community', 'housing_block')`.
- Future kinds add their own extension tables; core code never branches
  on kind for fields it does not need.

### Memberships and roles
`memberships(id, userId, entityId, role, weight, status, createdAt)` with a
unique index on `(userId, entityId)`. A user can be a member of any entity
in the tree, at any level. Effective permission for `(user, entity)` is the
nearest-ancestor membership of that user along the entity's path; if none
exists, the user is not a member of that subtree. `weight` defaults to 1
for non-housing kinds; for `housing_unit` it is derived from the linked
`housing_unit_data` share. The legacy `users.flatId` and `userFlats` tables
are removed in favour of `memberships`.

### Repointing existing references
Every FK currently pointing at `building.id`, `entrances.id`, or `flats.id`
is migrated to `entities.id`. Affected tables include at least:
`votings`, `votes`, `mandates`, `posts`, `documents`, community posts and
related tables, board members, governance settings. Each retains the
`entityId` semantics it had before (e.g. `votings.entityId` is the voting's
scope; descendants of that entity inherit visibility).

### Migration strategy (single deploy, no dual-run)
1. Create `entities`, extension tables, and `memberships`.
2. Backfill `entities` from existing `building` (root), `entrances`
   (children), `flats` (leaves). Generate `path`/`depth`/`rootId` during
   the same migration.
3. Backfill extension tables from the matching legacy rows.
4. Backfill `memberships` from `users.flatId` + `userFlats`.
5. Add new `entityId` FK columns alongside the legacy `buildingId` /
   `entranceId` / `flatId` columns (still nullable at this point).
6. Backfill the new columns from the legacy ones via the lookup created
   in step 2.
7. Switch application code to read/write the new columns.
8. In a follow-up migration (next deploy), drop the legacy columns and
   the legacy tables.

This phased order means a single deploy is reversible: a rollback drops
the new columns and continues using the legacy ones.

### Permission model changes
`lib/permissions.ts` is rewritten around `(user, entity)` membership lookup.
Helpers exposed: `requireMembership(entityId, minRole)`,
`getEffectiveRole(userId, entityId)`, `listSubtreeMembers(rootEntityId)`.
Role inheritance walks `entities.path` from the target entity upward and
returns the strongest role from the user's matching memberships.

### Deletion semantics — soft-delete by default
Entities are never hard-deleted in normal operation. The `entities` table
gets an `archivedAt timestamp` column. All read paths default to
`WHERE archivedAt IS NULL`. Admin / audit screens can opt in to seeing
archived entities. Hard delete is reserved for entities that have:
- no descendants (live or archived),
- no memberships ever,
- no votings, posts, documents, or any other FK-pointing rows.
Anything else can only be archived. This preserves the legal voting
record (Slovak HOA law requires HOAs retain meeting/voting evidence) and
keeps undo cheap. Hard delete is operator-API only; the in-app UI offers
archive only.

### Multi-tree memberships allowed
A user may hold memberships across unrelated entity trees (HOA + street
committee + caretaker contracts). Schema imposes no single-tree limit. The
session gains a `currentEntityId` (defaults to the user's most recently
visited entity) and the header gets an entity switcher whenever the user
has memberships in more than one root. Notifications stay scoped per
entity. This unlocks the property-manager and freelance-caretaker use
cases that already exist in the Slovak HOA market.

### Tree representation — materialized path now, isolated for swap
We ship with the materialized-path approach (`text` column,
`text_pattern_ops` index, app-side maintenance) because it works on stock
Postgres and matches the current Drizzle conventions. All path mutation
and traversal logic lives in `src/lib/entity-tree.ts` so a future swap to
`ltree` (or any other strategy) touches one file. Trigger any swap only
if perf testing on a 10k-entity / depth-6 synthetic tree shows real
regressions.

### Role model — split global vs. per-membership
Two enums, two tables:
- `users.platformRole` (`platformRoleEnum`) defaults `member`. The only
  other value today is `superadmin` (cross-tenant operator account, used
  by the open-resiapp-cloud SaaS layer; locked off in self-hosted).
- `memberships.role` (`membershipRoleEnum`) carries the existing values
  `admin | owner | tenant | vote_counter | caretaker`. These are now
  always per-entity and inherit down the subtree.

The current `userRoleEnum` is migrated: existing users get a single
membership row at the root entity carrying their old role; their
`platformRole` is set to `member`. Permission helpers move from
`requireRole(userId, role)` to `requireRole(userId, entityId, minRole)`.

### Voting and entity scope
A voting's "constituency" becomes the set of memberships whose nearest
ancestor along their entity path matches `votings.entityId`. For housing
kinds this preserves today's behaviour (a vote scoped to an entrance only
counts owners of that entrance's flats). For non-housing kinds it gives
one-member-one-vote out of the box via `memberships.weight = 1`.

## Acceptance Criteria
- [ ] `entities`, `memberships`, and per-kind extension tables exist with
      the schema described above and the migration plan applied to a copy
      of production-shaped data without errors.
- [ ] An existing seeded HOA in dev migrates to the new schema with zero
      changes to: visible voting results, post visibility, document
      visibility, board membership, user login.
- [ ] Tree operations have indexed `O(log n)` reads at minimum: ancestors,
      descendants, subtree-member listing all run in a single SQL round
      trip.
- [ ] Cycle creation (`setParent` that would close a loop) is rejected
      with a clear error and never persisted.
- [ ] `lib/permissions.ts` resolves an effective role for any
      `(user, entity)` pair using only the new tables.
- [ ] All existing voting / post / document / community routes compile and
      pass tests against the new schema with no references to `building`,
      `entrances`, or `flats` remaining.
- [ ] A new entity of kind `playground_group` can be created via admin UI,
      members can be added, and a vote run on it produces results using
      `memberships.weight = 1` without any housing-specific code path.
- [ ] Deletion of an entity with descendants is blocked unless the caller
      explicitly opts into recursive deletion; orphaned memberships are
      either cascaded or refused (decision recorded under Notes).
- [ ] Admin UI displays the entity tree breadcrumb / path **read-only**;
      no in-app controls create, move, re-kind, archive, or delete
      entities.
- [ ] All tree mutations (create, set-parent, set-kind, archive, hard-delete)
      are reachable only via `/api/admin/entities/*` with a `full` API key
      or via `scripts/entity-admin/` CLI. Both are audit-logged.
- [ ] `pnpm setup:tenant` boots a tenant with the default housing tree
      and zero post-setup steps. `--kind <other>` swaps to that kind's
      seed. Documented in `docs/operations/tenant-bootstrap.md`.
- [ ] Soft-delete works: `archivedAt` set on an entity removes it from all
      live queries; voting / post / document records stay intact and
      auditable. Hard delete is rejected unless the entity has no
      descendants, memberships, or referencing rows of any kind.
- [ ] A user with memberships in two unrelated entity trees can switch
      between them via the header switcher; notifications, posts, and
      voting eligibility scope correctly per current entity.
- [ ] `users.platformRole` and `memberships.role` exist as separate enums.
      All permission checks call `requireRole(userId, entityId, minRole)`
      (or equivalent helper) — the legacy global `users.role` is removed.
- [ ] Path traversal logic is contained in `src/lib/entity-tree.ts`; no
      other module parses or constructs `entities.path` strings.
- [ ] Rollback path documented and tested: dropping the new columns and
      tables returns the app to its prior working state.

## Project Context
- Spec prefix: RES.
- Existing schema lives in `src/db/schema.ts`. Migrations in
  `drizzle/migrations/`. Schema changes go through `pnpm db:generate`.
- Existing seed (`src/db/seed.ts`) must be updated to seed via `entities`
  + `memberships` rather than `building`/`entrances`/`flats` — same final
  shape, new tables.
- `RES-20260501-001` (bulk QR registration) lands first against the
  current schema; once this spec ships, `registration_links.entranceId`
  becomes `entityId` as part of the table-repoint step.
- Slovak/Czech HOA voting law engine is preserved unchanged; it simply
  reads `housing_unit_data` via the new join instead of `flats` directly.
- `next-intl` keys for new entity kinds will be added in both `sk.json`
  and `en.json` per project rules.

## Notes
- 2026-05-04: locked the four open architectural questions:
  1. **Deletion** — soft-delete by default (`archivedAt`), hard-delete
     only when no descendants/memberships/references exist, operator-API
     only.
  2. **Multi-tree membership** — allowed; header gets an entity switcher
     when user has memberships across multiple roots.
  3. **Tree representation** — materialized path, isolated in
     `src/lib/entity-tree.ts`. ltree only if perf demands it later.
  4. **Role enum split** — `users.platformRole` (`member` |
     `superadmin`) plus per-membership `memberships.role` carrying the
     existing HOA roles. Drops the legacy global `users.role`.
- 2026-05-04: scoped tree mutation to operator-only entry points (setup
  script, admin API with `full` key, CLI). No end-user settings UI for
  tree shape or kind. Default behaviour preserves the current HOA tree
  for every existing and new tenant — no migration required for
  customers who do not opt in.
- 2026-05-04: enforced product framing — non-housing kinds inherit only
  governance features (voting, posts, documents, modules). The app does
  not become a generic community / social network platform.
- Still open: exact set of supported `kind` values for v1. Working list:
  `housing_community`, `housing_block`, `housing_entrance`, `housing_unit`,
  `street_community`, `playground_group`, `garage_cooperative`,
  `garden_allotment`, `generic_group`. Trim before implementation —
  shipping fewer is cheaper than removing later.
- Still open: shape of the operator audit log entries for tree
  mutations. Likely reuses `src/lib/audit-log.ts`; needs a dedicated
  action enum (`entity.create`, `entity.set_parent`, `entity.archive`,
  `entity.set_kind`, `entity.hard_delete`).
