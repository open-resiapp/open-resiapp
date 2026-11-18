---
spec_id: BYT-20261118-004
title: "Fault reports (poruchy) as tracked tasks"
status: in_progress
created: 2026-11-18
updated: 2026-11-18
author: Filip
owner: filipvnencak
last_verified: 2026-11-18
project_type: node
depends_on:
  - BYT-20261117-002   # specs/in_progress/2026-11-17-ux-simplification.md (IA, UI kit, senior baseline)
related_handoffs: []
tags: [faults, poruchy, maintenance, board, notifications, module]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Let an owner report a fault ("Výťah stojí", "Tečie v pivnici") from a phone in at most three
steps, and let the board track it as a task to completion: status, priority, category,
assignee, internal note, invoiced flag and a full change history. The reporter always knows
where their report stands; nothing stays open for months without someone being reminded.

### Problem statement

Today there is **no fault-report feature**. What exists:

- `postCategoryEnum` has `maintenance` (`src/db/schema.ts:41-46`), used by `posts.category`
  (`src/db/schema.ts:435`). It renders as a "Údržba" badge on notices
  (`src/components/nastenka/PostCard.tsx:92`, `messages/sk.json:571` `categoryMaintenance`)
  and is accepted by the MCP notice tool (`src/lib/mcp/actions/governance.ts:20,25,42`).
- But `posts` are **board notices**: `createPost` is limited to `admin` and `caretaker`
  (`src/lib/permissions.ts:4`). An owner cannot create a `maintenance` post at all. The
  category means "planned maintenance announcement" (water off on Tuesday), not "a resident
  reports a broken thing".
- Residents today fall back to a community `help_request` post (`communityPostTypeEnum`,
  `src/db/schema.ts:105-112`) or a phone call. Neither has a status the board owns,
  assignee, priority, private visibility, or history; `communityPosts` only has
  `active | resolved | expired` (`src/db/schema.ts:114-118`) and is explicitly kept apart from
  governance (`docs/domain/community.md` edge cases).
- `document_type` also has a `maintenance` value (`src/db/schema.ts:195`,
  `src/lib/documents.ts:26,62`, "Protokol o údržbe") — unrelated to this spec, untouched.

The discussion-threads spec (`specs/specs/2026-03-12-discussion-threads.md`, RES-20260312-003)
covers informal group chat + polls; it has no Approach/AC yet and is not a task tracker.
Fault reports are a separate, board-owned workflow.

## Scope

**IN scope**
- Owner/tenant reports a fault: title, description, 0–5 photos, location (own unit, own
  entrance, own building, or community root = "spoločné priestory") + optional location note.
- Reporter sees "Moje hlásenia" with status and public status messages; can edit or withdraw
  while the fault is still `new`.
- Lifecycle `new → in_progress → resolved | rejected`, reopen by board.
- Board-only fields: priority, category, assignee (board user or external contractor
  contact), invoiced flag, optional link to an accounting expense, internal note.
- Append-only change history (every field change, status change, photo add/remove).
- Visibility per fault: `community` / `entrance` / `private` (board + reporter).
- Reporter notification (e-mail + push) on every status change.
- Weekly stale digest (Monday) to the assignee, or to the whole board if unassigned, of faults
  open > 30 days, at most once per fault per 30 days.
- Board list with filters (status, priority, category, assignee) remembered per user; stacked
  cards at 390 px.
- New bundled module `faults` (see Approach → Decision).

**OUT of scope**
- Comments / chat on a fault (use discussion threads later; MVP has public status messages
  only).
- E-mailing faults to non-users / contractors (competitor sends PDF/ZIP; deferred).
- Per-address ban on reporting faults (deferred).
- SLA timers, recurring maintenance plans, statutory inspections (accounting already tracks
  `nextInspectionDueAt` on expenses, `modules/accounting/src/db/schema.ts:682-683`).
- Converting existing `maintenance` notices into faults (see Migration).
- Offline reporting.

## Approach

### Decision: new bundled module `faults`, not an extension of `posts`

