---
spec_id: RES-20260505-001
title: "Extract voting into a free bundled module"
status: in_progress
created: 2026-05-05
updated: 2026-05-05
author: open-housing
owner: open-housing
last_verified: 2026-05-05
project_type: other
depends_on: [RES-20260428-002, RES-20260501-002]
related_handoffs: []
tags: [voting, modules, refactor, extraction, sdk]
feature_branch: feature/voting-module-extraction
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal
Extract voting (votings, votes, mandates, `voting-rules.ts`, `voting.ts`,
`/dashboard/voting/*` routes, SK/CZ legal engine, mandate signing, vote
confirmation emails) from core into a **free bundled module** under
`modules/voting/`. Core stays governance-agnostic (members, posts,
documents, notifications); voting becomes optional and opt-in. The
module ships pre-installed and enabled for housing kinds; non-housing
communities (street, playground, garden, garage) can enable it
explicitly. The premium passkey voting module (RES-20260428-003)
extends this base module rather than the core.

## Scope
**In scope:**
- New module package at `modules/voting/` following the layout defined in
  RES-20260428-002 (manifest, `dist/`, `src/`, `migrations/`, `messages/`).
- Move all voting domain code out of core: `src/lib/voting.ts`,
  `src/lib/voting-rules.ts`, `src/app/[locale]/(dashboard)/voting/*`,
  `src/app/api/votings/*`, `src/app/api/votes/route.ts`,
  `src/app/api/external/v1/votings/*`, the `sendVoteConfirmation` email
  builder, and the vote-related notification kinds.
- Migrate the core `votings`, `votes`, `mandates` tables and their four
  enums (`votingStatus`, `votingMethod`, `votingType`, `votingInitiatedBy`,
  plus `quorumType`, `voteChoice`, `voteType`) to module-prefixed tables
  under `mod_voting_*` with the existing data preserved.
- Module-owned translation namespace `Voting` in `messages/sk.json` and
  `messages/en.json` is extracted to `modules/voting/messages/{sk,en}.json`
  and registered into `next-intl` via the SDK on app start.
- SDK additions required to support voting (tree/membership reads, entity
  kind-data reads, email/notifications, HTTP route registration, i18n
  namespace registration). Tracked as a delta to RES-20260428-002, not
  re-specified here — see Notes.
- Default-install behaviour: for any community whose root entity has
  `kind in ('housing_community', 'housing_block')` the voting module is
  enabled automatically on first app start. Non-housing kinds keep it
  disabled until an admin enables it from `/settings/modules`.
- Auto-enable + uninstall guard: while any `mod_voting_votings` row exists
  the module cannot be uninstalled, only disabled. Uninstall is gated
  behind a separate "purge voting data" operator action on the admin API.
- Cross-module event surface: the module emits `voting.created`,
  `voting.opened`, `voting.closed`, `vote.cast`, `vote.disputed` via
  `sdk.events.emit` so the premium passkey module (RES-20260428-003) and
  any future module (e.g. analytics, notifications) can subscribe.

**Out of scope:**
- Re-specifying the SDK shape — that lives in RES-20260428-002. Any new
  capability voting needs is added there as a follow-up amendment, not
  here.
- Sandboxing the module (Phase 2 of the module system).
- Reworking SK/CZ legal voting rules — the rule engine moves verbatim.
- Replacing the existing UI/UX of the voting screens — the move is
  technical, the screens stay visually identical (only their import
  paths change).
- A premium passkey integration — that ships as RES-20260428-003 and
  consumes this module's events.
- Marketplace listing, paid module flow, or per-tenant licensing — voting
  is bundled and free.
- Removing the voting feature for users — it must remain reachable for
  every existing housing community after the migration with zero clicks.

## Approach

### Layout and packaging
The module ships in-tree at `modules/voting/`, bundled with the core
repo so self-hosted operators get it for free without a separate install:

```
modules/voting/
  module.json              # manifest, declares permissions + slots + hooks
  package.json
  dist/index.js            # built entry
  src/
    index.ts               # defineModule({ ... }) — registers hooks, UI, routes
    rules/                 # voting-rules.ts moves here (pure functions)
    engine/                # voting.ts (weighted tally, quorum check) moves here
    routes/
      dashboard/           # /dashboard/voting/* server components
      api/                 # /api/votings/*, /api/votes, external API
    ui/
      VotingDashboard.tsx
      VoteForm.tsx
      Sidebar.tsx
    email/
      VoteConfirmation.tsx # email template
    db/
      schema.ts            # Drizzle schema, mod_voting_* tables only
      queries.ts
  migrations/              # module-owned migrations, isolated tracker
  messages/
    sk.json
    en.json
```

