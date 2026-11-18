---
spec_id: BYT-20261118-007
title: "Owner removal, transfer (sale) and account merge without losing the building's history"
status: in_progress
created: 2026-11-18
updated: 2026-11-18
author: Filip
owner: filipvnencak
last_verified: 2026-11-18
project_type: node
depends_on:
  - BYT-20261117-002   # UX simplification: Vlastníci IA, UI kit (ConfirmDialog, ActionMenu), senior baseline
  - BYT-20260512-001   # shell-user claim & merge (mergeShellIntoUser — generalised here)
  - BYT-20260515-001   # multi-kind community tree (memberships on any kind, listUserRoots)
  - BYT-20260511-001   # per-share multi-owner vote resolution
  - BYT-20260609-008   # multi-item ballots (ballots / ballot_item_votes, itemAuditHash)
  - BYT-20260512-002   # accounting module ("debt follows the person")
  - BYT-20260609-006   # GDPR toolkit (consent_records set null + subjectRef)
related_handoffs: []
tags: [owners, memberships, history, merge, gdpr, retention, voting, accounting, schema-change]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

The board can record a sale, remove an owner, or merge two accounts of the same
person, and the building's history stays intact: who owned which unit when, how
each unit voted, what each owner was billed and paid. Every destructive action
first shows what it will touch, with counts, and asks for an explicit confirm.

### Problem statement

Today ownership is a single row with no time axis, and every "remove" path
hard-deletes it. Verified in code on 2026-11-18:

- `memberships` (`src/db/schema.ts:304`) has `status` (`pending|active|archived`)
  and `createdAt`, but no from–to. The `archived` value exists and nothing in the
  owner UI sets it.
- **Removing a unit from an owner deletes the membership.** `PATCH /api/users/[id]`
  with `flatIds` (`src/app/api/users/[id]/route.ts`, used by `OwnerEditForm`) runs
  `db.delete(memberships)` for every unit dropped from the list. No audit entry,
  no end date. After that nobody can say who owned the unit before.
- `PATCH /api/external/v1/users/[id]` deletes **all** of a user's memberships and
  re-inserts them without `owner_unit_share_*` or `weight`, so every co-owner share
  is reset to 1/1.
- `DELETE /api/admin/memberships/[id]` (external API) hard-deletes. It does write an
  audit row (`membership.remove`).
- **DATA-LOSS RISK: closed voting results change when ownership changes.**
  `modules/voting/src/results.ts:104-112` recomputes every result, including closed
  votings, by joining the **current active** membership on `(ballot.entityId,
  ballot.ownerId)`. If that membership has been deleted or archived, the share falls
  back to `?? 1` (`:124-126`). A co-owner who voted with 1/2 counts as 1/1 once they
  sell, so a closed result can flip. The member-scoped `totalPossibleWeight`
  (`:164-176`) also sums today's members, not the members on the voting date.
- **DATA-LOSS RISK: accounting access follows only today's members.**
  `modules/accounting/src/lib/owner-payments.ts:50` and `debtors.ts:94,222` read
  `memberships.status = 'active'`. Once a seller's row is gone, their karta bytu,
  debts and settlements no longer belong to anyone. The domain rule says the
  opposite: "Debt follows the person, not the unit" (`docs/domain/accounting.md:48`).
  Assessments do snapshot owner ids (`allocationBasisSnapshot.ownerUserIds`,
  `modules/accounting/src/engine/assessment.ts:59`), but that is jsonb with no FK.
- `DELETE /api/users/[id]` checks for a ballot, post, document, mandate or voting
  before it deletes. Any other row that blocks the delete (accounting `created_by_id`
  restrict, `board_members.user_id`, `community_posts`/`community_responses`
  `author_id`, `pairing_requests.created_by_id`, all with no or restrict `onDelete`)
  ends in an unhandled FK error, a 500. Rows with cascade are **silently destroyed**
  (see the FK table).
- `mergeShellIntoUser` (`src/lib/shell-merge.ts`) works only for shell → real
  account. It re-points about 30 FK columns by hand and misses others:
  `webauthn_credentials`, `oauth_*`, `mcp_*`, `document_access_log`,
  `project_comments`, `project_interest`, `email_verifications`,
  `mod_voting_pending_ballots`, and every `mod_accounting_*` column. For a merge
  between two real accounts those columns either block the delete (restrict) or
  get cascaded away. It also leaves ballot hashes unverifiable: `itemAuditHash`
  includes `ownerId`, and the file comment flags this as an open issue.
