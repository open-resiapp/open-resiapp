---
spec_id: BYT-20261118-003
title: "Na riešenie: owner to-do queue and owner-registry data checks"
status: in_progress
created: 2026-11-18
updated: 2026-11-18
author: Filip
owner: filipvnencak
last_verified: 2026-11-18
project_type: node
depends_on:
  - BYT-20261117-002   # UX simplification: Vlastníci page, BoardHome "Čo treba teraz", nav badges
  - BYT-20260511-001   # per-share resolution (owner_unit_share_* invariant)
  - BYT-20260508-003   # easy-import (shell users, LV paste parser)
  - BYT-20260512-001   # shell claim / invitation by target_shell_user_id
related_handoffs: []
tags:
  - owners
  - data-quality
  - onboarding
  - board
  - gdpr
  - schema-change
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Give the chairman one place on **Vlastníci** that says what needs his attention about
people and ownership — "Na riešenie" — with one obvious action per item, and a set of
informative consistency checks of the owner registry (shares, co-owners, BSM pairs,
duplicate LV ordinals) that never block anything. Counts surface as badges on chairman
**Domov** and the **Vlastníci** nav entry, computed once per request on the server.

### Problem statement

After the LV import (`src/lib/import/parsers/lv-paste.ts`) most owners are shell records
without e-mail; some get invited and never finish; some self-register and wait for approval;
some active accounts never sign in. Today the chairman sees these only as status chips on a
long table (`src/components/owners/OwnersBoard.tsx`) plus the registrations inbox
(`src/components/owners/OwnersInbox.tsx`). There is no "why" per person and no list that
empties as work gets done.

Ownership data drifts after import (manual edits in `OwnerEditForm`, merges, deletions).
Only one check exists — share sum per unit — shown as a global banner and on owner detail.
A unit with no owner at all, a BSM spouse missing after a merge, or two owners carrying the
same LV ordinal stays invisible until a vote result looks wrong (shares feed the voting
weight per §14 ods. 4 zák. 182/1993 Z.z., see `docs/domain/voting.md`).

Competitor Resitech ships a "Na riešenie" queue on owners and filterable non-blocking data
checks (shares ≠ 1, missing co-owner, BSM partner missing / different shares, duplicate
poradové číslo) plus last login on the owner profile. We borrow the idea, not the wording.

## Scope

**IN scope:**
- "Na riešenie" section on `/owners` (chairman / `manageUsers`) listing queue items per person:
  missing e-mail, pending self-registration, invitation not finished (open or expired),
  active account that never signed in / long inactive. Each item: reason sentence + one
  contextual primary action. "Označiť ako vyriešené" with undo. Items auto-clear when the
  condition disappears.
- Ownership data checks (pure functions → codes), filterable, informative, non-blocking:
  share sum per unit ≠ 1/1, unit without owner, BSM pair incomplete, BSM spouses with
  different shares, duplicate LV ordinal.
- Persisting the two LV facts the checks need (BSM marker, poradové číslo) on import.
- `users.last_login_at` written on sign-in; shown on owner detail to `manageUsers` only.
- Badge counts on chairman Domov (`BoardHome` todo row) and Vlastníci nav, server-side,
  request-cached, no polling.
- i18n in `sk`, `en`, `cs`.

**OUT of scope:**
- Auto-fixing data (merging, re-splitting shares). Checks only link to the existing editor.
- Sending new kinds of e-mail (reminders to owners). The "resend invite" action reuses the
  existing claim flow.
- Login history / audit log of sessions (only the last timestamp).
- Showing last login to other owners or in the neighbours directory.
- External API connections pairing (`pairing_requests`) — see Notes, it is not owner data.
- Re-parsing LVs of communities already imported (backfill of ordinal / BSM) — Deferred.

## Approach

### What exists (do not rebuild)

- Unified Vlastníci page: `src/app/[locale]/(dashboard)/owners/page.tsx` → `loadOwnersBoard(rootId)`
  (`src/lib/owners-board.server.ts:339`) → `OwnersBoard` client. Status model
  `no_account | invited | pending | active` documented at `src/lib/owners-board.ts:6-17`.
  `OwnerRow` already carries `email`, `invite {sentAt, expiresAt, expired}`, `deactivated`,
  `emailVerified`, `flats[]` with shares (`src/lib/owners-board.ts:35-50`).