The module is the only writer to its own tables. It reads core data
(`entities`, `memberships`, `housing_unit_data`, `users`) exclusively
through `sdk.db.read` and the higher-level `sdk.tree` / `sdk.entities`
helpers (defined in the SDK delta — see Notes).

### Manifest

```json
{
  "name": "voting",
  "version": "1.0.0",
  "description": "Slovak/Czech HOA-compliant voting (free, bundled).",
  "author": "open-housing",
  "entry": "dist/index.js",
  "permissions": ["db:read", "db:write", "ui:inject", "events:emit",
                  "events:subscribe", "i18n:register", "routes:register",
                  "email:send", "notifications:send"],
  "uiSlots": ["sidebar.items", "dashboard.widgets"],
  "routes": ["/dashboard/voting", "/api/votings", "/api/votes",
             "/api/external/v1/votings"],
  "minCoreVersion": "0.6.0",
  "checksum": "sha256:..."
}
```

`email:send`, `notifications:send`, `events:subscribe`, `routes:register`,
and `i18n:register` are new permission names introduced by this spec and
folded into the SDK delta on RES-20260428-002.

### Database migration

1. Module migration `0001_init` creates `mod_voting_votings`,
   `mod_voting_votes`, `mod_voting_mandates`, the seven enums,
   indexes, and the per-(post, recipient) `mod_voting_notifications_sent`
   table for vote confirmation tracking.
2. A one-shot core migration `XXXX_extract_voting` copies every row from
   core `votings/votes/mandates` into the module tables. IDs are
   preserved.
3. The same core migration:
   - rewrites the FK columns on the new tables from
     `entrance_id`/`flat_id` (legacy) to `entity_id` (post entity-refactor),
   - removes core-side rows and finally drops the legacy tables and enums.
4. Module migration `0001_init` runs first on a fresh install (no core
   data to copy). On an existing tenant the core extract migration
   produces the module tables already populated, then the module's
   migration tracker is initialized to the latest state to skip
   re-creation.
5. Rollback: re-create core tables from a backup table created by the
   extract migration; drop the `mod_voting_*` schema. The extract
   migration must keep a `legacy_*` table for two deploys before final
   drop.

### Code move and import contract

Every `voting/voting-rules` import in core (currently a handful of
server actions, the dashboard, board summary widgets) is rewritten to:

- live inside the module (most call sites move with the routes), or
- consume the module via `sdk.events.on('voting.closed', …)` and a
  read-only fact about voting status exposed by the module (e.g. count of
  open votings) via a registered SDK selector — never a direct import.