- No "former owners" view exists anywhere. `OwnerDetail` offers deactivate
  (`isActive`) and delete, nothing else.

#### FK inventory → `users.id` (current `onDelete`, effect of `DELETE users`)

| Table.column | onDelete today | Effect of deleting the user today |
|---|---|---|
| `memberships.user_id` | cascade | **ownership history destroyed** |
| `consent_records.user_id` | cascade | **consent proof destroyed** (GDPR accountability, BYT-20260609-006) |
| `webauthn_credentials`, `push_subscriptions`, `notification_preferences`, `email_verifications`, `oauth_authorization_codes`, `oauth_tokens`, `mcp_pending_actions` `.user_id` | cascade | destroyed (fine, these are credentials and settings) |
| `directory_entries.user_id`, `event_rsvps.user_id`, `project_interest.user_id` | cascade | destroyed (RSVPs to schôdza events are lost) |
| `community_notifications_sent.subject_user_id/recipient_id` | cascade | destroyed (dedupe history) |
| `mod_accounting_notifications_sent.recipient_id` | cascade | **proof that settlement or debt notices were sent is destroyed** |
| `mod_voting_pending_ballots.owner_id` | cascade | destroyed (fine, never counted) |
| `invitations.created_by_id`, `registration_tokens.created_by_id` | cascade | an admin's delete wipes the invitations they issued |
| `invitations.target_shell_user_id` | cascade | fine |
| `entity_audit_log.actor_user_id`, `documents.uploaded_by_id`, `document_access_log.user_id`, `project_comments.author_id`, `mcp_audit_log.user_id`, `community_notifications_sent.responder_id`, `core_module_grants.granted_by_id`, `invitations.used_by_user_id`, `mod_voting_ballots.recorded_by_id` | set null | attribution lost |
| `mod_voting_ballots.owner_id`, all `mod_accounting_*` `created_by_id`/`voided_by_id`/`actor_id`/`published_by_id`/`uploaded_by_id` | restrict | blocks the delete; only ballots are pre-checked, so the rest end in a 500 |
| `posts.author_id`, `community_posts.author_id`, `community_responses.author_id`, `board_members.user_id`, `pairing_requests.created_by_id`, `mod_voting_votings.created_by_id/vote_counter_id`, `mod_voting_mandates.from_owner_id/to_owner_id/verified_by_admin_id` | none (= no action) | blocks the delete; only posts, votings and mandates are pre-checked |

Entity side: `memberships.entity_id` restrict, accounting/voting `entity_id` restrict,
so units cannot be deleted while they have history. That part is already correct.

## Scope

**In scope**
1. **Ownership validity period.** `memberships` gets `valid_from`, `valid_to`,
   `end_reason`. An ownership ends; it is not deleted. `status='archived'` becomes
   the "ended" state.
2. **Transfer (sale / inheritance / gift)** as one flow on a unit: end the seller's
   ownership at a date and start the buyer's at the same date, with shares, in one
   transaction.
3. **"Zobraziť bývalých vlastníkov"** (show former owners) on a unit and in the
   Vlastníci table. Former owners carry a chip and their from–to dates.
4. **Remove an owner from a community** (`root` subtree): end every membership in
   that subtree. All history is kept. The account stays active when the user still
   has active memberships under another root; otherwise it is deactivated
   (`isActive=false`), not deleted.
5. **Merge two accounts of the same person** (real ↔ real, generalising
   `mergeShellIntoUser`). All history moves to the survivor, including ballots,
   mandates, meeting attendance (RSVPs today, `voting_attendance` once kiosk lands)
   and accounting attribution. Conflicts are resolved by the rules below.
6. **Impact summary screen** before every end-ownership, remove, transfer, merge,
   hard delete and anonymise. It lists what will be archived, moved, kept or
   destroyed, with counts. Nothing runs without an explicit confirm.
7. **Hard delete only when nothing would be kept.** It is driven by one FK
   registry, so it can never 500 or cascade away retained data.
8. **History-safe reads.** Voting results and accounting owner access read
   membership **as of a date**, not "currently active".
9. **Retention vs erasure rule** (below), plus an "anonymise" action that removes
   contact data and keeps statutory records.
10. Fix the two hard-delete paths (`PATCH /api/users/[id]` flatIds,
    `PATCH /api/external/v1/users/[id]`) so they end memberships instead of deleting
    them.
11. i18n for every new string in `sk.json`, `en.json`, `cs.json`. Engines and
    services return error **codes**.