- Per-status primary actions already exist in `OwnersBoard.tsx:157-185` (invite, resend via
  `claim(row, "email"|"qr")` → `POST /api/admin/shell-users/claim`, revoke). Registrations
  inbox with approve/merge: `OwnersInbox.tsx`, `PendingApprovalModal.tsx`; old route
  `/owners/pending-registrations` redirects to `/owners#inbox`.
- Share-sum check: `listShareSumViolations()` (`src/lib/share-sum-invariants.server.ts:19`),
  loaded in the shell (`src/lib/shell.server.ts:181`) for `manageUsers` users and shown by
  `ShareSumInvariantBanner` (`src/components/admin/ShareSumInvariantBanner.tsx`) and on owner
  detail (`OwnerDetail.tsx:174`). Gaps: it is **not scoped to a community root**, ignores units
  with zero active memberships, and is not a pure function.
- Import-time share check with codes: `owner_share_sum_not_one` in `src/lib/import/validate.ts:270`
  (prose `message` is SK-hardcoded — tech debt, not touched here). Exact rationals:
  `src/lib/rational.ts`.
- LV parser: strips poradové č. (`lv-paste.ts:251-253`) and detects BSM, splitting one LV row
  into two owners with `shareDen * 2` (`lv-paste.ts:263-300`). **Neither fact is persisted** —
  `ImportRow` (`src/lib/import/types.ts:30-44`) has no field for them and `seed.ts:539` inserts
  memberships without them.
- Nav badge plumbing: `NavBadgeKey = "pendingRegistrations"` (`src/lib/navigation.ts:14,117`),
  `ShellData.badges` (`src/lib/shell.server.ts:214`), `countPendingRegistrations` cached
  (`src/lib/shell.server.ts:113`). BoardHome todo row for registrations
  (`src/components/home/BoardHome.tsx:65-72`).
- Sign-in hook: `events.signIn` in `src/lib/auth.ts:160-169` and SSO `src/app/api/auth/sso/route.ts:83`
  dispatch `onUserLogin`. **No last-login timestamp is stored anywhere** (grep for
  `lastLogin|last_login|lastSeen` in `src/` + `modules/` returns nothing).
- Name similarity for merge suggestions: `src/lib/name-match.ts` (`rankCandidates`).

### Queue items (engine: `src/lib/owner-queue.ts`, pure, client-safe types)

`computeOwnerQueue(people, now, opts) → QueueItem[]`, input = `OwnerRow[]` plus
`lastLoginAt`. Each item `{ code, userId, fingerprint, facts }`; UI maps `code` → i18n
(`Owners.queue.<code>.reason` / `.action`). No prose in the engine.

| code | condition | reason (sk gist) | primary action |
|---|---|---|---|
| `registration_pending` | `status = pending` | "Zaregistroval sa {date}, čaká na schválenie" | Schváliť → existing `PendingApprovalModal` (merge suggestion kept) |
| `missing_email` | `status = no_account`, `email IS NULL`, has ≥1 owner flat | "Nemá e-mail — nedostane pozvánku ani oznamy" | Doplniť e-mail → `OwnerEditForm` on detail (or inline field) |
| `invite_unfinished` | `status = invited` and invite older than N days (default 7) **or** expired | "Pozvaný {date}, registráciu nedokončil" / "Pozvánka vypršala {date}" | Poslať znova → existing `claim(row, email ? "email" : "qr")` |
| `never_logged_in` | `status = active`, not deactivated, `last_login_at IS NULL`, account activated ≥ 14 days ago and after `LAST_LOGIN_TRACKING_SINCE` | "Účet má, ešte sa neprihlásil" | Poslať prístup znova → password-reset mail (if flow exists, else "Vytlačiť QR") — see Decisions |
| `inactive_long` | `status = active`, `last_login_at` older than 12 months | "Naposledy prihlásený {date}" | Otvoriť kartu (secondary only — informative) |

Order: `registration_pending` first (it blocks the person), then `missing_email`,
`invite_unfinished`, `never_logged_in`, `inactive_long`. Within a code, oldest first.
One primary button per item (senior baseline), everything else in the row's `ActionMenu`.

