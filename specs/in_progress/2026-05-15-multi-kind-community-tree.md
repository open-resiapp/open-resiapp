---
spec_id: BYT-20260515-001
title: "Multi-kind community tree — replace hardcoded housing hierarchy with arbitrary recursive tree"
status: in_progress
created: 2026-05-15
updated: 2026-05-15
author: byt-app
owner: byt-app
last_verified: 2026-05-15
project_type: node
depends_on: []
related_handoffs: ["2026-05-15-open-resiapp-to-open-resiapp-cloud-community-template-selection.md"]
tags: [architecture, schema, entities, templates, multi-tenant, hoa, garden, garage, street]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Today the app hardcodes a single community shape — `housing_community → housing_block → housing_entrance → housing_unit` — backed by a Postgres enum (`entityKindEnum`) and two extension tables (`housing_root_data`, `housing_unit_data`). This locks the product to Slovak/Czech HOAs and blocks expansion to adjacent community types that share 80% of the app surface (voting, members, announcements, documents, meetings) but differ in tree shape and per-node fields.

This spec replaces the fixed hierarchy with an arbitrary recursive tree of typed nodes. **Kinds become data, not enum.** Per-node fields move from per-kind extension tables into a single `entities.data jsonb` column. A template system seeds the initial tree at install time, with English-only template identifiers in `setup.sh` and localized labels in `messages/{sk,en}.json`.

Strategic outcome: one codebase serves HOAs (`bytové domy`), garden communities (`záhradkárske osady`), garage buildings (`garážové domy`), streets with houses (`ulice s rodinnými domami`), and arbitrary custom hierarchies — without forking schema or voting logic.

## Scope

### In scope

- Replace `entityKindEnum` with a seed-driven `entity_kinds` catalog (table, not enum)
- Fold `housing_root_data` + `housing_unit_data` into `entities.data jsonb`
- Allow arbitrary tree depth and arbitrary subtree shape per node
- Kind-aware voting dispatcher (weighted-by-share for HOA, one-per-member for garden, one-per-unit for garage, custom-weight)
- Template system: declarative JSON files define root kind, default voting method, default roles, and starter tree shape per community type
- Templates shipped (v1, broad coverage): `hoa`, `garden`, `garage`, `street`, `cottage`, `urbar`, `apiary`, `marina`, `mobile_home_park`, `storage_units`, `office_building`, `coworking`, `industrial_park`, `cemetery`, `sports_club`, `hunting_association`, `fishing_cooperative`, `parents_association`, `religious_community`, `custom`
- `setup.sh` template picker (English identifiers, English prompts)
- Per-instance kind catalog — every instance has its own `entity_kinds` rows, seeded from the chosen template; instance admin can extend without affecting other instances
- Import wizard rebuild: pick kind at each tree level instead of choosing from 3 hardcoded structures
- UI labels per kind via translation namespace (`Kinds.hoa.community`, `Kinds.garden.plot`, etc.)
- Soft validation: `entity_kinds.allowed_parent_kinds` array enforces sane trees in the app layer (not DB)
- Data migration: existing communities backfilled as `hoa` template; existing entities remapped to new kind slugs; jsonb hydrated from extension tables; old tables dropped after verification
- Module/kind admin UI: superadmin can add custom `entity_kinds` rows per instance without code change

### Out of scope

- Multi-tenancy on a single instance (each customer instance stays single-community-rooted; multi-root per instance is a separate spec)
- Cross-kind voting (a single ballot spanning HOA + garden) — out of scope for v1
- Reporting/exports re-keyed by jsonb attributes (downstream spec once jsonb is stable)
- Accounting integration with new kinds — accounting module ([BYT-20260512-002](../specs/2026-05-12-accounting-module-hoa-finances.md)) stays HOA-only for now; garden/garage/street accounting is a follow-up
- Czech-specific kinds beyond what `hoa` template covers (see [Czech specs](../implemented/2026-04-13-czech-board-model.md))

## Approach

### Phase 1 — Schema groundwork

1. New table `entity_kinds`:
   ```
   slug text primary key            -- e.g. "community", "building", "entrance", "unit", "plot"
   display_name_key text            -- translation key, e.g. "Kinds.hoa.community"
   icon text                        -- lucide icon name
   allows_members boolean           -- can a user be a member of this node?
   votable boolean                  -- can this node be a voting scope?
   allowed_parent_kinds text[]      -- soft validation; empty = root only
   data_schema jsonb                -- JSON Schema for entities.data when kind = this
   sort_order int
   created_at, updated_at
   ```

2. Add `entities.data jsonb not null default '{}'::jsonb`

3. Seed `entity_kinds` with current values mapped:
   - `housing_community` → `community` (HOA template)
   - `housing_block` → `building`
   - `housing_entrance` → `entrance`
   - `housing_unit` → `unit` (HOA flat)
   - new: `garden_section`, `plot`, `garage_block`, `garage`, `street`, `house`

4. Change `entities.kind` from enum → text, FK to `entity_kinds.slug` (cascade restrict)

5. Drop `entityKindEnum` type after column converted

6. **Tree depth policy**: no hard cap in schema or code. UI shows a non-blocking warning when a user creates a node at depth > 6 ("Deep trees may be hard to navigate. Continue?"). Configurable per-instance via `instance_settings.deep_tree_warning_threshold` (default 6).

7. **Catalog scope**: `entity_kinds` is **per-instance**. Each instance owns its catalog. Templates seed the catalog at install time. Instance admin can add custom kinds via UI without affecting other instances. The cloud platform ([open-resiapp-cloud](../../../memory/MEMORY.md)) does not share kinds across tenants — every customer instance is sovereign.

### Phase 2 — Data migration

1. For every `entities` row with old kind, rewrite `kind` to new slug
2. For each `housing_root_data` row, merge fields into the matching `entities.data`:
   ```
   { address, voting_method, ico, country, ... }
   ```
3. For each `housing_unit_data` row, merge fields into the matching `entities.data`:
   ```
   { flat_number, floor, share_numerator, share_denominator, area_m2 }
   ```
4. Verify counts, spot-check queries, then drop `housing_root_data` + `housing_unit_data`

Migration must be reversible up to the point of dropping the old tables — keep them for one release cycle.

### Phase 3 — Voting dispatcher

`src/lib/voting.ts` currently assumes weighted-by-share. Refactor to dispatch on the community's voting method, declared in `entities.data.voting_method` on the root:

- `weighted_by_share` — HOA flats; reads `share_numerator/denominator` from each unit's `data`
- `one_per_member` — garden plots; one vote per member regardless of plot count
- `one_per_unit` — garages; one vote per garage unit
- `custom_weight` — admin-defined weight per membership

Each method gets its own quorum / pass-threshold rules, configurable per kind via `data_schema` on the root kind.

### Phase 4 — Template system

`src/lib/templates/{slug}.json` — one file per template. v1 ship list (20 templates):

| Slug | Display name (EN) | Tree shape | Default voting |
|------|-------------------|-----------|----------------|
| `hoa` | HOA / Residential building | community → building → entrance → flat | weighted_by_share |
| `garden` | Garden community | community → section → plot | one_per_member |
| `garage` | Garage building | community → garage_block → garage | one_per_unit |
| `street` | Street with houses | community → street → house | one_per_unit |
| `cottage` | Cottage settlement | community → zone → cottage | one_per_unit |
| `urbar` | Land commons (urbár) | community → parcel_group → parcel | weighted_by_share |
| `apiary` | Beekeeping association | community → apiary_zone → hive_owner | one_per_member |
| `marina` | Marina / boat club | community → dock → mooring | one_per_unit |
| `mobile_home_park` | Mobile home park | community → row → pad | one_per_unit |
| `storage_units` | Storage units facility | community → row → unit | one_per_unit |
| `office_building` | Office building | community → floor → office_suite | weighted_by_share |
| `coworking` | Coworking space | community → zone → desk | one_per_member |
| `industrial_park` | Industrial park | community → block → tenant_lot | weighted_by_share |
| `cemetery` | Cemetery plots | community → section → grave_plot | one_per_unit |
| `sports_club` | Sports club | community → section → member_locker | one_per_member |
| `hunting_association` | Hunting association | community → district → hunter | one_per_member |
| `fishing_cooperative` | Fishing cooperative | community → pond → license_holder | one_per_member |
| `parents_association` | Parents association | community → class → parent_seat | one_per_member |
| `religious_community` | Religious community / parish | community → congregation_group → member_household | one_per_member |
| `custom` | Custom — empty | (admin builds via UI) | one_per_member |

Each template file:

```json
{
  "slug": "garden",
  "display_name_key": "Templates.garden.name",
  "description_key": "Templates.garden.description",
  "root_kind": "community",
  "default_voting_method": "one_per_member",
  "default_roles": ["chairman", "vice_chairman", "member"],
  "starter_tree": [
    { "kind": "community", "name_key": "Templates.garden.sampleCommunityName",
      "children": [
        { "kind": "garden_section", "name_key": "Templates.garden.sampleSection" }
      ]
    }
  ],
  "import_levels": ["community", "garden_section", "plot"]
}
```

Templates loaded by:
- `setup.sh` for first-run install
- `/api/templates` for runtime template-driven community creation
- Import wizard for level picker

### Phase 5 — `setup.sh` rework

Add prompt after admin/community name, **English only**. Paged list since 20+ templates won't fit on one screen:

```
Pick community template (press Enter for default = hoa):

  Residential & housing
   1) hoa                  HOA / Residential building
   2) cottage              Cottage settlement
   3) street               Street with houses
   4) mobile_home_park     Mobile home park

  Land & nature
   5) garden               Garden community
   6) urbar                Land commons (urbár)
   7) apiary               Beekeeping association
   8) hunting_association  Hunting association
   9) fishing_cooperative  Fishing cooperative

  Commercial & shared
  10) garage               Garage building
  11) storage_units        Storage units facility
  12) office_building      Office building
  13) coworking            Coworking space
  14) industrial_park      Industrial park
  15) marina               Marina / boat club

  Social & civic
  16) sports_club          Sports club
  17) parents_association  School parents association
  18) religious_community  Religious community / parish
  19) cemetery             Cemetery plots

  20) custom               Custom — empty, configure via UI
```

Selection written to `.env` as `INSTALL_TEMPLATE={slug}`. On first boot, the `create-admin.ts` script (or a new `bootstrap-community.ts`) reads the env var and seeds the per-instance `entity_kinds` catalog and starter tree from the matching template JSON.

### Phase 6 — Import wizard rebuild

Replace 3 hardcoded structure radios in `src/app/[locale]/(dashboard)/admin/import/page.tsx` with:

1. Pick template OR start from empty
2. For each tree level the template declares (`import_levels`), pick the kind
3. Map CSV columns to kind-specific `data` fields (driven by `entity_kinds.data_schema`)

### Phase 7 — i18n + UI polish

- New translation namespace `Kinds.{template}.{kind}` for kind display names
- New namespace `Templates.{template}.{name,description,sampleCommunityName,...}`
- Update every place that hardcodes "Bytový dom" / "Vchod" / "Byt" labels to use kind-aware lookups
- Header / sidebar / breadcrumbs read the root kind to pick the right vocabulary

### Phase 8 — Cleanup

- Drop `housing_root_data`, `housing_unit_data` tables (after one release of dual-table parity)
- Drop legacy TS aliases (`Building`, `Entrance`, `Flat`) from `src/types/index.ts`
- Update [memory index](../../memory/MEMORY.md) to reflect new entity model
- Run `/spec-retro` against this spec to capture drift

## Acceptance Criteria