**Out of scope**
- Split-year vyúčtovanie per ownership period. The domain rule exists
  (`docs/domain/accounting.md:48`); this spec only provides the validity data that
  will drive it. Separate accounting spec (Deferred).
- Kataster LV change watch (competitor Resitech has it). Deferred.
- Full DSAR export and a general erasure workflow for non-owner data (BYT-20260609-006
  follow-ups).
- Multi-root per instance as a product feature. This spec only respects roots
  that already exist (`listUserRoots`).
- Merging two **units** or entities.

## Approach

### 1. Schema sketch (generated with `drizzle-kit generate` where possible)

```ts
// memberships — additive columns
validFrom   date   notNull           // backfill: created_at::date
validTo     date                     // null = current ownership
endReason   varchar(32)              // 'sale' | 'inheritance' | 'gift' | 'removed' | 'merged' | 'correction'
endedById   uuid -> users.id  on delete set null   // who recorded the end (soft attribution)
transferId  uuid -> ownership_transfers.id on delete set null
// unique (user_id, entity_id) → partial unique (user_id, entity_id) WHERE valid_to IS NULL
//   (lets someone sell and later re-buy the same unit)
// check: valid_to IS NULL OR valid_to >= valid_from
// invariant (app layer, extends share-sum-invariants.server.ts): status='archived' ⇔ valid_to IS NOT NULL

ownership_transfers {                 // one row per sale / inheritance event on a unit
  id            uuid pk
  unitEntityId  uuid -> entities.id on delete restrict  notNull
  effectiveDate date notNull           // deň vkladu do katastra / date of death etc.
  kind          varchar(32) notNull    // sale | inheritance | gift | correction
  note          text
  documentId    uuid -> documents.id on delete set null   // optional deed / LV scan
  createdById   uuid -> users.id on delete restrict notNull
  createdAt     timestamp defaultNow notNull
}

// users — tombstone instead of delete for merge + anonymise
mergedIntoUserId uuid -> users.id on delete restrict   // set on the merged-away account
mergedAt         timestamp
anonymizedAt     timestamp

user_merges {                          // alias table; resolves ids frozen in jsonb snapshots and hashes
  id            uuid pk
  fromUserId    uuid -> users.id on delete restrict notNull   // tombstone stays, so restrict is safe
  intoUserId    uuid -> users.id on delete restrict notNull
  impactJson    jsonb notNull          // the counts shown on the impact screen, frozen
  actorUserId   uuid -> users.id on delete set null
  createdAt     timestamp defaultNow notNull
}

// mod_voting_ballots — freeze what the result needs, at cast time
ownerUnitShareNumerator   integer   // snapshot at cast; backfill from current membership (best effort, see migration)
ownerUnitShareDenominator integer
membershipWeight          integer
hashOwnerId               uuid      // the owner id the item hashes were built with; set only on merge (no FK, immutable)

// entity_audit_action enum: + 'membership.end', 'membership.transfer', 'user.remove_from_root',
//                             'user.merge', 'user.anonymize', 'user.hard_delete'
```

FK choices:
- `ownership_transfers.unitEntityId` is restrict (history of a unit blocks deleting it).
  `createdById` is restrict, matching the accounting authorship convention.
- `user_merges.*` is restrict. The tombstone row is never deleted, which is the point
  of the alias.
- `memberships.user_id` **stays cascade**. A user row is never deleted while it has
  memberships: hard delete is blocked by the registry, and merge and anonymise keep
  the row.

Migration: one hand-written SQL migration (CLAUDE.md pattern: copy the 0084
snapshot, new UUID, `prevId`, JSON-mutated snapshot, journal entry) for:
- the `valid_from` backfill;
- swapping the unique index to a partial one;
- the enum value adds;
- the ballot share backfill: `UPDATE ballots SET owner_unit_share_* = m.*` from the
  matching membership. Ballots with **no** matching membership are left NULL and
  listed in a one-off read-only report (count in the PR). Those are votings whose
  history is already damaged by today's delete path.

It runs in `docker-entrypoint.sh` like every migration. There is no runtime DDL.

### 2. As-of membership (the history-safe read)

New helper `src/lib/db/memberships.ts → membershipAt(entityId, userId, date)` and a
SQL fragment `activeOn(date)` = `valid_from <= date AND (valid_to IS NULL OR valid_to > date)`.
Callers that must switch:
- `modules/voting/src/results.ts`: use the ballot's frozen share. Fall back to
  `activeOn(voting.endsAt)` only for NULL backfills. Member-scoped
  `totalPossibleWeight` uses `activeOn(voting.endsAt)`.