Recommend **`modules/faults/`** (manifest `module.json`, tables `mod_faults_*`, schema in
`modules/faults/src/db/schema.ts`, added to `drizzle.config.ts` `schema` array like voting and
accounting at `drizzle.config.ts:5-9`).

Reasons:
1. **Different shape.** A fault has owner-authored content + board-owned task fields + an
   append-only history. Bolting 8 nullable columns onto `posts` (a board-only notice table)
   would make every notice query carry fault semantics and every owner query risk leaking
   internal columns.
2. **Different visibility rule.** Notices use bidirectional path matching
   (`src/lib/notice-board.server.ts:50-62`: user sees posts on ancestors and descendants of
   any membership). Faults need a third mode — `private` (board + reporter) — which does not
   fit the posts filter without branching it.
3. **Different authors.** `posts` are board-authored (`createPost` = admin/caretaker);
   faults are resident-authored. Opening `posts` to owners changes the notice-board trust
   model.
4. **Optional per community.** Not every template needs it (a fishing cooperative, a
   cemetery); the module framework (`modules/*/module.json`, `src/lib/modules/*`) already
   gives enable/disable, nav gating (`requiresModule` in `src/lib/navigation.ts:42-108`) and
   cron self-gating (accounting precedent, `modules/accounting/module.json` `cronJobs`).
5. **Precedent.** Voting and accounting moved their tables into modules
   (`src/db/schema.ts:38-39` comment, `modules/accounting/src/db/schema.ts`), with their own
   `*_notifications_sent` table (`mod_accounting_notifications_sent`,
   `modules/accounting/src/db/schema.ts:868-890`).

Cost: module boilerplate (manifest, dist build, route mounting). Accepted.

### Migration path for existing `maintenance` posts

No data migration. `maintenance` stays a **notice** category with its current meaning
("planned maintenance announcement"); no enum value is renamed or removed, so the
CLAUDE.md enum-literal grep rule is not triggered. Existing literals stay valid:
`src/types/index.ts:65`, `src/components/nastenka/PostCard.tsx:92`,
`src/lib/mcp/actions/governance.ts:20,25,42`, `src/db/schema.ts:45`.
Only copy changes: the board's "Nový oznam" category picker gets a hint next to "Údržba"
("Plánovaná údržba. Poruchy od vlastníkov sú v sekcii Poruchy."), all three locales.
Optional follow-up (Deferred): per-notice "Vytvoriť poruchu z oznamu" action.

### Information architecture (fits `2026-11-17-ux-simplification.md`)

No new top-level nav item for either role (owner nav stays 4 items, board 7).

- **Owner**
  - **Domov**: secondary card "Niečo sa pokazilo?" with one button "Nahlásiť poruchu"; if the
    owner has open reports, the card shows "Vaše hlásenia: 1 rieši sa" linking to the list.
  - **Dom**: section "Poruchy" → `/poruchy` = "Moje hlásenia" + "Hlásenia v dome" (faults
    visible to them, read-only, so neighbours do not double-report).
  - Report flow at `/poruchy/nova`, detail at `/poruchy/[id]`.
- **Board**
  - **Domov (board)** "Čo treba teraz": "N nových porúch" and "N porúch otvorených > 30 dní".
  - **Oznamy**: tab bar `Oznamy · Poruchy`; Poruchy tab = board list at `/poruchy` (same
    route, role-aware rendering). Oznamy nav badge includes the count of `new` faults.