The existing "Čaká na vás (N)" inbox becomes the first group of "Na riešenie" (same anchor
`#inbox`, same components) — it is extended, not replaced, so the UX-simplification decision
"one inbox for registrations" holds.

### "Mark as handled", undo and auto-clear

New table `owner_queue_dismissals` — one row = "board hid this item for this fingerprint".

- **Fingerprint** = hash of the facts that define the condition (e.g. `invite_unfinished:
  <invitation id>`, `missing_email:<user id>`, `never_logged_in:<user id>`,
  `check:share_sum:<unit id>:<sum>`). If the facts change (new invitation, different sum),
  the fingerprint changes and the item re-appears — a dismissal never hides a *new* problem.
- **Auto-clear**: items are derived at read time from live data; when the condition
  disappears the item simply is not produced. No job, no write on read. Stale dismissal rows
  are harmless (they never match) and go away by FK cascade with the user/unit/root; an
  optional prune of rows whose fingerprint no longer matches happens inside the dismiss/undo
  server action (same transaction, scoped to the root) — never on page load.
- **Undo**: toast "Označené ako vyriešené · Späť" calls `undoDismissAction(id)` = DELETE of the
  row. A "Zobraziť vyriešené (N)" filter lists dismissed items with "Vrátiť späť" — the undo
  path stays reachable after the toast is gone.
- Dismissal is per community, not per chairman (all `manageUsers` users share one queue).

Server actions in `src/app/[locale]/(dashboard)/owners/actions.ts` next to the existing
ones, same `requireManageUsers()` gate; queries in `src/lib/owner-queue.server.ts`. Errors as
codes (`forbidden | not_found | failed`), mapped in the UI like `RevokeInviteErrorCode`.

### Ownership data checks (engine: `src/lib/owner-checks.ts`, pure)

`runOwnershipChecks(units, memberships) → CheckFinding[]`, `{ code, unitId, userIds,
fingerprint, facts }`. Exact rationals via `src/lib/rational.ts`. Codes:

| code | rule | facts |
|---|---|---|
| `share_sum_mismatch` | active owner memberships of a unit sum ≠ 1/1 (sum > 0) | `sum`, `direction: under|over` |
| `unit_without_owner` | active, non-archived unit with zero active owner memberships | — |
| `bsm_partner_missing` | a membership marked BSM has no second BSM membership on the same unit with the same LV ordinal | `ordinal` |
| `bsm_share_mismatch` | the two BSM memberships of a pair have different shares | `shares[]` |
| `bsm_too_many` | more than two memberships share one BSM ordinal on a unit | `count` |
| `duplicate_ordinal` | same LV ordinal on two memberships of the community that are **not** one BSM pair on one unit | `ordinal`, `unitIds[]` |

`missing co-owner` is expressed by `share_sum_mismatch` with `direction = under` (UI copy
"Chýba spoluvlastník alebo podiel"), so it is one check, not two that fire together.

Checks run only for communities whose template owns the HOA ownership model (BSM is a
Slovak/Czech marital-property concept; ordinals exist only for LV-imported units). Findings
for units without ordinal data are simply not produced — no false "duplicate" on manual data.

`listShareSumViolations()` is re-implemented on top of `runOwnershipChecks` and gains the
`rootId` scope; the banner and owner-detail warning keep their output (behaviour-preserving
for those surfaces, plus correct scoping).

UI: "Kontrola údajov" tab/section under the queue on `/owners`, filter chips per code
(URL param `?check=<code>`, server-readable), each finding links to the unit's owners
(`/owners?unit=<id>` or owner detail). Same dismiss/undo mechanism (fingerprint above).
Copy says "na kontrolu", never "chyba" — data may be legally correct (e.g. an unresolved
inheritance), so nothing blocks voting, import or editing.

### Last login

- New column `users.last_login_at timestamptz NULL`.
- Written in `events.signIn` (`src/lib/auth.ts:161`) and the SSO path
  (`src/app/api/auth/sso/route.ts:83`) as a single-row
  `UPDATE users SET last_login_at = now() WHERE id = $1`, fire-and-forget like the hook
  (failure logged, never blocks login). Multi-replica safe: one row per request, no lock
  beyond the row, no loop. Kiosk/on-site PIN sessions (if/when they exist) do not write it.