- `modules/voting/src/participation.ts`: eligibility uses `activeOn(now)` for open
  votings and `activeOn(endsAt)` for closed ones.
- `modules/accounting/src/lib/owner-payments.ts`, `debtors.ts`: a former owner keeps
  **read** access to assessments and payments dated inside their validity period
  (`docs/domain/accounting.md:44,48`). Debtor lists attribute a debt to the owner
  at the assessment's due month (from `ownerUserIds` in the snapshot, resolved
  through `user_merges`).
- Everything that grants **write or vote** rights (cast, mandates, meter entry,
  posting) keeps reading `status='active' AND valid_to IS NULL`.

The voting engine (`modules/voting/src/engine`) is not touched. Only its inputs
become stable (UX spec hard constraint: legally regulated code stays
behaviour-preserving).

### 3. Transfer (sale) flow

Unit → "Zmena vlastníka" wizard, 3 steps, one primary button each:
1. **Who leaves.** Checkboxes over the unit's current owners (co-owners can sell
   partially).
2. **Who comes.** Pick an existing account, an existing shell, or "Nový vlastník",
   which reuses `createOwnerAction` / shell creation. Set the shares. The live
   share-sum check must show 1/1.
3. **Date + kind + optional deed document.** The impact summary follows (§6).

Service `transferOwnership()` in `src/lib/ownership.server.ts` runs one transaction:
- insert `ownership_transfers`;
- set each seller's membership to `valid_to=date, status='archived',
  end_reason=kind`;
- insert the buyers' memberships with `valid_from=date`;
- audit `membership.transfer`.

The date may be in the past (kataster lag) but not in the future (Decision).

Backdating warnings, shown on the impact screen and non-blocking:
- ballots the seller cast after `date`;
- ballots the buyer could not cast because they were not yet registered;
- assessments already published to the seller for months after `date`. These are
  not re-issued automatically (accounting snapshot rule); the treasurer gets a
  "Čo treba teraz" item.

### 4. Remove owner from a community

Owner detail → ActionMenu → "Odobrať z domu". This ends all of the user's
memberships whose entity sits in the current root's subtree (`end_reason='removed'`).
- If `listUserRoots(user)` still returns another root afterwards, the account stays
  active and only this community's data disappears from their view.
- If not, the service sets `users.isActive=false` (login blocked, `src/lib/auth.ts:59`).
  It also revokes push subscriptions, OAuth tokens and pending MCP actions, which
  are credentials, not history.
- Kept: memberships (ended), ballots, mandates, RSVPs, board_members rows (ended via
  existing `isActive`), accounting, documents and posts.
- Undo: "Obnoviť" re-opens the memberships ended by that action, identified by
  the audit row, as long as no newer membership on the same unit has started since.
  Otherwise it returns `restore_conflict`.

### 5. Merge two accounts

Owner detail → "Zlúčiť s…". Pick the duplicate (suggested via existing
`name-match.ts` + same email or phone). Pick the **survivor**; the default is the
account with a password, then the one with the most recent login. The impact
screen follows.

`mergeUsers(fromId, intoId, actorId)` in `src/lib/user-merge.server.ts` replaces the
hand-written list in `shell-merge.ts` with a **user-FK registry**
(`src/lib/db/user-fk-registry.ts`). Every FK to `users.id` gets exactly one
strategy: `repoint`, `repoint-dedupe(<unique cols>, <winner rule>)`, `keep-on-tombstone`
or `drop` (credentials only). A test compares the registry against
`information_schema` FK metadata (read-only), so a new FK added without a strategy
fails CI. `mergeShellIntoUser` becomes a thin wrapper.

The loser is **not deleted**. It becomes a tombstone: `mergedIntoUserId`, PII
cleared (email, phone, password, passkeys), `isActive=false`. A `user_merges` row
records the alias. Ids frozen in jsonb (`ownerUserIds`) and in hashes resolve
through the alias.

Conflict rules (each is a named code so the impact screen can show it):

| Surface | Conflict | Rule |
|---|---|---|
| `memberships` | both current on same unit | Survivor keeps its row. The loser's is ended with `end_reason='merged'`. If the unit's share sum ≠ 1/1 afterwards, show the existing share warning; it does not block. |
| `memberships` | ended rows | Move as-is. Periods may overlap (it was the same person). |
| `ballots` (`voting, unit, owner` unique) | none | Repoint `owner_id`. Set `hashOwnerId = fromId` so `itemAuditHash` and the audit bundle (BYT-20260518-001) still verify. |
| `ballots` | both accounts voted for the **same unit in the same voting** | **Open voting → merge blocked** (`merge_conflict_open_ballot`). The board resolves it with the existing dispute action first. **Closed voting →** both ballots stay; the newer-confirmed one moves to the survivor, the other stays on the tombstone with `disputed=true`, `disputeNote='merged_duplicate'`. Recorded results are **not** recomputed (frozen shares). The case is listed on the impact screen and in the voting's audit trail. (Decision.) |
| `ballots` | voted for **different** units in the same voting | Repoint both. This is legitimate: one person owning two units. |
| `mandates` | survivor becomes both `from` and `to` (self-mandate) | Open voting → mark `isActive=false`. Closed → keep and flag. Code `merge_self_mandate`. |
| `event_rsvps` (post, user unique) | both RSVP'd | Keep the more recent answer. The other moves to the tombstone. |
| `voting_attendance` (kiosk, voting+owner unique, once built) | both checked in | Keep the earliest `checkedInAt`. The other stays on the tombstone, flagged. |
| `board_members` | same entity + role | Keep the survivor's row and end the loser's. |
| `notification_preferences`, `directory_entries` (unique user) | both exist | Survivor's row wins; the loser's is dropped (settings, not history). |
| `consent_records` | n/a | Move all rows. Append-only; both histories are kept. |
| `webauthn_credentials`, `push_subscriptions` | n/a | Move (same person's devices). |
| `oauth_tokens`, `oauth_authorization_codes`, `mcp_pending_actions`, `email_verifications` | n/a | Drop (credentials; the user re-authorises). |
| `mod_accounting_*` authorship columns | n/a | Repoint. |
| `allocationBasisSnapshot.ownerUserIds` (jsonb) | n/a | Not rewritten (snapshot is immutable). Readers resolve through `user_merges`. |

The whole merge runs in one transaction. On any conflict code in the "block"
class the transaction rolls back and returns the code list.

Undo: none automatic. Un-merging cannot be done cleanly once both histories are
interleaved. The impact screen says this in plain words, and the tombstone plus
`user_merges.impactJson` are kept for manual repair. (Decision: acceptable?)

### 6. Impact summary screen (shared component)

`ImpactSummaryDialog` is built on the UI-kit `Modal`/`ConfirmDialog`
(BYT-20261117-002 Phase 2). It is fed by a read-only `planX()` service that the
mutating service also uses, so preview and execution cannot drift. Layout:
- one plain-Slovak sentence of what happens ("Ján Novák prestane byť vlastníkom
  bytu 12 od 1. 3. 2026");
- groups **Archivuje sa** / **Presunie sa** / **Zostáva** / **Zmaže sa**, each line
  with a count ("3 hlasovania, 14 platieb, 2 odpočty meračov");
- **Treba vyriešiť** (block codes) with links;
- warnings (backdating, share sum);
- confirm with the action verb ("Zlúčiť účty"), disabled while blockers exist.
  Hard delete and anonymise also require typing the owner's name.

Counts come from one aggregate query per strategy group, executed when the dialog
opens. There is no polling and no live updates.

### 7. Hard delete

`DELETE /api/users/[id]` runs `planHardDelete()` over the registry. Any row in a
`repoint`/`keep` class means the response is 409 `user_has_history` with counts,
and the UI offers "Odobrať z domu" or "Anonymizovať" instead. This replaces the
current 5-table pre-check and removes the 500 path. Allowed only for mistakes: no
ballots, no accounting, no consent, no authored content.

### 8. Retention vs erasure (legal rule)

Proposed rule, which needs legal sign-off (see the memory rule *statutory docs need
legal-copy sign-off*):
- **Contact and convenience data** (email, phone, passkeys, push, directory entry,
  notification preferences, RSVP answers to non-statutory events) is erased on
  request: the "Anonymizovať" action plus GDPR Art. 17.
- **Statutory records are retained under Art. 17(3)(b) and (e)** (legal obligation,
  legal claims):
  - ownership periods;
  - ballots with name and unit, mandates, attendance (SK §14/§14a zák. 182/1993 Z.z.,
    CZ §1206 NOZ: minutes and ballot evidence);
  - accounting records and the owner's attribution (SK zák. 431/2002 Z.z. §35,
    CZ zák. 563/1991 Sb. §31, retention horizons to be confirmed by counsel);
  - consent history via `subjectRef` (BYT-20260609-006).
- During retention the person's name on these records is visible only to the board
  and in the statutory outputs (minutes PDF, audit bundle, karta bytu), never in
  owner-facing lists, the directory or the feed.
- After the horizon, a board-triggered "Pseudonymizovať po uplynutí lehoty" action
  replaces the name with "Bývalý vlastník #<6-char ref>". It is manual or
  on-demand, **no background job** (CLAUDE.md, UX spec hard constraint). Hashes
  stay valid because they use ids, not names.
- Country text is not naively parametrised (CLAUDE.md legally-regulated rule): the
  SK and CZ notices for the anonymise dialog live in separate template modules.

### 9. Placement in the new IA (BYT-20261117-002)

- **Vlastníci** table: new filter chip "Bývalí" next to the status chips. Former
  owners render with chip "Bývalý vlastník" and the period "do 1. 3. 2026". Default
  off.
- **Owner detail** (`/owners/[id]`): new section "Vlastníctvo" with a timeline
  (unit, share, from–to, end reason), and a "História" card with counts and links
  (ballots, payments, readings, documents). The ActionMenu holds "Zmena vlastníka
  bytu", "Odobrať z domu", "Zlúčiť s…", "Anonymizovať" and "Zmazať". Zmazať is
  only enabled when the plan is empty.
- **Unit view** (reached from the unit link in the Vlastníci row, and the unit list
  under Nastavenia): an owners list with a "Zobraziť bývalých vlastníkov" toggle and
  the "Zmena vlastníka" button. A unit-level transfer history list.
- **Domov (board) "Čo treba teraz"**: an item when a transfer left assessments
  issued to the seller after the sale date.
- Senior baseline applies: ≥ 44 px targets, one primary button per screen, explicit
  per-state buttons (no toggles that cycle), no horizontal scroll at 390 px.

## Acceptance Criteria

Ownership periods
- [x] Migration backfills `valid_from = created_at::date` on every membership. The
      invariant `status='archived' ⇔ valid_to IS NOT NULL` holds on the backfilled
      data, and the share-sum invariant check reports it.
- [x] A user can hold a second, later membership on a unit they previously owned
      (partial unique index). Two **current** memberships on the same (user, unit)
      are rejected.
- [x] `PATCH /api/users/[id]` with a unit removed from `flatIds` ends that membership
      (`valid_to=today`, `end_reason='correction'`, audit `membership.end`). The row
      still exists afterwards; test asserts the row count does not drop.
- [x] `PATCH /api/external/v1/users/[id]` no longer deletes memberships and no
      longer resets shares. Test: a 1/2 co-owner updated via external API keeps 1/2.

Transfer
- [x] Transfer of unit 12 from A (1/1) to B (1/1) on date D: A's row has `valid_to=D,
      end_reason='sale'`, B's row has `valid_from=D`, one `ownership_transfers` row,
      one audit row, all in one transaction. A forced failure on B's insert leaves
      A's row untouched.
- [x] A partial transfer (co-owner C sells 1/2 of 1/2+1/2) ends only C's row. The
      wizard blocks confirm until the new shares sum to 1/1.
- [x] A future date is rejected with code `transfer_date_in_future`.
- [x] Backdated D before a ballot the seller cast: the impact screen lists that
      voting by name. The ballot is unchanged.
- [x] "Zobraziť bývalých vlastníkov" on unit 12 shows A with the period. With the
      toggle off, the list shows **exactly** the current owners. Negative test: A is
      absent and the row count equals the current membership count.

History-safe reads
- [x] Closed voting V, co-owner C (1/2) voted, then C sells: `results.ts` output for
      V is byte-identical before and after the sale (regression test for the `?? 1`
      fallback).
- [x] Member-scoped voting closed at T: adding a new member after T does not change
      V's `totalPossibleWeight`.
- [ ] Seller A can still open their own payments and assessments for months before
      D and sees nothing dated after D. Buyer B sees nothing before D. Both are
      403-tested server-side, not just hidden in the UI.
- [x] Ended members cannot cast, give mandates, enter meter readings or post. Each
      is tested against the server action or route.

Remove from community
- [x] Removing owner A from root R ends every membership of A under R's subtree and
      none outside it. If A has an active membership under another root, `isActive`
      stays true; otherwise it becomes false and login is refused.
- [x] After removal, ballots, mandates, payments, readings, documents and posts
      attributed to A are all still present (counts before = after).
- [x] "Obnoviť" re-opens exactly the memberships that action ended. If another
      owner started on one of those units in between, it returns `restore_conflict`
      and re-opens nothing (all or none).

Merge
- [x] The user-FK registry test fails when a new FK to `users.id` exists in the DB
      without a registry strategy.
- [x] Merging X into Y moves every `repoint` row (counts per table asserted against
      the plan). X remains as a tombstone with `mergedIntoUserId=Y`, no email or
      password, and cannot log in. One `user_merges` row is written.
- [x] After merge, the audit-bundle verifier (BYT-20260518-001) still verifies every
      moved ballot (`hashOwnerId` used).
- [x] An open voting where X and Y both cast for the same unit blocks the merge with
      `merge_conflict_open_ballot`, and nothing is changed (transaction rolled back,
      counts asserted).
- [ ] A closed voting with the same conflict: the newer-confirmed ballot is on Y, the
      other on X's tombstone with `disputed=true`. The recorded result of that
      voting is unchanged.
- [x] RSVP, notification preference, directory entry, board member and self-mandate
      conflicts each follow the rule in the table (one test per row).
- [ ] Debtor and owner-payment reads that resolve `ownerUserIds` return Y for
      assessments snapshotted with X.

Impact summary
- [x] Every destructive action (end, transfer, remove, merge, hard delete, anonymise)
      opens `ImpactSummaryDialog` first. No route performs the mutation without a
      `confirm=true` flag and a plan hash matching a fresh plan (`plan_stale`
      otherwise).
- [ ] Counts shown equal the counts actually changed (test compares the plan output
      with the post-mutation diff).
- [x] The dialog lists **only** the groups from the plan. Negative test: no group
      appears with zero items, and nothing outside the plan is mutated.

Hard delete and erasure
- [x] `DELETE /api/users/[id]` on a user with any `repoint` or `keep` row returns
      409 `user_has_history` with counts. It never returns 500. Test covers a user
      whose only history is an accounting `created_by_id`, and one whose only history
      is a `board_members` row.
- [x] Hard delete on a user with no history succeeds and leaves no orphan rows.
- [x] "Anonymizovať" clears email, phone, password, passkeys, push, OAuth tokens,
      directory and preferences. Ballots, memberships, consent history and accounting
      rows remain. The name is still shown in the voting minutes PDF and karta bytu,
      and is absent from the directory, the feed and owner-facing lists.
- [ ] "Pseudonymizovať" replaces the name on the tombstone. Audit-bundle hashes still
      verify.

i18n
- [x] Every new string and every error code (`transfer_date_in_future`,
      `restore_conflict`, `merge_conflict_open_ballot`, `merge_self_mandate`,
      `user_has_history`, `plan_stale`, …) has an entry in `sk.json`, `en.json` and
      `cs.json`. The SK and CZ anonymise notices come from separate template modules.

## Project Context

- Schema: `src/db/schema.ts` (`memberships` :304, `users` :365, `entity_audit_log`
  :343 and enum :162, `consent_records` :789, `board_members` :1120);
  `modules/voting/src/db/schema.ts` (`ballots`, `mandates`, `ballot_item_votes`,
  `pending_ballots`); `modules/accounting/src/db/schema.ts` (`fee_assessments`
  :427 with `allocation_basis_snapshot`, `payments` :534, `meter_readings` :904).
- Current delete/merge code: `src/app/api/users/[id]/route.ts` (PATCH flatIds
  delete, DELETE pre-check), `src/app/api/external/v1/users/[id]/route.ts:98`,
  `src/app/api/admin/memberships/[id]/route.ts`, `src/lib/shell-merge.ts`,
  `src/app/api/admin/shell-users/[id]/merge`.
- Reads to make as-of-safe: `modules/voting/src/results.ts:104-176`,
  `modules/voting/src/participation.ts`, `modules/accounting/src/lib/owner-payments.ts:50`,
  `modules/accounting/src/lib/debtors.ts:94,222`, `modules/accounting/src/lib/vyuctovanie.ts:579`.
- Invariants: `src/lib/share-sum-invariants.server.ts`. Roots: `src/lib/entity-tree.ts`
  (`listUserRoots`), `src/lib/current-entity.ts`. Audit: `src/lib/entity-audit.ts`.
  Name matching: `src/lib/name-match.ts`.
- UI: `src/app/[locale]/(dashboard)/owners/` (page, `[id]`, `actions.ts`),
  `src/components/owners/OwnerDetail.tsx`, `OwnerEditForm.tsx`, `OwnerStatusBadge.tsx`,
  `src/components/settings/FlatsTab.tsx`. UI kit from BYT-20261117-002 Phase 2.
- Domain: `docs/domain/accounting.md` (invariants 44, 45, 48, anti-patterns 69, 70),
  `docs/domain/voting.md` (a vote belongs to a unit; the owner is the caster).
- Migrations: latest `drizzle/0084_*`, meta `drizzle/meta/0084_snapshot.json`.
  Patterns: `0023_backfill_entities.sql`, `0034_kind_to_text_fk.sql`.
- i18n: `messages/{sk,en,cs}.json`, namespace `Owners`.

## Notes

### Decisions to confirm before `in_progress`
- **Retention horizons and erasure basis (legal).** Retaining ballot names, ownership
  periods and accounting attribution under Art. 17(3)(b)/(e), and the exact SK/CZ
  horizons (431/2002 §35, 563/1991 §31, 182/1993 §14a, NOZ §1206). Needs counsel
  sign-off before copy ships (legal-copy gate).
- **Closed-voting duplicate ballots on merge.** The proposal keeps both, flags the
  loser's as `disputed`, and does not recompute. The alternative is to block the
  merge forever for that pair. Which one does a court-proof zápisnica need?
- **Seller's ballot cast after a backdated sale date.** The proposal: warn, keep, do
  not invalidate (the seller was the registered owner at cast time).
  Confirm with T9 voting opinion.
- **Future-dated transfers.** Rejected for now. A pending "from date X" state would
  need a scheduled flip, and a scheduled flip means a background job.
- **Former owner self-service access** to their own past ledger after deactivation
  (login blocked). The proposal: no login. The board exports on request (DSAR). The
  alternative is a read-only login.
- **Merge undo.** None. Is a tombstone plus `impactJson` enough for manual repair?
- **Survivor default** in merge: the account with a password, then the most recent
  login. Or always ask?
- **`hashOwnerId` vs re-hash.** The proposal keeps the original hash input id
  (verifies; leaks a merged-away uuid, which is pseudonymous). Re-hashing would
  break already-exported audit bundles.

### Deferred
- Split-year vyúčtovanie per ownership period (accounting spec, uses `valid_from/to`).
- Kataster LV change watch with "create new owner from change". Competitor Resitech
  has it, and it plugs straight into the transfer wizard.
- Variable symbol (VS) per ownership period on the owner profile. Resitech shows
  ownerships with VS and from–to.
- Internal per-unit note that survives owner change (Resitech).
- Voting ban per owner (Resitech). Unrelated to history, but lands on the same
  owner detail.

## Implementation notes (2026-11-18)

Code: `src/lib/ownership.ts` (types, codes), `src/lib/ownership.server.ts` (as-of reads,
`endMembershipsTx`, transfer, remove/restore, plan hash), `src/lib/user-fk-registry.ts` +
`.server.ts` (registry, one-query counts, information_schema diff), `src/lib/user-merge.server.ts`
(merge, shell-merge core, hard delete, anonymise), `scripts/user-fk-registry-check.ts`
(`pnpm test:user-fk-registry`, static vs latest drizzle snapshot), server actions
`owners/lifecycle-actions.ts`, UI `ImpactSummaryDialog`, `OwnerLifecyclePanel`,
`UnitOwnershipCard`, `TransferDialog`, `anonymize-notice/{sk,cz}`. i18n namespace `OwnerLifecycle`.

- "Ended" = `status='archived'` + `valid_to`; every write/vote path already reads
  `status='active'`, so ended members lose write rights without per-route changes.
- `results.ts`: frozen ballot shares first; legacy fallback + member-scoped total read
  memberships valid on the voting's end date (closed) / today (open).
- Shell merge now runs on the registry (fixes missed accounting/passkey/MCP FKs); a target's
  existing membership ends the shell's as `merged` instead of deleting it.
- Hard delete: ended memberships are history (block); a mistake account's CURRENT memberships
  are destroyed with it (listed under "Zmaže sa").
- Deviations / TODO(decision): closed-voting duplicate ballot — survivor's ballot is kept, the
  loser's flagged `disputed` (swap under the unique key deferred); same for kiosk attendance.
  Anonymise requires no current ownership (remove first). Former-owner self-service ledger
  access not built (board export; TODO). `resolveMergedUserIds` exists but debtor /
  owner-payment readers are not switched yet; buyer-sees-nothing-before-D not enforced
  (karta bytu is unit-scoped). `participation.ts` not switched to as-of. "Pseudonymizovať"
  not built. Legal copy (anonymise notices) needs sign-off. No tests written beyond the
  registry check.
- Backfill SQL handed to the coordinator (valid_from, legacy archived rows, ballot snapshot).