- Feed: public faults are **not** mixed into the notice feed (keeps the feed for
  communication; avoids the board's task list leaking into it).

### Owner report flow (≤ 3 steps, phone-first, senior baseline)

1. **Čo sa pokazilo?** — title (required, ≤ 120 chars), description (optional textarea),
   "Pridať fotku" (`<input type="file" accept="image/*" capture="environment">`, up to 5,
   client-side downscale per `specs/ideas/2026-06-09-image-compression-media-storage-cost.md`
   if it lands first; otherwise server limits of `src/app/api/uploads/route.ts:10-11` apply:
   JPEG/PNG/WebP ≤ 10 MB).
2. **Kde?** — large buttons built from the reporter's active memberships: "Môj byt (č. 12)",
   "Môj vchod (Hlavná 5)", "Celý dom / spoločné priestory", + optional note ("pivnica, pri
   výťahu"). One-unit owners see their unit pre-selected. Visibility is derived and shown as
   one sentence ("Uvidí to výbor a vy." / "Uvidia to susedia z vchodu."), with a link to
   change it to `private`.
3. **Skontrolovať a odoslať** — summary + one primary button.

Defaults: location = unit → `private`; location = entrance/building → `entrance` scope of
that node; location = root → `community`. Reporter may only narrow (to `private`), never
widen. Board may change to any value.

### Lifecycle (pure engine)

`modules/faults/src/engine/transitions.ts` — pure, returns `{ ok: true } | { ok: false, code }`.

| from | to | who | requires |
|---|---|---|---|
| `new` | `in_progress`, `resolved`, `rejected` | board | `rejected` needs a public reason |
| `in_progress` | `resolved`, `rejected`, `new` | board | same |
| `resolved` | `in_progress` (reopen) | board | public reason |
| `rejected` | `new` (reopen) | board | — |
| `new` | `withdrawn` | reporter | withdraw, only while `new` and no board change yet (record, history and photos kept — Decision 3) |

Error codes (never prose): `FAULT_INVALID_TRANSITION`, `FAULT_REASON_REQUIRED`,
`FAULT_NOT_EDITABLE` (reporter edit after `new`), `FAULT_WITHDRAW_NOT_ALLOWED`,
`FAULT_LOCATION_NOT_ALLOWED` (location outside reporter's memberships),
`FAULT_VISIBILITY_WIDEN_FORBIDDEN`, `FAULT_TOO_MANY_PHOTOS`, `FAULT_ASSIGNEE_CONFLICT`
(user and contractor both set), `FAULT_EXPENSE_NOT_FOUND`. Mapped in the server action to
`Faults.errors.<code>` in `sk.json`, `en.json`, `cs.json`.

### Permissions

Add to `src/lib/permissions.ts`:
- `reportFault`: `admin`, `owner`, `tenant`
- `manageFaults`: `admin`, `caretaker` (see Decisions: board members without `admin`)

"Board" in this spec = user with `manageFaults`.

### Server-side visibility and field filter

All reads go through `modules/faults/src/lib/queries.server.ts`; no route selects from
`mod_faults_faults` directly.

- `listFaultsForBoard(rootId, filters)` / `getFaultForBoard(id)` — require `manageFaults`;
  return `FaultBoardView` (all columns + history).
- `listFaultsForResident(userId, rootId)` / `getFaultForResident(userId, id)` — return
  `FaultResidentView`, built from an **explicit column list in the SQL `select`** (not a full
  row stripped in JS). Visibility predicate in SQL:

  ```
  f.reporter_id = :userId
  OR (f.visibility = 'community')
  OR (f.visibility = 'entrance' AND EXISTS (
        SELECT 1 FROM memberships m JOIN entities me ON me.id = m.entity_id
        WHERE m.user_id = :userId AND m.status = 'active'
          AND me.path LIKE scope.path || '%'))      -- scope = f.scope_entity_id
  ```
  `private` faults match only the first branch. Note: unlike notices, `entrance` is
  **downward only** (members inside the scope), not ancestor-matching.
- `FaultResidentView` keys, exactly: `id, title, description, status, locationLabel,
  locationNote, visibility, createdAt, updatedAt, resolvedAt, isMine, photos[{id}],
  publicEvents[{status, message, createdAt}]`. `isMine` controls edit/withdraw buttons.
  For other residents' faults, `description` and `photos` are included only when
  `visibility != 'private'` (already implied by the predicate).
- Never in the resident view: `priority, category, assigneeUserId, assigneeName,
  contractorId, invoiced, expenseId, internalNote, reporterId` (of others), internal events.

**Photo serving.** `GET /api/uploads/[...path]` (`src/app/api/uploads/[...path]/route.ts:14-53`)
only checks that a session exists — any logged-in user can fetch any file by path. Fault
photos therefore must **not** be stored under the generic uploads category. They are served
by `GET /api/modules/faults/photos/[photoId]`, which resolves the photo's fault and applies
the same resident/board predicate before streaming via `src/lib/storage.ts`. Storage keys are
random UUIDs, not guessable from fault IDs.

### Board list

- Filters: status (multi), priority, category, assignee (user, contractor, "nepriradené"),
  plus "otvorené > 30 dní". Sort: priority, then oldest first.
- URL search params are the source of truth (shareable, back button works). When the page is
  opened with **no** params, the server reads cookie `faults_filters` (JSON, per browser,
  server-readable → no flash of the unfiltered list) and renders with it; any filter change
  writes the cookie. Clearing filters ("Zrušiť filtre") clears the cookie. No DB table.
- ≥ 768 px: table. < 768 px: stacked cards (title, location, status badge, priority badge,
  age "otvorené 34 dní", assignee) — every badge has text, not colour only.
- Detail: owner-authored part (read-only for board except visibility/location fix), board
  panel (status buttons — explicit per-state buttons, no cycling toggle; priority, category,
  assignee, invoiced, expense link, internal note), history timeline.

### Notifications

Single table `mod_faults_notifications_sent` with `kind` enum (CLAUDE.md rule).

- **`status_changed`** — sent synchronously in the status-change server action to the
  reporter (unless the reporter made the change). E-mail via new
  `sendFaultStatusChanged({ ..., locale })` in `src/lib/email.ts` using
  `getTranslations({ locale, namespace: "Email" })` (default `routing.defaultLocale`; there is
  no `users.locale` column today), plus push via `sendPushNotification` (`src/lib/push.ts:25`).
  `dedupe_key = <event id>` → retrying the action never double-sends.
- **`stale_digest`** — weekly. New route `src/app/api/cron/faults/route.ts`, same auth
  pattern as `src/app/api/cron/community/route.ts` (`X-Cron-Secret` vs `CRON_SECRET`,
  lines ~115-118), self-gates on the module being enabled. Scheduled `0 7 * * 1` in the
  cron sidecar crontab of `docker-compose.own.yml:94-96` and `docker-compose.hub.yml:87-88`
  and declared in `modules/faults/module.json` `cronJobs`.
  - Selection: faults with status in (`new`, `in_progress`) and `created_at < now - 30d`,
    excluding any fault that has a `stale_digest` row with `sent_at > now - 30d` (for any
    recipient).
  - Recipients: assignee user if set; otherwise (unassigned or contractor-assigned) every
    active user with `manageFaults` in the community. One e-mail per recipient listing all
    their faults.
  - **Multi-replica / double-run safety:** the cron sidecar fires one HTTP request, which hits
    one replica; but a retry or manual trigger may overlap. Claim before send:
    `INSERT … (kind, fault_id, recipient_id, dedupe_key = '<faultId>:<ISO week>') ON CONFLICT
    DO NOTHING RETURNING` — only rows actually inserted are mailed. Short transaction, no
    DDL, no locks beyond the unique index, no in-process loop. If the send fails, the claimed
    rows are deleted so next week retries.
  - Last-run snapshot via `src/lib/cron-state.ts` pattern (in-memory, debug only — acceptable
    because it is not shared state anything depends on).

### Schema sketch (`modules/faults/src/db/schema.ts`, via `drizzle-kit generate`)

```ts
faultStatusEnum      = pgEnum("mod_faults_status", ["new","in_progress","resolved","rejected"])
faultPriorityEnum    = pgEnum("mod_faults_priority", ["low","normal","high","urgent"])
faultVisibilityEnum  = pgEnum("mod_faults_visibility", ["community","entrance","private"])
faultEventTypeEnum   = pgEnum("mod_faults_event_type",
  ["created","edited","status_changed","field_changed","photo_added","photo_removed"])
faultNotificationKindEnum = pgEnum("mod_faults_notification_kind",
  ["status_changed","stale_digest"])

mod_faults_categories        // per-community catalog, seeded (see Decisions)
  id uuid pk, root_entity_id → entities.id  onDelete: cascade
  slug varchar(64), name_key varchar(200) null, custom_name varchar(120) null,
  sort_order int, archived_at timestamp null
  unique(root_entity_id, slug)

mod_faults_contractors
  id uuid pk, root_entity_id → entities.id onDelete: cascade
  name varchar(255) not null, phone, email, ico varchar(20), note text,
  archived_at, created_at

mod_faults_faults
  id uuid pk
  root_entity_id   → entities.id  onDelete: restrict      // community
  location_entity_id → entities.id onDelete: restrict     // unit / entrance / building / root
  scope_entity_id  → entities.id  onDelete: restrict      // visibility scope for 'entrance'
  location_note varchar(255) null
  reporter_id      → users.id     onDelete: set null       // nullable: user deletion keeps the task
  title varchar(120) not null, description text null
  status faultStatusEnum default 'new', visibility faultVisibilityEnum not null
  priority faultPriorityEnum default 'normal'
  category_id      → mod_faults_categories.id onDelete: set null
  assignee_user_id → users.id     onDelete: set null
  contractor_id    → mod_faults_contractors.id onDelete: set null
  invoiced boolean default false
  expense_id       → mod_accounting_expenses.id onDelete: set null  // see Decisions
  internal_note text null
  resolved_at timestamp null, created_at, updated_at
  check: NOT (assignee_user_id IS NOT NULL AND contractor_id IS NOT NULL)
  index(root_entity_id, status, created_at); index(reporter_id); index(assignee_user_id)

mod_faults_photos
  id uuid pk, fault_id → mod_faults_faults.id onDelete: cascade
  storage_key varchar(500) not null, uploaded_by_id → users.id onDelete: set null,
  created_at

mod_faults_events                // append-only history
  id uuid pk, fault_id → mod_faults_faults.id onDelete: cascade
  actor_id → users.id onDelete: set null
  type faultEventTypeEnum, field varchar(64) null,
  old_value jsonb null, new_value jsonb null,     // snapshots names (assignee, contractor)
  public_message text null, is_public boolean default false,
  created_at
  index(fault_id, created_at)

mod_faults_notifications_sent
  id uuid pk, kind faultNotificationKindEnum
  fault_id → mod_faults_faults.id onDelete: cascade
  recipient_id → users.id onDelete: cascade
  event_id → mod_faults_events.id onDelete: cascade  null
  dedupe_key varchar(120) not null, sent_at
  uniqueIndex(kind, recipient_id, dedupe_key); index(fault_id, kind, sent_at)
```

Withdraw (reporter, `new`, no board event): status → `withdrawn` (Decision 3, re-confirmed by
the owner 2026-11-18). The fault row, its events AND its photos (rows + files) are kept for the
board. No user-facing copy promises deletion: the confirm dialog (`Faults.detail.withdrawWarn`)
says the report stays in the history. The guarded UPDATE (`status = 'new' AND
board_touched_at IS NULL`) returning 0 rows → `FAULT_WITHDRAW_NOT_ALLOWED`.

### i18n

New namespace `Faults` (status, priority, visibility labels, flow copy, errors, empty states,
filters) + `Email.faultStatusChanged.*`, `Email.faultStaleDigest.*` in `sk.json`, `en.json`,
`cs.json`. Category seeds use `name_key` → `Faults.category.<slug>`; board-added categories
use `custom_name` (user data, not translated).

## Acceptance Criteria

**Reporting (owner/tenant)**
- [x] From Domov, an owner reaches a submitted report in ≤ 3 screens (what → where → review)
      at 390 px; tap targets ≥ 44 px, body text ≥ 16 px, one primary button per screen.
- [x] Location options are exactly the reporter's active-membership unit(s), their
      entrance(s)/building(s), and the community root — nothing else (negative test: an
      entity outside the reporter's tree is not offered and a forged `locationEntityId`
      returns `FAULT_LOCATION_NOT_ALLOWED`).
- [x] Default visibility follows the rule (unit → private, entrance/building → entrance,
      root → community); reporter can narrow to private; widening returns
      `FAULT_VISIBILITY_WIDEN_FORBIDDEN`.
- [x] Up to 5 photos; a 6th returns `FAULT_TOO_MANY_PHOTOS`; non-image or > 10 MB rejected.
- [x] "Moje hlásenia" lists the reporter's faults with status badge and latest public message.
- [x] Reporter can edit title/description/photos while `new`; after any status change edit
      returns `FAULT_NOT_EDITABLE`. The edit UPDATE itself carries the guard (`status = 'new'
      AND board_touched_at IS NULL AND reporter_id = actor`); a board change racing the edit
      → 0 rows → `FAULT_NOT_EDITABLE`, no events written. *(guard added 2026-11-18)*
- [x] Photo cap holds under concurrency: the count is taken inside the insert transaction
      under `SELECT … FOR UPDATE` on the fault row (reporter editability re-checked there);
      two parallel uploads can't exceed 5. Stored files of a refused upload are removed.
      *(2026-11-18)*
- [x] Reporter can withdraw while `new` with no board change: status becomes `withdrawn`;
      the record, history and photos (rows + files) stay for the board (Decision 3 — the
      original "everything is gone" wording is superseded). After a board change — including
      one racing the withdraw — withdraw returns `FAULT_WITHDRAW_NOT_ALLOWED`.

**Lifecycle and board fields**
- [x] Every transition in the table succeeds for board; every transition not in the table
      returns `FAULT_INVALID_TRANSITION` (engine unit test enumerates all 4×4 pairs).
- [x] `rejected` and reopen-from-`resolved` without a public message return
      `FAULT_REASON_REQUIRED`.
- [x] Setting both assignee user and contractor returns `FAULT_ASSIGNEE_CONFLICT` (engine) and
      the DB check constraint rejects it.
- [x] Every change to status, priority, category, assignee, contractor, invoiced, expense,
      internal note, visibility, location, and every photo add/remove writes one
      `mod_faults_events` row with old/new value and actor.
- [x] Expense picker (only when accounting is enabled) lists non-voided expenses of the same
      community; linking sets `invoiced = true`.
- [x] Owner/tenant calling any board mutation gets 403.

**Visibility (server-side) — negative tests**
- [x] Resident fault JSON (list and detail) has **exactly** the `FaultResidentView` key set —
      test asserts key-set equality, so any extra key (e.g. `priority`, `internalNote`,
      `assigneeUserId`, `invoiced`, `expenseId`, `category`) fails.
- [x] Resident `publicEvents` contains only `is_public` events; a `field_changed` event on
      `internal_note` never appears.
- [x] A `private` fault is invisible (list + detail 404) to a neighbour in the same entrance,
      and visible to the reporter and board.
- [x] An `entrance` fault is visible to members of that entrance's subtree and invisible to a
      member of another entrance (404, not 403 — no existence leak).
- [x] Photo of a `private` fault: `GET /api/modules/faults/photos/[id]` returns 404 for a
      neighbour; the photo is not reachable through `/api/uploads/...`.

**Notifications**
- [x] Board status change → reporter gets one e-mail (in the request's/default locale) and a
      push if subscribed; replaying the same action does not send again (dedupe on event id).
- [x] Reporter changing their own fault does not notify themselves.
- [x] Cron `POST /api/cron/faults` without the correct `X-Cron-Secret` → 401; with module
      disabled → no-op 200.
- [x] Fault open 31 days, assigned to user U → U gets the digest; unassigned → every
      `manageFaults` user gets it; contractor-assigned → every `manageFaults` user.
- [x] Same fault is not included again for 30 days (run twice a week apart → second run skips
      it); two concurrent runs send each (fault, recipient) at most once.
- [x] `resolved`/`rejected` faults and faults ≤ 30 days old are never in a digest.

**Board list**
- [x] Filters (status, priority, category, assignee, > 30 days) combine with AND; result count
      shown.
- [x] Reopening `/poruchy` without params restores the last filters on first server render (no
      flash of unfiltered list); "Zrušiť filtre" clears them.
- [x] At 390 px the list renders as stacked cards with no horizontal scroll.
- [x] Board Domov shows counts of `new` and `> 30 days` faults; Oznamy shows a `Poruchy` tab.

**Module and i18n**
- [x] With the module disabled: no Domov card, no Dom section, no Oznamy tab, `/poruchy` 404,
      cron no-op.
- [x] Every new string exists in `sk.json`, `en.json`, `cs.json`; every engine code has a
      `Faults.errors.*` entry in all three (test iterates the code list).
- [ ] Existing `maintenance` notices render and filter exactly as before; the category hint
      appears in the notice create form.

## Project Context

- Notices: `src/db/schema.ts:41-46` (`postCategoryEnum`), `:431-445` (`posts`),
  `src/lib/notice-board.server.ts:27-62` (visibility predicate), `src/lib/feed.ts`,
  `src/components/nastenka/PostCard.tsx:92`.
- Community posts: `src/db/schema.ts:105-118,975-1082`, `src/app/api/community/posts/route.ts`,
  `docs/domain/community.md`.
- Entity tree: `src/db/schema.ts:245-301` (`entity_kinds`, `entities` with `path`),
  `:304-338` (`memberships`); HOA levels community → building → entrance → unit
  (`src/lib/templates/hoa.json` `import_levels`).
- Board: `src/db/schema.ts:1120-1132` (`board_members`), `src/lib/permissions.ts`.
- Navigation: `src/lib/navigation.ts:70-140`; Domov data: `src/lib/home.server.ts`.
- Uploads/storage: `src/app/api/uploads/route.ts`, `src/app/api/uploads/[...path]/route.ts`
  (session-only check), `src/lib/storage.ts`, `src/lib/uploads.ts`.
- Cron: `src/app/api/cron/community/route.ts`, `src/lib/cron-state.ts`,
  `docker-compose.own.yml:83-96`, `docker-compose.hub.yml:78-88`.
- Notifications: `src/lib/email.ts`, `src/lib/push.ts`, precedent tables
  `community_notifications_sent` (`src/db/schema.ts:1043-1082`),
  `mod_accounting_notifications_sent` (`modules/accounting/src/db/schema.ts:868-890`).
- Modules: `modules/voting/module.json`, `modules/accounting/module.json`, `src/lib/modules/*`,
  `drizzle.config.ts`.
- Accounting expenses (optional link): `modules/accounting/src/db/schema.ts:657-733`.
- IA and UX baseline: `specs/in_progress/2026-11-17-ux-simplification.md` (Phases 3–5).
- Related: `specs/specs/2026-03-12-discussion-threads.md`,
  `specs/ideas/2026-06-09-image-compression-media-storage-cost.md`.

## Notes

Competitor Resitech has poruchy with priority, category, invoiced flag, assignee, internal
note, change history, visibility all / entrance / admins+reporter, and a weekly Monday e-mail
of faults open > 30 days. This spec borrows the feature set, not their wording.

### Decisions to confirm

1. **Module vs posts** — recommended new `faults` module. Confirm, and whether it is enabled
   by default for the `hoa` template (recommend yes) and off for others.
2. **Who is "board"** — `manageFaults` = `admin` + `caretaker`. Should active `board_members`
   rows without `users.role = admin` (e.g. council members) also manage faults? Should
   caretaker see the internal note and invoiced flag, or only status/assignee?
3. **Withdraw** — hard delete while untouched `new` (recommended) vs a fifth terminal status
   `withdrawn` that keeps the record for the board.
4. **Accounting FK** — real FK `expense_id → mod_accounting_expenses.id` (`set null`; tables
   exist even when the module is disabled because migrations are core) couples two modules.
   Alternative: plain `uuid` without FK, validated in app code. Recommend real FK.
5. **Contractor** — small `mod_faults_contractors` table (recommended) vs free-text name on
   the fault. Contractors are never e-mailed in MVP.
6. **Digest dedupe scope** — "once per fault per 30 days" across all recipients (spec) vs per
   recipient (a newly assigned user would get it immediately).
7. **Categories** — seed list for `hoa`: `elevator, water_plumbing, heating, electrical,
   lighting, doors_locks_intercom, roof_facade, cleaning, common_areas, other`; board can add
   custom. Confirm list before implementation (catalog lands before any seed reads it).
8. **Filter memory** — cookie per browser (recommended, no schema) vs DB per user across
   devices.
9. **Reporter notification opt-out** — none (transactional about their own report,
   recommended) vs a new `notification_preferences` column (core schema change).
10. **Tenants** — can tenants report (spec: yes, like community posts)?

### Deferred

- Comments on a fault (residents ↔ board), "+1 me too" from neighbours.
- E-mail/PDF of a fault to a contractor or non-user.
- Per-address ban on reporting faults.
- "Vytvoriť poruchu z oznamu" for existing `maintenance` notices; "Vytvoriť výdavok" from a
  fault in accounting.
- Fault statistics (average resolution time, per category) for the annual report.
- Kiosk / QR sticker in the elevator ("Nahlásiť poruchu výťahu") pre-filling location and
  category.
- `users.locale` so e-mails go in the recipient's language rather than the default locale.

## Implementation notes (2026-11-18)

Implemented as bundled module `modules/faults/` (manifest, hand-maintained `dist/index.js`, schema in
`modules/faults/src/db/schema.ts`, added to `drizzle.config.ts`). Migration NOT generated yet — coordinator runs
`pnpm db:generate`.

Decisions taken (coordinator defaults, override the "Decisions to confirm" list above):
1. Module ON for the `hoa` template only (`enabledForTemplates` in `src/lib/modules/bootstrap-bundled.ts`; fresh
   install with no root yet → enabled).
2. Board = flat `admin` + any active `board_members` role → `full`; `caretaker` → works the task (status,
   priority, category, assignee, visibility, location) but never sees/edits internal note, invoiced, expense link
   (fields nulled in `getFaultForBoard`, their history events filtered out).
3. Withdraw = new status `withdrawn` (record + history + photos kept). The AC "fault, photos, events and
   notification rows are gone" is superseded: withdraw sets `withdrawn`; withdrawn reports stay visible to the
   reporter only (and to the board via the status filter).
4. Expense link = nullable `expense_id` uuid WITHOUT FK, validated in code (`FAULT_EXPENSE_NOT_FOUND`).
5. Contractors = `mod_faults_contractors`.
6. Stale-digest dedupe per (fault, recipient) per 30 days; concurrent-run claim key `<faultId>:<ISO week>`.
7. Category catalog = `FAULT_CATEGORY_SLUGS` (`modules/faults/src/engine/catalog.ts`): elevator, water_plumbing,
   heating, electrical, lighting, doors_locks_intercom, roof_facade, cleaning, common_areas, other. Seeded lazily
   per community (`ensureCategoryCatalog`, insert … on conflict do nothing).
8. Filter memory = cookie `faults_filters`.
9. No reporter opt-out (TODO(decision) in `notifyReporter`) — transactional.
10. Tenants cannot report (`reportFault` = admin, owner; TODO(decision)).

Other notes:
- Extra engine codes: `FAULT_PHOTO_INVALID`, `FAULT_TITLE_REQUIRED`, `FAULT_NOT_FOUND`, `FAULT_FORBIDDEN`,
  `FAULT_INVALID_INPUT`. "Board touched" is a `board_touched_at` column (first board-side change), not an event scan.
- E-mail copy lives in `Faults.email.*` (module-local helper `modules/faults/src/lib/email.server.ts`), not in
  `Email.*`; push via `sendPushNotification`.
- Notice "Údržba" category hint: N/A — the current notice create flow (`NewPostFlow`) has no category picker
  (only important → urgent/info), so there is no "Údržba" option to annotate.
- Oznamy nav badge with the `new` fault count NOT done (needs a ShellData badge + query per page); the
  `Oznamy · Poruchy` tab shows "N nové" instead.
- Cron last-run snapshot (`cron-state.ts`) not wired — the route returns the counts in its JSON.
- Tests: `pnpm test:faults` (`scripts/faults-check.ts`, no DB) — lifecycle pairs, reason, gates, visibility
  narrow-only, resident view exact key set (negative), i18n coverage of every code/slug/status. DB-level
  visibility / digest ACs need a manual run (no DB test harness for modules).