- Existing users have NULL and no history; `LAST_LOGIN_TRACKING_SINCE` (constant in
  `src/lib/owner-queue.ts`, = release date) prevents flagging everyone as "never logged in"
  on day one: such users show "bez záznamu (sledujeme od {date})".
- Owner detail (`OwnerDetail.tsx`, in the `<dl>` next to "registered") shows
  "Naposledy prihlásený: {date}" / "Ešte sa neprihlásil". Loaded by `loadOwnerDetail` only
  when the viewer has `manageUsers`; the field is absent from every other payload
  (`/api/users*`, directory, MCP tools, owner self-view unless Decision says otherwise).
- GDPR: last login is personal data; purpose = helping the board reach owners who are not
  using the app (legitimate interest of the community). Visible only to `manageUsers`
  (today `admin`, `src/lib/permissions.ts:12`). Mentioned in the processing notice — see
  Decisions. Legal basis lookup: topic `gdpr` → `sk-18-2018` in `src/lib/laws-topics.ts:98`
  (no CZ act in the library yet).

### Badges and Domov

- `countOwnerQueue(rootId)` in `src/lib/owner-queue.server.ts`, wrapped in React `cache()` like
  `countPendingRegistrations`, resolved in `resolveShellData` (`src/lib/shell.server.ts`) only
  for active `manageUsers` users. One set of queries per request; `/owners` reuses the same
  cached loader so the page does not query twice.
- New `NavBadgeKey "ownerQueue"` replaces `"pendingRegistrations"` on the Vlastníci entry;
  value = open (not dismissed) queue items. Data-check findings are **not** in the badge (they
  are informative); they show as a secondary count inside the page.
- BoardHome: the registrations row (`BoardHome.tsx:65`) stays for `registration_pending`
  (most urgent); one more row "Na riešenie pri vlastníkoch: {count}" for the remaining queue
  codes → `/owners#queue`. Shown only when count > 0, as today.
- Nothing is polled or invalidated live; counts refresh on navigation / `router.refresh()`
  after an action.

### Schema sketch (via `drizzle-kit generate`, additive)

```ts
// src/db/schema.ts
users.lastLoginAt: timestamp("last_login_at", { withTimezone: true }) // nullable

memberships.lvOrdinal: integer("lv_ordinal")            // nullable; poradové č. from LV part B
memberships.ownershipForm: text("ownership_form")       // nullable; "bsm" | null (sole/podiel)

export const ownerQueueDismissals = pgTable("owner_queue_dismissals", {
  id: uuid("id").primaryKey().defaultRandom(),
  rootId: uuid("root_id").references(() => entities.id, { onDelete: "cascade" }).notNull(),
  code: text("code").notNull(),                          // queue or check code
  subjectUserId: uuid("subject_user_id").references(() => users.id, { onDelete: "cascade" }),
  subjectUnitId: uuid("subject_unit_id").references(() => entities.id, { onDelete: "cascade" }),
  fingerprint: varchar("fingerprint", { length: 128 }).notNull(),
  handledById: uuid("handled_by_id").references(() => users.id, { onDelete: "set null" }),
  handledAt: timestamp("handled_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  uniq: uniqueIndex("owner_queue_dismissals_root_fp_idx").on(t.rootId, t.fingerprint),
}));
```

`ownership_form` is text (not enum) to keep room for future forms without an enum migration;
the engine accepts only known values. Import: `ImportRow` gains optional `lv_ordinal`,
`ownership_form`; `parseOwnerLines` keeps the stripped ordinal and the BSM flag instead of
discarding them; `seed.ts:539` writes them. Manual owner creation leaves both NULL.

**DB impact (needs `pnpm db:migrate` by Filip):** 3 nullable columns (`ALTER TABLE ADD COLUMN`,
no default rewrite, brief lock), 1 new table + 1 unique index. No backfill, no runtime DDL,
no background job, no cron. Writes: one row UPDATE per sign-in; dismissals only on explicit
board action.

### Performance

The queue and checks read the same rows `loadOwnersBoard` already loads (people, memberships,
units for one root) — derive both client-side of the DB from one fetch; do not add per-row
queries. Dismissals: one indexed query per root. Badge on every board page = one extra
grouped query set, request-cached.