- [ ] `entity_kinds` table exists, seeded with `community`, `building`, `entrance`, `unit`, `garden_section`, `plot`, `garage_block`, `garage`, `street`, `house`
- [ ] `entities.kind` column is `text` referencing `entity_kinds.slug`; old `entityKindEnum` dropped
- [ ] `entities.data jsonb` column exists; populated for every existing entity from the prior extension tables
- [ ] Existing HOA installs migrate cleanly: voting, member lists, unit listings, share calculations all return identical results before vs after migration (verified by migration test suite)
- [ ] `housing_root_data` and `housing_unit_data` tables removed after parity verification window
- [ ] Voting dispatcher routes by `entities.data.voting_method` on the root; all four methods (`weighted_by_share`, `one_per_member`, `one_per_unit`, `custom_weight`) have unit + integration coverage
- [ ] Template files exist for `hoa`, `garden`, `garage`, `street`, `custom`; each declares root_kind, default_voting_method, default_roles, starter_tree, import_levels
- [ ] `setup.sh` prompts in English for template choice; writes `INSTALL_TEMPLATE` to `.env`
- [ ] Fresh install with each template produces a working community: admin can log in, see the seeded tree, add members, run a vote
- [ ] Import wizard supports kind picker per level instead of 3 hardcoded structures
- [ ] All kind labels in UI read from `Kinds.{template}.{kind}` translation keys; no hardcoded "Bytový dom", "Vchod", "Byt" strings remain
- [ ] Tree depth N supported: a kind can nest under any parent kind allowed by `allowed_parent_kinds`; depth not capped in code
- [ ] Depth >6 triggers a non-blocking UI warning, threshold configurable via `instance_settings.deep_tree_warning_threshold`
- [ ] `entity_kinds` catalog is per-instance: each instance owns its rows; instance admin can add/edit kinds without affecting other instances
- [ ] All 20 v1 templates ship as JSON files in `src/lib/templates/`; each has `Templates.{slug}.{name,description,...}` translation keys in both `sk.json` and `en.json`
- [ ] Custom kinds: instance admin UI lets the owner add a new `entity_kinds` row with translation keys, data_schema, allowed_parent_kinds — no code deploy needed
- [ ] [Accounting module](../specs/2026-05-12-accounting-module-hoa-finances.md) continues to function for HOA installs (jsonb-keyed share lookups); flagged as "HOA-only" in UI for non-HOA templates
- [ ] Migration is reversible until the cleanup phase (Phase 8); rollback path documented in spec notes
- [ ] `last_verified` date and `## Notes` updated at end of each phase

## Project Context

### Affected files (initial map — verify before implementation)

- `src/db/schema.ts:135-141` — `entityKindEnum` (to be dropped)
- `src/db/schema.ts:170+` — `housing_root_data`, `housing_unit_data` (to be folded into `entities.data`)
- `src/types/index.ts:24-35` — `Building`, `Entrance`, `Flat` aliases (to be removed)
- `src/lib/voting.ts` — weighted-share dispatcher (to be kind-aware)
- `src/lib/import/types.ts:12-15` — hardcoded `community_unit | community_entrance_unit | community_block_entrance_unit` (replaced by template-driven import_levels)
- `src/lib/import/seed.ts:151` — hardcoded `kind: "housing_community"` (replaced by template root_kind)
- `src/app/api/building/route.ts:48` — hardcoded `kind: "housing_community"` (replaced by template-aware bootstrap)
- `src/app/[locale]/(dashboard)/admin/import/page.tsx:32-38` — 3-radio structure picker (replaced by kind picker per level)
- `setup.sh:145+` — building-name prompt; add template picker after, write `INSTALL_TEMPLATE` to `.env`
- `src/scripts/create-admin.ts` — extend or add `bootstrap-community.ts` to read template and seed starter tree
- `messages/sk.json`, `messages/en.json` — new namespaces `Kinds.*`, `Templates.*`
- New: `src/lib/templates/{hoa,garden,garage,street,custom}.json`
- New: `src/lib/kinds/registry.ts` — kind catalog accessor + soft validator

### Cross-cutting risks

- **Voting math regression** — share-weighted HOA voting is legally regulated (Slovak Zákon o vlastníctve bytov, Czech `zákon č. 67/2013`). Migration tests must prove vote results are byte-identical before vs after schema change.
- **Reporting/queries** — many queries today join `housing_unit_data` directly. Every such query must be rewritten to read `entities.data->>'share_numerator'` etc. Audit `lib/db/queries/` and `src/app/api/` for `housing_unit_data` references.
- **i18n drift** — adding `Kinds.*` and `Templates.*` namespaces creates ~40 new keys per locale. Coordinate with [/audit-translations](../../../.claude/skills/audit-translations) and `/audit-terminology` once Phase 7 begins.
- **Czech compliance** — [Czech market analysis](../implemented/2026-04-13-czech-market-analysis.md) and [Czech voting rules](../implemented/2026-04-13-czech-voting-rules.md) are HOA-only. Garden/garage/street templates need separate legal review before going live in CZ.
- **Accounting** — current accounting spec ([BYT-20260512-002](../specs/2026-05-12-accounting-module-hoa-finances.md)) assumes HOA share keys exist. Either pin accounting to `hoa` template or generalize accounting in a follow-up spec.

### Migration phases (sequencing)

Phases 1–3 land together as one schema/migration PR (no behavioral change visible to users).
Phase 4–5 land as a feature PR (templates + setup.sh).
Phase 6–7 land per template (one PR per new community type: garden first, garage, street, custom).
Phase 8 lands after at least one production release of dual-table parity.

## Notes

### Decisions (2026-05-15)

- **Depth**: unbounded in schema/code. UI warns at depth > 6 (configurable per-instance via `instance_settings.deep_tree_warning_threshold`). Rationale: user wants maximum flexibility, but warns the admin if the tree gets unwieldy.
- **Catalog scope**: per-instance. Each customer instance owns its `entity_kinds` rows. Cloud platform does not share catalogs across tenants. Custom kinds added by an instance admin do not leak to other instances.
- **Template breadth**: ship 20 templates in v1 (see Phase 4 table). Architecture remains template-agnostic — adding template 21 is a JSON file + translation keys, no code change.

### Still open

- Custom kinds via UI — gate behind feature flag and ship after the 20 canonical templates are stable? Probably yes; mark as Phase 8+ deliverable. Decide before Phase 8 begins.
- Translation budget — 20 templates × (root_kind + 3-4 child kinds) ≈ 100 new `Kinds.*` keys, plus 20 × 5 fields ≈ 100 `Templates.*` keys, per locale. Coordinate with `/audit-translations` before Phase 7 to batch translation work.
- Per-template legal review — `hoa`, `urbar`, `hunting_association`, `fishing_cooperative`, `religious_community` may have statutory rules (quorum, who can vote, AGM frequency) in SK/CZ law. Mark each template with `legal_review_required: true|false` in the JSON, and link to the relevant statute in `notes_url` for each.

### Operational

- Tag for retro: this spec is cross-cutting and architecturally invasive. Run `/spec-retro` at the end of every phase, not just at completion, to catch drift early.
- When `last_verified` is older than 30 days during implementation, re-scan affected files since the entity model touches many surfaces.

### Progress log