The lint rule from RES-20260428-002 (`no relative imports from outside
the module directory, no `@/*` imports`) is the primary enforcement.
A CI check fails the build on any remaining `from "@/lib/voting"` or
`from "@/db/schema"` voting reference outside `modules/voting/`.

### Entity-aware constituency

Once RES-20260501-002 lands, `mod_voting_votings.entity_id` is the
voting's scope. The module computes the constituency by calling
`sdk.tree.getDescendantMemberships(entityId)`, filtering for the
`housing_unit` kind when the voting is weighted, and reading
`housing_unit_data` for `share_numerator`/`share_denominator` via
`sdk.entities.getKindData(entityId, 'housing_unit_data')`. For
non-housing kinds the constituency is the membership set as-is and
weight defaults to 1 — the existing engine already handles uniform
weights.

### Routes

The module registers its routes through a new `sdk.routes.register`
call (SDK delta). Core's Next.js app router exposes a single passthrough
route `/dashboard/voting/[[...path]]` and `/api/votings/[[...path]]`
that delegates to the module's registered handler. This avoids forking
Next.js routing per module while keeping route ownership in the module.

Auth + middleware behaviour (NextAuth session, per-locale routing) is
preserved by the passthrough — the module receives an already-resolved
session and locale via `ModuleContext`.

### Email and notifications

`sendVoteConfirmation` moves to `modules/voting/src/email/`. It is
called via `sdk.email.send({ template, locale, data, to })`. Strings
come from the module's own `messages/{locale}.json` under the `Voting`
namespace, registered via `sdk.i18n.register('voting', messages)` on
`onAppStart`. The `*_notifications_sent` throttling table moves to
`mod_voting_notifications_sent` per the project rule on
per-(post, recipient) email tracking.

### Default install for housing kinds

`onInstall(ctx)` checks `ctx.community.rootEntity.kind`. If it matches
`housing_community` or `housing_block`, the module marks itself enabled
in `core_module_grants` automatically with the full declared permission
set — no admin click required. For other kinds the install only
registers the manifest; the module stays disabled until an admin opts
in from `/settings/modules` and approves the permission diff.

### Uninstall and data retention

Voting records satisfy a legal retention requirement (SK HOA law, §14a
zák. 182/1993 Z.z.). The module overrides the default uninstall flow:

1. If `mod_voting_votings` has any row, uninstall is rejected with a
   clear error pointing to the operator-only purge endpoint.
2. The operator can call `POST /api/admin/modules/voting/purge` (gated
   by the `full` API key, audit-logged) to archive all module tables
   into a timestamped CSV bundle written to the configured documents
   bucket, then drop them. Only after purge does uninstall succeed.
3. "Disable" is always available — the routes stop responding, the UI
   slots stop rendering, but the data stays. Re-enable restores the
   feature with no data loss.

### Cross-module events

On every state transition the module emits a typed event via
`sdk.events.emit`:

```ts
sdk.events.emit('voting.created', { votingId, entityId, createdById });
sdk.events.emit('voting.opened',  { votingId });
sdk.events.emit('voting.closed',  { votingId, result });
sdk.events.emit('vote.cast',      { voteId, votingId, ownerId, choice });
sdk.events.emit('vote.disputed',  { voteId, reason });
```

The premium passkey module subscribes to `vote.cast` (or, more
precisely, to a pre-cast variant — tracked in RES-20260428-003) to
attach a hardware-bound proof. Future modules (analytics, board summary,
audit export) subscribe without modifying this spec.

### Migration order across specs

This spec assumes the following order, enforced by `depends_on`:

1. **RES-20260428-002** (module system) reaches `implemented` —
   `modules/` directory loader, SDK package, manifest validation,
   permission grants, UI slot rendering, hook timeout/crash isolation
   are all in place.
2. **RES-20260501-002** (entity architecture) reaches `implemented` —
   `entities`, `memberships`, `housing_unit_data` exist; legacy
   `building`/`entrance`/`flat` are gone or shimmed; `votings.entity_id`
   already exists in core.
3. SDK delta (Notes) merged into RES-20260428-002 with
   `sdk.tree.*`, `sdk.entities.getKindData`, `sdk.email.send`,
   `sdk.notifications.send`, `sdk.routes.register`,
   `sdk.i18n.register`.
4. This spec implements: code move, prefix-table migration, default
   install, event emission, route passthrough.

If 1 or 2 is not done, this spec stays in `spec` status — do not start
implementation.

## Acceptance Criteria
- [ ] `modules/voting/` exists with the layout above; `module.json` is
      valid against the published JSON schema; `pnpm build` produces a
      working `dist/index.js`.
- [ ] All core voting source files (`src/lib/voting.ts`,
      `src/lib/voting-rules.ts`, `src/app/[locale]/(dashboard)/voting/*`,
      `src/app/api/votings/*`, `src/app/api/votes/route.ts`,
      `src/app/api/external/v1/votings/*`, `sendVoteConfirmation`) are
      removed from core; CI fails on any remaining `from "@/lib/voting"`
      or voting-table import outside `modules/voting/`.
- [ ] Core `votings`, `votes`, `mandates` tables and their seven enums
      no longer exist in core schema; equivalent tables exist as
      `mod_voting_*` and contain every row from the legacy tables, IDs
      preserved.
- [ ] An existing seeded HOA in dev — with at least one open and one
      closed voting plus mandates and disputed votes — migrates with
      identical visible results before and after: same totals, same
      quorum verdict, same per-flat vote rows, same mandate chain.
- [ ] `messages/sk.json` and `messages/en.json` no longer contain the
      `Voting` namespace; the module's own messages files do, and
      strings render correctly on `/dashboard/voting/*` after migration.
- [ ] On a fresh-install housing tenant, `onInstall(ctx)` enables the
      module automatically; the voting sidebar item and dashboard widget
      appear without any admin action.
- [ ] On a fresh-install non-housing tenant (e.g. `playground_group`),
      the module is registered but disabled; `/dashboard/voting` returns
      a 404 until the admin enables it from `/settings/modules`.
- [ ] The five domain events (`voting.created`, `voting.opened`,
      `voting.closed`, `vote.cast`, `vote.disputed`) fire with the
      payload shapes documented above; an internal subscriber added in
      tests receives each one.
- [ ] All SDK calls made by the module pass through the permission gate;
      removing any one declared permission causes the corresponding code
      path to throw `PermissionDeniedError` and degrade safely (no
      whole-app crash).
- [ ] Uninstall is rejected while `mod_voting_votings` is non-empty;
      the operator purge endpoint archives data to CSV and only then
      allows uninstall; "Disable" succeeds at any time without touching
      data.
- [ ] Vote confirmation email is sent via `sdk.email.send` using the
      module's i18n namespace and is delivered with correct SK / EN
      copy depending on the recipient's locale.
- [ ] External API endpoints (`/api/external/v1/votings/*`) work
      identically to today after the move, including API-key auth and
      rate limits.
- [ ] SK and CZ voting rule engines (`voting-rules.ts`) produce
      identical outputs after the move for a frozen test corpus
      (snapshot tests carried over from core unchanged).
- [ ] The premium passkey spec (RES-20260428-003) compiles against this
      module's published event payloads without modification — verified
      by a contract test that subscribes to `vote.cast` and asserts the
      payload type.
- [ ] Documented rollback: a single migration that re-creates core
      tables from the `legacy_*` snapshots and removes the module
      tables, executed and verified on a copy of staging data.

## Project Context
- Spec prefix: RES.
- Existing voting schema lives in `src/db/schema.ts` and is referenced
  by `src/lib/voting.ts`, `src/lib/voting-rules.ts`,
  `src/app/[locale]/(dashboard)/voting/*`,
  `src/app/api/votings/*`, `src/app/api/votes/route.ts`, and
  `src/app/api/external/v1/votings/*`. Email helper:
  `src/lib/email.ts::sendVoteConfirmation`.
- Affected i18n namespaces: `Voting` and any voting-specific keys under
  `Email`, `Dashboard`, and `Sidebar`.
- Implemented prerequisite specs that informed this design:
  - RES-20260312-001 (per-entrance scope) — the module preserves the
    `entityId` scope semantics post-entity-refactor.
  - BYT-20260413-003 (Czech rules) — the rule engine moves verbatim;
    no behavioural changes.
- Direct dependents: RES-20260428-003 (passkey, premium) consumes the
  events emitted here.
- The cloud platform (`open-resiapp-cloud`) treats the voting module as
  always-bundled for housing tenants and gates the passkey extension
  via the per-tenant licensing layer that lives in that project.

## Notes
- 2026-05-05: This spec depends on an SDK delta against
  RES-20260428-002. The delta adds: `sdk.tree.getAncestors(entityId)`,
  `sdk.tree.getDescendantMemberships(entityId)`,
  `sdk.entities.getKindData(entityId, kindDataTable)`,
  `sdk.email.send({ template, locale, data, to })`,
  `sdk.notifications.send(kind, recipientId, payload)`,
  `sdk.routes.register({ method, path, handler })`,
  `sdk.i18n.register(namespace, messagesByLocale)`, plus the new
  permission names (`events:emit`, `events:subscribe`, `i18n:register`,
  `routes:register`, `email:send`, `notifications:send`). Land that
  amendment on the module-system spec **before** starting work here.
- 2026-05-05: Default-enable on housing kinds is the chosen
  zero-friction path — existing users see no change. The alternative
  ("admin must enable voting after upgrade") was rejected because it
  would silently break running votings on first deploy.
- 2026-05-05: Uninstall blocking on existing voting rows is intentional;
  the legal retention requirement outranks ergonomics. Operator purge
  exists as the explicit, audit-logged escape hatch.
- Open: should the route passthrough live at the Next.js app router
  level (`/dashboard/voting/[[...path]]`) or be re-implemented as a
  custom server middleware that mounts module handlers? Lean toward
  passthrough — fewer moving parts, keeps Next.js conventions intact.
  Decide during implementation.
- Open: how to ship the module's UI assets in the same Next.js bundle
  without dynamic imports breaking RSC. Likely a `next.config.ts`
  glob include for `modules/*/dist/**`. Confirm with a spike before
  coding the route passthrough.
- Open: do we re-test the entire SK/CZ legal rule corpus after the
  move, or trust the snapshot tests carried over verbatim? Lean
  re-test once on a real seeded community (not just snapshots) before
  flipping the migration in production.