## Acceptance Criteria

Queue
- [x] `/owners` shows "Na riešenie (N)" for `manageUsers` users; non-`manageUsers` users get the
      existing no-permission state and no queue data in any payload.
- [x] Each queue code in the table above produces exactly one item per affected person with its
      reason sentence and exactly one primary button; the button opens the existing flow
      (approve modal, edit e-mail, claim resend).
- [x] Unit test of `computeOwnerQueue`: a fixture with one person per condition plus one
      healthy active owner returns exactly the expected set of `{code, userId}` — asserting full
      membership/count, so a healthy owner producing any item fails the test.
- [x] A person matching two conditions (e.g. invited with expired invite and no e-mail → QR) gets
      one item with the highest-priority code, not two.
- [x] Adding the missing e-mail, approving a registration, or the owner finishing registration
      removes the item on next render without any dismissal row being written.
- [x] "Označiť ako vyriešené" hides the item, shows an undo toast; "Späť" restores it; the
      "Zobraziť vyriešené" filter lists it with "Vrátiť späť" which also restores it (row deleted).
- [x] A dismissed `invite_unfinished` item re-appears when a new invitation is sent and that one
      also goes unfinished (fingerprint changed).
- [x] Existing users with `last_login_at IS NULL` created before `LAST_LOGIN_TRACKING_SINCE` are
      not flagged `never_logged_in`.

Data checks
- [x] `runOwnershipChecks` unit tests: one fixture per code returns that code only; a clean
      community (sole owners 1/1, one correct BSM pair 1/2+1/2 sharing one ordinal) returns an
      empty array.
- [x] A correct BSM pair (same unit, same ordinal, equal shares) produces no
      `duplicate_ordinal`; the same ordinal on another unit does.
- [x] Units without ordinal / ownership-form data never produce BSM or ordinal findings.
- [x] Filter chips narrow the list to one code; the URL carries the filter and survives reload.
- [ ] No check blocks voting, import, owner editing or saving — verified by saving an owner whose
      unit has a `share_sum_mismatch`.
- [x] `ShareSumInvariantBanner` and owner-detail share warning list only units of the current
      community root (regression for the unscoped `listShareSumViolations`).
- [x] LV paste import of a fixture with a BSM row and ordinals stores `lv_ordinal` and
      `ownership_form = 'bsm'` on both spouse memberships; a sole owner row stores the ordinal
      and NULL form.

Last login
- [x] Credentials and SSO sign-in set `users.last_login_at`; a failing update does not block
      sign-in.
- [x] Owner detail shows last login (or "ešte sa neprihlásil" / "bez záznamu") to `manageUsers`.
- [ ] Negative test: `last_login_at` is absent from owner self-view payload, neighbours
      directory, `/api/users` list for non-admins and MCP owner tools.

Badges
- [x] Vlastníci nav badge equals the number of open (non-dismissed) queue items; data-check
      findings are not counted.
- [x] BoardHome shows the registrations row and one "Na riešenie" row only when their counts > 0.
- [x] Loading `/owners` triggers the queue/check queries once per request (shell + page share
      the cached loader); no client fetch, no polling, no websocket.

Cross-cutting
- [x] All new strings in `messages/sk.json`, `en.json`, `cs.json` (`Owners.queue.*`,
      `Owners.checks.*`, `Owners.lastLogin*`, `Home.todo.ownerQueue`); engine returns codes only.
- [ ] Senior baseline: ≥ 44 px targets, `text-base`, one primary per item, works at 390 px
      without horizontal scroll.
- [ ] Migration generated with `drizzle-kit generate`, committed with schema; every new FK has
      explicit `onDelete`.

## Project Context

- Schema: `src/db/schema.ts` — `users` (365), `memberships` (304-340, share columns 316-327),
  `invitations` (660), `entityAuditLog` (343).
- Owners page + actions: `src/app/[locale]/(dashboard)/owners/page.tsx`, `owners/actions.ts`,
  `owners/[id]/page.tsx`.
- Owners lib: `src/lib/owners-board.ts`, `src/lib/owners-board.server.ts`.
- Owners UI: `src/components/owners/OwnersBoard.tsx`, `OwnersInbox.tsx`, `OwnerDetail.tsx`,
  `OwnerEditForm.tsx`, `PendingApprovalModal.tsx`, `ShellClaimDialog.tsx`.