**2026-05-15 — Phase 1a (additive schema)**
- `src/db/schema.ts`: added `entityKinds` table (`entity_kinds`) and `entities.data jsonb not null default '{}'::jsonb`. Legacy `entityKindEnum` left in place — Phase 1c converts `entities.kind` to text FK.
- `src/lib/kinds/registry.ts`: client-safe types + `CANONICAL_KIND_SLUGS` + `LEGACY_KIND_TO_SLUG` mapping + `HOA_CATALOG_SEED`.
- `src/lib/kinds/registry.server.ts`: `listKinds`, `getKind`, `seedCatalog`, `seedHoaCatalog` (idempotent inserts via `onConflictDoNothing`).
- Generated migration: `drizzle/0032_silent_silhouette.sql` — pure additive (CREATE TABLE entity_kinds + ALTER entities ADD COLUMN data).

**2026-05-15 — Phase 1b (catalog seed)**
- `drizzle/0033_seed_entity_kinds.sql` — manual SQL migration; idempotent INSERT of the 5 canonical HOA slugs (`community`, `building`, `entrance`, `unit`, `generic_group`) with `display_name_key`, `data_schema`, `allowed_parent_kinds`, `sort_order`.
- `drizzle/meta/0033_snapshot.json` — copied from 0032 (no schema delta in this migration).
- `drizzle/meta/_journal.json` — appended entry idx=33.
- Pending user action: run `pnpm db:migrate` to apply 0032 + 0033.

**2026-05-15 — Phase 1c (kind enum → text FK)**
- `src/db/schema.ts`: dropped `entityKindEnum` export; `entities.kind` is now `varchar(64) NOT NULL REFERENCES entity_kinds(slug) ON DELETE RESTRICT`.
- `src/lib/entity-tree.ts`: removed `entityKindEnum` import; `EntityKind` is now `string` (runtime validation against `entity_kinds` table at the route boundary, not compile-time union).
- `src/app/api/admin/entities/route.ts`: replaced static `VALID_KINDS` set with `await getKind(slug)` lookup against the per-instance catalog.
- `src/app/api/admin/entities/[id]/set-kind/route.ts`: same.
- `drizzle/0034_kind_to_text_fk.sql` — hand-written, data-preserving: `ALTER COLUMN kind TYPE varchar(64) USING (CASE …)` mapping the 5 legacy enum values to canonical slugs (`housing_community → community` etc.), `ADD CONSTRAINT entities_kind_entity_kinds_slug_fk`, `DROP TYPE entity_kind`.
- `drizzle/meta/0034_snapshot.json` — manually authored from 0033 with: `entities.kind` type flipped to `varchar(64)` + typeSchema removed; new FK entry `entities_kind_entity_kinds_slug_fk`; removed `public.entity_kind` enum.
- `drizzle/meta/_journal.json` — appended entry idx=34.
- Pending user action: run `pnpm db:migrate` to apply 0032 → 0033 → 0034.

**Phase 1 complete** — schema foundation ready.

**2026-05-15 — Phase 2a (backfill)**
- `drizzle/0035_backfill_entities_data.sql` — hand-written, idempotent merge of `housing_root_data` (address, ico, voting_method, country, governance_model, legal_notice, community_cross_entrance_visible) and `housing_unit_data` (flat_number, floor, share_numerator, share_denominator, area→`area_m2`) into `entities.data` via `e.data || jsonb_strip_nulls(jsonb_build_object(…))`.
- Verification queries embedded as comments. Run post-migrate to confirm parity.
- `drizzle/meta/0035_snapshot.json` — copied from 0034 (no schema delta).
- `drizzle/meta/_journal.json` — appended idx=35.
- Legacy `housing_root_data` + `housing_unit_data` tables remain authoritative for code. Phase 2b switches reads file-by-file, Phase 2c switches writes, Phase 8 drops the tables.