- Share check: `src/lib/share-sum-invariants.server.ts`, `src/components/admin/ShareSumInvariantBanner.tsx`,
  `src/lib/rational.ts`.
- Import: `src/lib/import/parsers/lv-paste.ts`, `src/lib/import/types.ts`, `src/lib/import/seed.ts`,
  `src/lib/import/validate.ts`, `src/lib/name-match.ts`.
- Shell / nav / home: `src/lib/shell.server.ts`, `src/lib/navigation.ts`, `src/lib/home.server.ts`,
  `src/components/home/BoardHome.tsx`.
- Auth: `src/lib/auth.ts` (events.signIn), `src/app/api/auth/sso/route.ts`, `src/lib/permissions.ts`.
- Laws: `src/lib/laws-topics.ts` (topics `gdpr`, `ownership_general`); `docs/domain/voting.md`.
- Migrations: `drizzle/` (latest `0084_enable_banking_connector.sql`), `drizzle/meta/_journal.json`.
- Redesign baseline: `specs/in_progress/2026-11-17-ux-simplification.md` (Phase 3 nav badges,
  Phase 4 board Domov, Phase 5 Vlastníci).

## Notes

- Brief mentioned `pairing_requests` for "pending registration / pairing". In code that table
  (`src/db/schema.ts:767`) pairs **external API connections** (`external_connections`), not
  owners. Owner pairing is the shell-claim flow: `invitations.target_shell_user_id` +
  `users.status = 'pending'`. This spec uses the latter.
- Competitor Resitech has the same idea set (queue on owners, data checks, last login on owner
  profile); they also show ownership history (from–to) and proxies on the profile — not here.

### Decisions to confirm

1. **Who sees last login** — only `manageUsers` (admin) as specced, or every board member
   (chairman/council without admin role)? Should the owner see their own last login in Profil
   (transparency, harmless)? Does the processing notice / consent text need a line added
   (legal copy sign-off)?
2. **`never_logged_in` action** — is there a working password-reset e-mail for active users to
   reuse? If not, the action is "Vytlačiť prístup (QR)" only. No new e-mail kind in this spec.
3. **Thresholds**: invite unfinished after 7 days, never-logged-in after 14 days, inactive after
   12 months — fixed constants or per-community setting? (Default: constants.)
4. **Is `inactive_long` in the queue at all**, or only visible on the profile? It may be noise
   for owners who intentionally use paper.
5. **BSM / ordinal for already-imported communities** — accept "no data → no findings", or
   offer a one-off "re-read LV" that only fills `lv_ordinal` / `ownership_form` without
   touching shares?
6. **Template gating** — run BSM/ordinal checks for SK + CZ HOA templates only? CZ SJM is the
   Czech equivalent of BSM; confirm the LV parser marker applies to CZ výpis too.
7. Dismissals shared per community (specced) vs per board member.

### Deferred

- Backfill of ordinals / BSM from stored LV files.
- E-mail digest to the chairman of open queue items (would need a `kind` in the existing
  `*_notifications_sent` pattern and a cron route under `src/app/api/cron/` with a DB-level
  dedupe so N replicas send once).
- Ownership history (from–to) and proxies on owner profile.
- Moving the import validator's SK-hardcoded `message` to codes-only (tech debt noted above).

## Implementation notes (2026-11-18)

Files
- Engines (pure, client-safe, codes only): `src/lib/owner-queue.ts` (`computeOwnerQueue`, thresholds as
  named constants, `LAST_LOGIN_TRACKING_SINCE = 2026-11-18`), `src/lib/owner-checks.ts` (`runOwnershipChecks`).
- Server: `src/lib/owner-health.server.ts` (`loadOwnerHealth` request-cached, `countOwnerQueue`, dismiss / undo
  with in-transaction prune); payload types `src/lib/owner-health.ts`. Spec named it `owner-queue.server.ts`.
- `src/lib/owners-board.server.ts`: `loadOwnersSnapshot(rootId)` (React `cache()`) — shell badge, share-sum
  banner, Domov row and `/owners` share ONE set of owners queries per request. `OwnerInvite` gained `id`
  (fingerprint); `last_login_at` is never copied into `OwnerRow`; `OwnerDetailData.lastLoginAt` only.
- `listShareSumViolations(rootId)` rebuilt on `runOwnershipChecks`, scoped to the root, counts only
  `role = 'owner'` memberships (was: every active membership of every community).
- UI: `src/components/owners/OwnersHealth.tsx` ("Na riešenie" `#queue` wrapping the existing `OwnersInbox`,
  "Kontrola údajov" `#checks` with `?check=` chips); `?unit=` owner filter in `OwnersBoard`;
  `/owners/[id]?edit=1` opens the edit form (missing e-mail action); last login row on `OwnerDetail`.
- Nav badge key `ownerQueue` replaces `pendingRegistrations` on Vlastníci; BoardHome row `OwnerHealth.homeRow`.
- Last login: `src/lib/last-login.server.ts` `recordLastLogin()` from `events.signIn` (credentials + passkey)
  and the SSO route; never throws.
- LV import: parser keeps `lv_ordinal` + `ownership_form`; `ImportRow`, zod row schema, grid columns
  (`lv_ordinal`, `ownership_form`) and `seed.ts` carry them to `memberships`.
- i18n: new top-level namespace `OwnerHealth` (sk/en/cs) instead of `Owners.queue.*` / `Home.todo.ownerQueue`.
- Check script: `scripts/owner-health-check.ts` (`pnpm test:owner-health`) — not run by the implementer.

Decisions taken (defaults from the coordinator)
1. Last login: visible on owner detail (manageUsers gate of `/owners/[id]`); the owner sees their own on
   Profil (deviation from the "absent from owner self-view" AC — left unticked). Board members without
   `manageUsers` have no owners surface today, so in practice = admin. Processing-notice line: not added
   (legal copy sign-off needed).
2. `never_logged_in`: no password-reset flow exists (`sendPasswordReset` is unused) and the claim QR only
   works for owner records → primary action "Otvoriť kartu" + hint to remind the owner. `TODO(decision)` in
   `OwnersHealth.tsx`.
3. Thresholds: constants (7 / 14 / 365 days).
4. `inactive_long`: in the queue, collapsed under "Dlho neaktívni", NOT counted in the badge / Domov.
   Pre-tracking accounts with NULL become `inactive_long` once tracking has run 365 days.
5. No backfill of BSM / ordinals for already-imported communities ("no data → no findings").
6. BSM / ordinal checks only when the root template is `hoa` (or no slug) and country is SK / CZ.
7. Dismissals shared by the whole board of the community.
- `registration_pending` items have no "vyriešené" (they are rendered by the existing inbox: approve / reject).
- "Activated ≥ 14 days ago" uses `users.created_at` (no activation timestamp exists).

DB (coordinator runs `pnpm db:generate`): `users.last_login_at timestamptz NULL`, `memberships.lv_ordinal
integer NULL`, `memberships.ownership_form text NULL`, table `owner_queue_dismissals` + unique index
`owner_queue_dismissals_root_fp_idx (root_id, fingerprint)`. No backfill, no runtime DDL, no job.

Open / manual
- Verify by hand: saving an owner on a unit with `share_sum_mismatch` is not blocked; 390 px layout;
  negative checks that `last_login_at` is absent from `/api/users`, neighbours directory and MCP tools
  (it is never selected there).


### Implementation notes — unit type check (2026-11-18)
- New check code `unit_type_unset` ("Skontrolujte typy priestorov") in `src/lib/owner-checks.ts`:
  ONE aggregated finding (unitIds = every live unit without a valid `data.unit_type`, `facts.count`),
  HOA communities only (`unitTypeCheck` option, set in `owner-health.server.ts`). Fingerprint covers
  the unit ids, so "Označiť ako vyriešené" works like other checks and the item returns when a new
  unclassified unit appears. Informative only — never in the nav badge, never blocks anything.
- Action button opens `/settings?tab=building&unitTypes=1` — FlatsTab bulk mode with every
  unclassified unit pre-selected (select all / select unset / clear, one type select, "Nastaviť
  typ"); endpoint `POST /api/flats/unit-type` (manageSettings, current root, one UPDATE).
- Check script: `scripts/owner-health-check.ts` §4 (exact-set check + LV NP detection). Not run.