**2026-05-15 — Handoff opened to open-resiapp-cloud**
- `handoffs/outbox/2026-05-15-open-resiapp-to-open-resiapp-cloud-community-template-selection.md` (mirrored to cloud's `handoffs/inbox/`).
- Asks cloud to add template picker to signup/provisioning UI, store choice on the instance/subscription row, and inject `INSTALL_TEMPLATE` env var into the container at boot. Per-instance kind catalogs — no cross-tenant sharing.
- Spec frontmatter `related_handoffs` updated.
- Phase 5 (`setup.sh` rework) cannot ship in production-cloud customers until this handoff reaches `agreed` status.

**2026-05-15 — Phase 1c follow-up: stale kind strings**
- Phase 1c migrated `entities.kind` values (`housing_community → community`, `housing_block → building`, `housing_entrance → entrance`, `housing_unit → unit`) but 23 source files still hardcoded the legacy strings in WHERE clauses and INSERT payloads. Bulk-renamed via `sed` across `src/` + `modules/`, preserving `src/lib/kinds/registry.ts` where the legacy keys are intentional (`LEGACY_KIND_TO_SLUG` mapping).
- `src/lib/modules/bootstrap-bundled.ts` type union + `autoEnableKinds` config updated to new slugs (`community`, `building`).
- Verification: `grep -rn "'housing_(community|block|entrance|unit)'" src modules` → 0 hits (only JSDoc comments remain, informational).
- Without this fix every query like `eq(entities.kind, "housing_unit")` would return 0 rows after the migration runs.

**2026-05-15 — Phase 2b PR 1 (display-only reads via legacy-compat)**
- `src/lib/legacy-compat.ts` — `getCommunityRoot`, `listCommunityRoots`, `listUserFlats` retargeted to read from `entities.data` jsonb. SQL template literals cast string-typed jsonb values to typed targets: `(${entities.data}->>'share_numerator')::int`, `coalesce((${entities.data}->>'community_cross_entrance_visible')::boolean, false)`, etc.
- Explicit return types: `CommunityRootRow`, `UserFlatRow` exported so call sites get stable shapes during the migration window.
- `housingRootData` / `housingUnitData` imports removed from the helper file. Inner-joins to those tables eliminated — `entities.data` carries the same fields.
- 19 downstream files inherit the switchover automatically (anything calling `getCommunityRoot()` / `listCommunityRoots()` / `listUserFlats()` is now reading from jsonb without code change).
- Inline-query files that bypass the helpers (≈10 — `users/route.ts`, `external/v1/users/*`, `claim/[token]/route.ts`, `invitations/[token]/route.ts`, `community/directory/route.ts`, `lib/invitations.ts`, `mandates/index.ts`, `external/votings/id.ts`) — to be retargeted in PR 1b.

**2026-05-15 — Phase 2b PR 1b (inline display reads)**
- 10 files retargeted: dropped `innerJoin(housingUnitData…)` / `leftJoin(housingUnitData…)`, replaced column refs with `sql<…>\`${entities.data}->>'…'\`` expressions, removed `housingUnitData` / `housingRootData` imports.
  - `src/app/api/users/route.ts`
  - `src/app/api/external/v1/users/route.ts`
  - `src/app/api/external/v1/users/[id]/route.ts`
  - `src/app/api/external/v1/flats/route.ts`
  - `src/app/api/community/directory/route.ts`
  - `src/app/api/claim/[token]/route.ts`
  - `src/app/api/invitations/[token]/route.ts`
  - `src/lib/invitations.ts`
  - `modules/voting/src/routes/api/mandates/index.ts`
  - `modules/voting/src/routes/api/external/votings/id.ts`
- Numeric casts: `(${entities.data}->>'share_numerator')::int`, `(${entities.data}->>'area_m2')::numeric`, `coalesce((${entities.data}->>'floor')::int, 0)`.
- No write paths touched — Phase 2c will handle those.

**2026-05-15 — Phase 2b PR 2 (root mutations: dual-write)**
- Decision: write paths in 2b add a **dual-write** (legacy table + `entities.data`) rather than waiting for Phase 2c. Without dual-write, the period between 2b reads switching and 2c writes switching would leave reads serving stale data (writes lag, reads see backfill-time values). Dual-write closes that gap; legacy tables remain authoritative for rollback until Phase 8.
- `src/app/api/building/route.ts`:
  - Added `rootDataPatch()` helper that maps camelCase body fields to canonical jsonb keys (`votingMethod → voting_method`, `governanceModel → governance_model`, `legalNotice → legal_notice`, `address`/`ico`/`country` passthrough).
  - PATCH bootstrap path (no existing root): create entity, INSERT `housing_root_data` (legacy), then `UPDATE entities SET data = data || ${patch}::jsonb`.
  - PATCH update path: keep `UPDATE housing_root_data`, mirror the same fields into `entities.data` via `data || ${patch}::jsonb`.
- `src/app/api/internal/import-identity/route.ts`:
  - Transaction now inserts `entities` with `data: rootData` (jsonb keys = `address`, `ico`, `voting_method`, `country`) inline, in addition to the existing `housing_root_data` insert.
- `src/app/api/internal/export-identity/route.ts`:
  - Read switched to `${entities.data}->>'address'` / `'ico'` / `'country'` / `'voting_method'`. `housingRootData` import dropped from this file (no writes here).
- The dual-write pattern is route-local for now (`rootDataPatch()` lives in `building/route.ts`); if more root-mutation routes need it later, lift to `src/lib/db/entity-data.ts`.

**2026-05-15 — Phase 2b PR 3 (unit mutations + import: dual-write)**
- New helper module: `src/lib/db/entity-data.ts` — exports `rootDataPatch()` and `unitDataPatch()`. Moved out of route files to satisfy the route handler rule (`app/**/route.ts` may only export HTTP methods + Next.js config). `building/route.ts` updated to import from the new lib.
- `src/app/api/flats/route.ts`:
  - GET: list flats read switched to `${entities.data}->>'flat_number'` etc., dropped `housingUnitData` join. Order-by switched to a reused `flatNumberExpr` so the sort key matches the selected column.
  - POST: dual-write — INSERT `housing_unit_data` then `UPDATE entities SET data = data || ${unitDataPatch}::jsonb`.
- `src/app/api/flats/[id]/route.ts`:
  - PATCH: dual-write on the housingUnitData update path (legacy `UPDATE` plus `UPDATE entities SET data = data || …`). Return shape now reads from `entities.data`.
  - DELETE: untouched (operates on memberships + entity tree, not housing_unit_data).
- `src/lib/import/seed.ts`:
  - `findExistingCommunity()`: read switched to `entities.data->>'address'`; `housingRootData` join dropped from this query.
  - Community root creation: dual-write — `entities` insert now carries `data: { address, ico, voting_method, country }` inline, alongside the existing `housing_root_data` insert.
  - Unit creation: dual-write — `entities` insert carries `data: { flat_number, floor, share_numerator, share_denominator, area_m2 }` inline, alongside the existing `housing_unit_data` insert.
- `src/lib/import/export.ts`:
  - Both root and unit selects switched to jsonb reads. `housingRootData` + `housingUnitData` imports dropped.
- Verified pattern: every dual-write path inserts/updates the legacy `housing_*_data` row FIRST, then the jsonb mirror — so a partial failure leaves the legacy row authoritative (matching what reads expected pre-2b for any unsupported edge case).

**2026-05-15 — Phase 2b PR 4 (voting engine + share-sum invariants)**
- `src/app/api/admin/share-sum-invariants/route.ts`:
  - Dropped `housingUnitData` import + join. `flat_number` now selected from `${entities.data}->>'flat_number'`.
  - The math itself is unchanged — the rational sum uses `memberships.ownerUnitShareNumerator/Denominator` (integer columns on `memberships`, NOT on the unit jsonb). No BigInt casting hazard here despite the audit flag.
- `modules/voting/src/routes/api/votes/index.ts`:
  - **Vote rows query** (the one that feeds `calculateResults`): `housingUnitData` join replaced with `innerJoin(entities, ...)`. `flatNumber`, `shareNumerator`, `shareDenominator`, `area` read from `entities.data` via `sql<...>\`(${entities.data}->>'…')::int\`` / `->>'flat_number'`.
  - **`flatsForScope` query** (both branches: subtree-scoped and root-scoped): same swap — `entities` only, jsonb extracts for share/area. The path-LIKE filter is untouched.
  - **`currentUserFlats` query**: same swap.
  - **`loadFlatNumber()` helper**: select from `entities` (no join), `${entities.data}->>'flat_number'`.
  - **In-transaction flat lookup for `requireEmail`**: same swap.
  - Removed `housingUnitData` from imports.
- **Casting choice**: `::int` for `share_numerator`, `share_denominator`, `area_m2`. Matches the legacy `integer` columns on `housing_unit_data`. The migration 0035 backfill wrote the legacy values verbatim as JSON numbers, so `(${entities.data}->>'area_m2')::int` reproduces the original `housingUnitData.area` value byte-identically. **No change to `calculateResults()` arithmetic** — `totalPossibleWeight += f.shareNumerator / f.shareDenominator` still operates on JS numbers parsed from `int4`.
- **Regression test (operator-side, post-deploy)**: pick one existing voting, capture the response of `GET /api/votes?votingId=<id>` before the Phase 2 migrations apply and again after — diff `results.totalPossibleWeight` and per-choice totals. They must be identical. If they aren't, the bug is almost certainly in the casting (e.g. drizzle parsed `::int` as a string) — verify in `psql` first.

**Phase 2b complete.** All read paths now derive from `entities.data` jsonb. Dual-write keeps `housing_root_data` + `housing_unit_data` populated for rollback.

**Phase 2 — remaining**
- **Cleanup PR**: `src/types/index.ts` legacy aliases (`Building`, `Flat`, `Entrance`) — they reference jsonb-fed fields that are now `string | null` rather than the strict union from the dropped enum. Update aliases or remove if unused.
- **Phase 8 cleanup** (one production release later): drop the `housing_root_data` + `housing_unit_data` tables, remove dual-write from `building/route.ts`, `flats/route.ts`, `flats/[id]/route.ts`, `internal/import-identity`, `import/seed.ts`. Remove `housingRootData` / `housingUnitData` schema definitions + relations.

**2026-05-15 — Phase 3 (voting method dispatcher)**
- New module `src/lib/voting-method.ts`:
  - Canonical methods: `weighted_by_share`, `one_per_unit`, `per_area`, `one_per_member`, `custom_weight`.
  - Legacy aliases retained (`per_share` ≡ `weighted_by_share`, `per_flat` ≡ `one_per_unit`) so existing `housing_root_data` rows and audit logs keep validating.
  - `normalizeVotingMethod(raw)` — maps any stored value to canonical; unknown → `weighted_by_share` (matches pre-2026-05 default).
  - `isUnitScoped(method)` — discriminator between the per-unit and per-member branches.
  - `computeUnitWeight({shareNumerator, shareDenominator, area}, method)` — single source of truth for the per-unit math formerly inlined in two places.
  - `computeMemberWeight({membershipWeight}, method)` — scaffolded for `one_per_member` (1) and `custom_weight` (`memberships.weight`); the routes that drive these don't exist yet.
- `src/types/index.ts`: `VotingMethod` widened to include all 7 values (5 canonical + 2 legacy aliases). Existing UI code (`VotingSettingsTab`) that switches on `per_share`/`per_flat`/`per_area` keeps type-checking — the new values are a superset.
- `modules/voting/src/engine/index.ts`:
  - `calculateResults` normalizes `method` to canonical before dispatch.
  - Member-scoped methods (`one_per_member`, `custom_weight`) throw "Phase 3b not implemented" — explicit placeholder rather than silent wrong math.
  - `getUnitWeight()` delegates to `computeUnitWeight()`; same numbers as before for HOA (`weighted_by_share` ≡ `per_share`).
  - Default method parameter changed from `"per_share"` to `"weighted_by_share"` (semantically identical via the normalizer).
- `modules/voting/src/routes/api/votes/index.ts`:
  - `votingMethod` resolved via `normalizeVotingMethod(root?.votingMethod)`; downstream code sees canonical only.
  - `totalPossibleWeight` loop replaced with a single `computeUnitWeight()` call per unit.
  - Member-scoped voting returns `501 Not Implemented` with a clear message — Phase 3b ships the member-scoped engine path.
- **Regression test plan**: same as PR 4 — capture a `GET /api/votes?votingId=<id>` response pre-Phase 3, apply, diff. The dispatcher uses the same arithmetic as before (`f.shareNumerator / f.shareDenominator`, `f.area ?? 1`, `1`) so numbers must be byte-identical for HOA installs.
- **NOT touched in Phase 3**: UI in `VotingSettingsTab.tsx` (still offers the 3 legacy radios), `import-identity` zod schema (still constrains to 3 legacy values), `building/route.ts` PATCH (still writes `per_share` default). These belong to Phase 4 (template-driven defaults) and beyond.

**Phase 3b — next**
- Implement member-scoped resolution in `engine/index.ts` (no unit grouping; each membership = 1 row). Add `MemberResolution` type, member-level breakdown.
- Add `currentUserMembershipsForScope` query in `votes/index.ts` for member-scoped quorum.
- Co-owner semantics for member-scoped: an active membership counts as one vote regardless of unit share — different from `weighted_by_share` where co-owners' shares sum to 1.
- Update `calculateResults` to dispatch into the member-scoped path when `!isUnitScoped(method)`.

**2026-05-15 — Phase 4 (template system)**
- `src/lib/templates/types.ts` — `Template` interface (slug, display/description keys, category, root_kind, default_voting_method, default_roles, starter_tree, import_levels, legal_review_required, notes_url) + `TemplateSummary` for the picker payload.
- `src/lib/templates/loader.ts` (server-only) — process-local cache, `listTemplates()`, `listTemplateSummaries()`, `getTemplate(slug)`. Filename ↔ slug consistency check throws at load time.
- **20 template JSONs** in `src/lib/templates/`: `hoa`, `garden`, `garage`, `street`, `cottage`, `urbar`, `apiary`, `marina`, `mobile_home_park`, `storage_units`, `office_building`, `coworking`, `industrial_park`, `cemetery`, `sports_club`, `hunting_association`, `fishing_cooperative`, `parents_association`, `religious_community`, `custom`. Each declares root_kind=`community`, default voting method (mix of `weighted_by_share`, `one_per_unit`, `one_per_member` matching the spec table), default_roles, starter_tree, import_levels. `hoa`, `urbar`, `hunting_association`, `fishing_cooperative`, `religious_community` carry `legal_review_required: true` + `notes_url` linking the relevant Slovak statute.
- `src/app/api/templates/route.ts` — `GET /api/templates` returns summaries; `GET /api/templates?slug=<x>` returns the full template JSON. Public read (template metadata isn't sensitive — same list ships in OSS for every cloud tenant).
- Translations: new `Templates` namespace in `messages/sk.json` + `messages/en.json` with `Categories.{residential,land,commercial,civic,custom}` plus per-template `name` / `description` / `sampleCommunityName` keys for all 20 templates. JSON validity verified post-edit.
- **NOT in Phase 4** (deferred to Phase 5):
  - `entity_kinds` catalog rows for non-HOA kinds — the loader doesn't seed the catalog; that happens during install bootstrap in Phase 5 (`setup.sh` + first-boot script).
  - The bootstrap-community.ts entrypoint that reads `INSTALL_TEMPLATE` env and runs `seedCatalog()` + creates the starter_tree.

**Phase 5 — next**
- `setup.sh` rework: append template picker (English-only paged list — 20 options grouped by category), write `INSTALL_TEMPLATE` to `.env`.
- New first-boot script (`bootstrap-community.ts` or extension of `create-admin.ts`): on cold start, if no community exists, read `INSTALL_TEMPLATE`, load the template via `getTemplate(slug)`, seed `entity_kinds` rows for every kind the template uses, then walk `starter_tree` and insert the entities with their `data` jsonb populated.
- Extend `entityKinds` seed data so each template's `import_levels` kinds (garden_section, plot, garage_block, etc.) have full metadata (display_name_key, icon, allows_members, votable, allowed_parent_kinds, data_schema). Today only the 5 HOA kinds are fully spec'd in `HOA_CATALOG_SEED`.

**Phase 4 → Phase 5 dependency**: Phase 4 ships standalone (UI can list templates, API can serve them), but a fresh install with `INSTALL_TEMPLATE=garden` still can't produce a working garden community until Phase 5 lands the bootstrap script + per-kind catalog seeds.

**2026-05-15 — Phase 5 (setup.sh + bootstrap + kind catalog)**
- `setup.sh`:
  - Renamed the "Building name" prompt to "Community name" (the kind is no longer always residential).
  - New paged "Pick the community template" prompt — English-only, 20 options grouped by 4 categories (Residential & housing, Land & nature, Commercial & shared, Social & civic) + custom. Default = `hoa`.
  - Validates the slug against an in-script `VALID_TEMPLATES` array; unknown → error + exit.
  - Writes `INSTALL_TEMPLATE=<slug>` to `.env`.
  - After `create-admin.ts`, runs `bootstrap-community.ts --template "$INSTALL_TEMPLATE" --name "$APP_NAME" --locale "$LANGUAGE"`.
  - Closing banner shows `Template:` alongside `Community:`, `Language:`, `URL:`.
- `src/lib/kinds/registry.ts`:
  - New export `CANONICAL_KIND_CATALOG`: 38 entries spanning every entity kind used by any v1 template. Each row carries `slug`, `displayNameKey: "Kinds.<slug>"`, `icon` (lucide), `allowsMembers`, `votable`, `allowedParentKinds`, `dataSchema` (minimal `{}` for most kinds; HOA-style share/area schema on `unit`, `parcel`, `office_suite`, `tenant_lot`), `sortOrder`.
  - `HOA_CATALOG_SEED` retained as a backwards-compat alias for legacy paths.
- `src/scripts/bootstrap-community.ts` (new, ~200 lines):
  - Reads `--template` (or `INSTALL_TEMPLATE`), `--locale` (or `LANGUAGE`), optional `--name` override.
  - Loads the template JSON from `src/lib/templates/<slug>.json`; loads `messages/<locale>.json` for `name_key` resolution.
  - Computes the set of required kinds (`root_kind` + `import_levels` + every `kind` in `starter_tree`) and seeds them from `CANONICAL_KIND_CATALOG` via `INSERT … ON CONFLICT DO NOTHING`. Idempotent.
  - Checks for an existing root entity; if any unarchived root exists, skips starter-tree creation (re-running is a no-op).
  - Walks `starter_tree` depth-first; inserts entities with translated `name` (resolved per chosen locale, or the operator's `--name` for the root); sets `data.voting_method = template.default_voting_method` on the root so the Phase 3 dispatcher reads the right value.
- Translations:
  - New `Kinds` namespace in `messages/{sk,en}.json` (39 entries each — covers all 38 catalog kinds + `generic_group`). Parity verified.
  - SK uses domain-appropriate terms (Komunita, Byt, Vchod, Parcela, Mólo, Kotvisko, Hrobové miesto, …).

**Acceptance walk-through:**
1. Operator runs `setup.sh`, picks template `garden`.
2. `.env` gets `INSTALL_TEMPLATE=garden`.
3. After Docker stack comes up, `create-admin.ts` makes the admin user.
4. `bootstrap-community.ts` seeds `entity_kinds` rows: `community`, `garden_section`, `plot`, `generic_group`.
5. The starter_tree gets inserted: a community root named "Záhradkárska osada" (sk) with a child "Sektor A" (sk). `voting_method = one_per_member` is written into `entities.data` on the root.
6. Admin logs in; voting engine reads `voting_method` and dispatches via the canonical normalizer. Member-scoped methods still return 501 until Phase 3b — for `garden` this is a known gap.

**Phase 5 known gaps:**
- Member-scoped voting (`one_per_member`, `custom_weight`) still 501 — templates whose `default_voting_method` is `one_per_member` (garden, apiary, coworking, sports_club, hunting_association, fishing_cooperative, parents_association, religious_community, custom) bootstrap successfully but cannot run a vote yet. Phase 3b unblocks them.
- The bootstrap script only handles the root community. Future templates with deeper starter trees (currently only `garden` has one) work via the recursive insert.
- No UI for changing the template post-install (matches the handoff to open-resiapp-cloud).

**2026-05-15 — Phase 3b (member-scoped voting engine)**
- New types in `src/types/index.ts`:
  - `MemberResolution` — per-voter result row (`userId`, `userName`, `choice`, `weight`).
  - `VoteWithOwnership.membershipWeight?: number` — optional field consumed only by `custom_weight`.
  - `VotingResults.memberBreakdowns?: MemberResolution[]` — mutually exclusive with `unitBreakdowns`.
- `modules/voting/src/engine/index.ts`:
  - `calculateResults` now branches on `isUnitScoped(canonical)` — member-scoped delegates to a new `calculateMemberScopedResults()`.
  - Member-scoped path:
    - **Last-write-wins dedupe** by `userId` (paper + electronic replays don't double-count).
    - Per-vote weight via `computeMemberWeight()` — `1` for `one_per_member`, `membershipWeight` for `custom_weight`.
    - No §14 ods. 4 co-owner resolution — each membership stands alone.
    - Same CZ `silenceIsNo` rule (non-voters count as `proti` when applicable).
    - Same 4 quorum types reused.
  - Removed the Phase 3 placeholder throw — `one_per_member` and `custom_weight` are now first-class.
- `modules/voting/src/routes/api/votes/index.ts`:
  - GET: dropped the 501 short-circuit. `totalPossibleWeight` now dispatches: unit-scoped sums `computeUnitWeight()` over `flatsForScope`; member-scoped queries `memberships` joined to in-scope entities and sums `computeMemberWeight()`. Path-overlap filter reused for the membership scope so cross-community memberships don't bleed in.
  - GET: `voteRows` query now selects `memberships.weight` and propagates it into `VoteWithOwnership.membershipWeight` (falls back to `1` when the membership row is missing — same defensive default as `ownerUnitShareNumerator`).
  - POST: `voteMethod` + `memberScoped` resolved at the top of the handler.
  - POST: existing-vote dedup key is `(votingId, ownerId)` in member-scoped mode, `(votingId, entityId)` otherwise. Skips the "another owner already voted for this unit" 400 in member-scoped mode (multi-owner units can each cast a vote there).
- **Walk-through**: a `garden` install (template `default_voting_method = one_per_member`) can now bootstrap → admin assigns memberships → run a vote → tally returns `{ memberBreakdowns: [...], totalPossibleWeight: <activeMembershipCount> }`. The same engine path serves coworking, sports_club, hunting_association, fishing_cooperative, parents_association, religious_community, and `custom`.
- **Regression**: HOA installs (`weighted_by_share`) take the unit-scoped branch and produce numerically identical results to Phase 2b — `calculateResults` now just routes around an extra `if`.

**2026-05-15 — Phase 6 (import wizard — template picker)**
- `src/scripts/bootstrap-community.ts`: root entity now carries `data.template_slug` alongside `data.voting_method`. Downstream tooling identifies the install template without inferring from voting method.
- `src/lib/legacy-compat.ts`: `CommunityRootRow` extended with `templateSlug: string | null`. `getCommunityRoot()` + `listCommunityRoots()` select `${entities.data}->>'template_slug'`. `/api/building` surfaces it for the wizard.
- `src/app/[locale]/(dashboard)/admin/import/page.tsx`:
  - New top-of-wizard "Community template" section with a category-grouped dropdown (`<optgroup>` per Residential / Land / Commercial / Civic / Custom). Legal-review-required templates get a ⚖ glyph next to the name.
  - Loads `/api/templates` on mount; loads `/api/templates?slug=<x>` on template change.
  - On template change, derives `StructureVariant` from `import_levels.length` (2→`community_unit`, 3→`community_entrance_unit`, 4→`community_block_entrance_unit`) and pre-fills `community.voting_method` with `default_voting_method` if the operator hasn't overridden it.
  - Defaults the template to the install's bootstrapped slug (`data.template_slug` from `/api/building`) — falls back to `"hoa"` for installs predating Phase 5.
  - Non-HOA template warning banner: when the chosen template's `import_levels` use non-HOA kinds (anything other than `community → building? → entrance? → unit`), surfaces an amber banner stating the seeder still writes HOA kinds (Phase 6b will generalize).
- `previewImportAction` + `commitImportAction` accept `templateSlug` (default `"hoa"`) and plumb it through to `seedImport`.
- `seedImport()` accepts an optional `templateSlug` in `SeedInput` — currently ignored, but the API contract stabilizes so Phase 6b just adds the branching without breaking callers.
- Translations: 4 new `Import.*` keys (`templateTitle`, `templateSubtitle`, `templateNonHoaTitle`, `templateNonHoaBody`) in both `sk.json` and `en.json`. The picker reuses the existing `Templates.Categories.*` namespace from Phase 4 — no new category keys.

**2026-05-15 — Phase 6b (kind-aware seed)**
- `src/lib/import/seed.ts`:
  - New `resolveKindChain(templateSlug)` resolves a template's `import_levels` into a `{ root, block, entrance, leaf }` tuple. 4-level templates fill all four slots; 3-level set `block = null`; 2-level set `block = entrance = null`. HOA fallback (`community → building → entrance → unit`) kicks in when the template is missing or absent.
  - `seedImport()` calls `resolveKindChain(input.templateSlug)` once and uses the resolved slugs everywhere — root insert, block insert (skipped if `kinds.block === null`), entrance insert (skipped if `kinds.entrance === null`), and leaf insert. Audit-log `afterJson` records the actual kind slug so a garden import shows `{kind: "plot"}` instead of `{kind: "unit"}`.
  - `existingByKindAndKey` map keys still use the stable HOA-flavoured prefixes (`block|`, `entrance|`, `unit|`) so idempotent reattach reuses entities by their template-specific kinds.
  - Root community now writes `data.template_slug` (mirroring `bootstrap-community.ts`) so the wizard correctly auto-detects which template a CSV-imported community belongs to.
  - Legacy `housing_root_data` + `housing_unit_data` dual-write are now gated on `kinds.leaf === "unit"` — non-HOA installs skip the legacy tables entirely (no orphan rows). HOA installs preserve the dual-write rollback path until Phase 8.
- Wizard amber banner softened: instead of "feature not yet implemented", it now coaches operators that the CSV still requires share columns (use 1/1 for shareless templates). Translations updated in both locales.
- `src/lib/import/columns.ts` and `src/lib/import/validate.ts` left unchanged — column schema + share invariants stay HOA-shaped. Non-HOA imports require operators to put `1/1` placeholders in the share columns. Generalizing those is Phase 6c.

**Phase 6c — deferred**
- `src/lib/import/columns.ts`: derive per-row columns from `entity_kinds.data_schema` of the leaf kind.
- `src/lib/import/validate.ts`: relax share-sum + flat-number invariants when the template's leaf kind doesn't declare share fields.
- Drop the amber banner entirely once columns + validation no longer demand share fields.

**Phase 7 — next after 6b**
- Audit hardcoded "Bytový dom" / "Vchod" / "Byt" labels and switch to `Kinds.<slug>` translation keys driven by the root entity's kind / template.

**Phase 7 — i18n + UI polish**
- Audit every place that hardcodes "Bytový dom" / "Vchod" / "Byt" labels and switch to `Kinds.<slug>` translation keys.
- Header / sidebar / breadcrumbs read the root entity's kind to pick vocabulary (HOA shows "Byt", garden shows "Záhradka", etc.).

**Phase 8 — cleanup**
- Drop `housing_root_data`, `housing_unit_data` tables after one production release of dual-write parity. Remove the dual-write code from 5 routes. Drop schema definitions + relations.
- Decide: gate custom-kinds-via-UI behind a feature flag, or ship as part of Phase 8.

**Files still importing `housingRootData` / `housingUnitData` after PR 4** (`grep -l`, all intentional dual-write or types):
- `building/route.ts` — dual-write
- `flats/route.ts` — dual-write
- `flats/[id]/route.ts` — dual-write
- `import-identity` — dual-write
- `import/seed.ts` — dual-write
- `types/index.ts` — cleanup queue
