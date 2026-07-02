---
spec_id: BYT-20260609-008
title: "Multi-item votings (multiple resolutions per voting, one signed ballot)"
status: implemented
created: 2026-06-09
updated: 2026-07-02
author: byt-app
owner: filipvnencak
last_verified: 2026-07-02
project_type: other
depends_on:
  - RES-20260505-001   # voting as a free module (the module being extended)
  - BYT-20260511-001   # per-share vote resolution (applied per item)
  - BYT-20260518-001   # audit bundle (leaf/result schema changes per item)
related_handoffs: []
tags:
  - voting
  - ballot
  - resolutions
  - schema-change
  - paper-vote
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Let one voting hold **multiple items** (agenda points / resolutions — maintenance,
balcony, administration, …, typically 15–20), each voted and **resolved
independently**, while an owner submits **one signed ballot** covering all items at
once and a paper ballot can carry **multiple photos**. This matches how a real
Slovak/Czech owners' assembly (schôdza vlastníkov) actually works: one meeting,
many uznesenia, one signature per owner.

### Problem statement

Today a `voting` models a **single question**: one `quorumType` on the voting, one
`choice` per unit in `votes`, one `paperPhotoUrl`. A real assembly votes 15–20
distinct resolutions in one sitting and the owner signs **once**. Operators have
been working around this by creating one "voting" per resolution, which fragments a
single legal event into many records, breaks the single-signature reality, and
makes the minutes (zápisnica) wrong. The model must represent *one voting → many
items → one signed ballot per owner*.

## Scope

**In scope**
- A voting contains an ordered list of **items** (resolutions); each item carries
  its **own `quorumType`** (a balcony structural change and a routine maintenance
  item need different majorities) and produces its **own result**.
- **One signed ballot per owner-share**: a single confirmation (email / passkey /
  paper signature) commits to **all** item choices at once; no item can be altered
  after signing.
- **Per-item choice** (za / proti / zdržal sa) recorded under the ballot.
- **Unmarked item = silence/abstain** per the jurisdiction's rule (decided): an
  owner may sign with items left unmarked; resolution applies the existing silence
  semantics (SK: not counted; CZ: counts against after the per-rollam window).
- **Multiple photos per paper ballot** (multi-page paper → several photos),
  replacing the single `paperPhotoUrl`.
- A **bulk-set helper** ("set remaining to za / proti / zdržal") plus a
  **review-before-sign** step showing every item's value before the single sign.
- Per-item resolution in the engine (per-share weighting + quorum **per item**).
- Edit/withdraw of a ballot before close (the undo path; CLAUDE.md per-user-mutable
  rule).
- Migration of existing single-question votings into one-item votings with no
  result change.

**Out of scope**
- Cross-item dependencies / conditional items ("vote on item 3 only if item 2
  passes") — each item is independent in v1.
- Weighted ranking / multiple-choice items — each item stays za/proti/zdržal sa.
- Re-opening individual items independently — reopen remains at the voting level
  (with the existing justification-note rule).
- The audit-bundle, passkey, and mandate **spec edits** this implies — listed under
  Cross-spec impact and applied as follow-ups, not in this spec body.

## Approach

### Model

```
voting (the assembly: title, dates, type, counter, entity)
  └── voting_items[]            (resolutions; each has its own quorumType + result)
owner-share submits:
  ballot (one per voting × unit × owner; voteType, confirmation, signature, hash)
    ├── ballot_item_votes[]     (one choice per item)
    └── ballot_photos[]         (≥1 for paper ballots; many allowed)
```

`quorumType` **moves off `votings` onto `voting_items`** — the voting no longer has
a single quorum; each item does. The voting keeps assembly-level metadata
(`title`, `description`, `startsAt`/`endsAt`, `votingType`, `initiatedBy`,
`voteCounterId`, `entityId`, `documentProjectId`).

### One signed ballot

The ballot is the unit of signing. On submit, the owner's choices for all items are
canonicalised (JCS over the sorted `[{itemId, choice}]` list) into a `ballotHash`;
the confirmation (passkey assertion / email click / paper signature) binds that
hash, so the **whole set** of item choices is what was signed. Per-item
`itemAuditHash = sha256(votingId | itemId | entityId | ownerId | choice |
recordedAt)` feeds the audit-bundle leaves (no server secret, per
`docs/domain/voting.md`).

### Unmarked items & bulk set

- Signing is allowed with items unmarked; each unmarked item is resolved by the
  jurisdiction silence rule (reuses the existing rule pack). The review screen
  clearly shows which items are unmarked before signing.
- A **"set remaining to za/proti/zdržal"** helper fills only still-unmarked items;
  choices remain explicit per item (no implicit cycling toggle — CLAUDE.md UI rule),
  and the **review-before-sign** step lists every item's final value. The review
  step doubles as the §14a/3.3.4 "error prevention for legal/financial actions"
  confirmation.

### Schema changes (`mod_voting_*`)

```ts
voting_items {
  id          uuid pk defaultRandom
  votingId    uuid -> votings.id  on delete cascade  notNull
  idx         integer notNull                 // display/ballot order
  title       varchar(500) notNull
  description text
  quorumType  quorumTypeEnum notNull          // MOVED from votings
  createdAt   timestamp defaultNow notNull
  unique (votingId, idx)
}

ballots {                                      // the signed submission per owner-share
  id            uuid pk defaultRandom
  votingId      uuid -> votings.id   on delete restrict  notNull
  entityId      uuid -> entities.id  on delete restrict  notNull   // the unit
  ownerId       uuid -> users.id                          notNull   // share-holder
  voteType      voteTypeEnum notNull default 'electronic'
  recordedById  uuid -> users.id                                    // counter / representative
  mandateId     uuid -> mod_voting_mandates.id  on delete restrict  // BYT-20260609-004
  ballotHash    varchar(64) notNull            // commitment over all item choices
  signature     text                           // passkey assertion (one, over ballotHash)
  recordedAt    timestamp defaultNow notNull
  disputed      boolean notNull default false
  disputeNote   text
  unique (votingId, entityId, ownerId)         // per-share (widens old (votingId, entityId))
}

ballot_item_votes {
  id           uuid pk defaultRandom
  ballotId     uuid -> ballots.id       on delete cascade  notNull
  itemId       uuid -> voting_items.id  on delete restrict notNull
  choice       voteChoiceEnum notNull
  itemAuditHash varchar(64) notNull
  unique (ballotId, itemId)
}

ballot_photos {
  id         uuid pk defaultRandom
  ballotId   uuid -> ballots.id  on delete cascade  notNull
  storageKey varchar(1024) notNull                 // via src/lib/storage.ts
  idx        integer notNull
  createdAt  timestamp defaultNow notNull
}
```

This **supersedes the current `mod_voting_votes`** table (single `choice` +
single `paperPhotoUrl`). A paper ballot must carry ≥1 photo — enforced in the app
layer (cross-table, so not a single-row CHECK); the old per-row
`vote_type != 'paper' OR paper_photo_url IS NOT NULL` check is replaced by
"paper ballot ⇒ ≥1 `ballot_photos` row."

### Migration (hand-written, per CLAUDE.md drizzle rules)

1. Create `voting_items`, `ballots`, `ballot_item_votes`, `ballot_photos`.
2. For each existing voting → one `voting_items` row (`idx=0`, copy
   `title`/`description`, copy the voting's `quorumType`).
3. For each existing `mod_voting_votes` row → one `ballots` row (carry `voteType`,
   `recordedById`, `disputed`, `disputeNote`, recompute `ballotHash`) + one
   `ballot_item_votes` row (the single item, its `choice`) + (if `paperPhotoUrl`)
   one `ballot_photos` row.
4. Drop `quorumType` from `votings` and drop `mod_voting_votes` after backfill is
   verified. Grep `quorumType`/`votes` usages across `modules/voting` + `src` and
   update each in the same PR (the enum/column-rename discipline).

### Engine

Resolution runs **per item**: the existing per-share input model
(BYT-20260511-001) is applied independently for each item, with that item's
`quorumType`. The engine returns an array of per-item results
(`{itemId, za, proti, zdrzalSa, quorumReached, passed}`); the voting itself has no
single pass/fail.

### UI

- **Create/edit voting:** add/reorder items, each with title + `quorumType`.
- **Cast:** all items listed with explicit za/proti/zdržal sa selectors (per CLAUDE.md
  multi-state rule), the bulk-set helper, then a **review screen**, then **one**
  sign action (email/passkey/paper). Paper flow accepts **multiple** photo uploads.
- **Results / minutes:** per-item outcome (each uznesenie + its result + quorum).

## Cross-spec impact (follow-up edits required)

This restructures the vote unit, so three specs need edits (flagged here; applied
as follow-ups):

- **BYT-20260518-001 (audit bundle):** `votes.json` leaves become **per
  (item, unit, owner)** — leaf gains `itemId`; `result.json` becomes an **array of
  per-item results**; merkle leaf count scales with items. The signed ballot's
  `ballotHash` may be added as a ballot-level leaf.
- **RES-20260428-003 (passkey):** the vote-intent challenge changes from
  `votingId|choice|userId|ts` to `votingId|ballotHash|userId|ts` — **one** assertion
  signs the whole ballot; `/vote/verify` writes many `ballot_item_votes` from one
  signature.
- **BYT-20260609-004 (mandate):** the representative casts the **whole ballot** under
  one mandate (mandate is per voting × owner) — link via `ballots.mandateId`.
- **`docs/domain/voting.md`:** "a vote belongs to a unit" → "a **ballot** belongs to
  (voting, unit, owner); each **item-vote** belongs to (ballot, item)"; quorum is
  **per item**; one signature covers all items.
- **VotingMinutesPDF / VotingResults:** render per-item results (interacts with the
  T5 jurisdiction-content refactor, BYT-20260609-007).

## Acceptance Criteria

- [ ] A voting can be created with N ordered items, each with its own `quorumType`;
      `quorumType` no longer exists on `votings`.
- [ ] An owner casts za/proti/zdržal sa per item and signs **once**; the
      confirmation binds a `ballotHash` over **all** item choices.
- [ ] After signing, no single item's choice can be changed without re-submitting
      the whole ballot (immutability of the signed set).
- [ ] An owner may sign with items unmarked; each unmarked item resolves by the
      jurisdiction silence rule (verified for SK and CZ).
- [ ] The bulk-set helper fills only unmarked items and a review screen lists every
      item's final value before signing.
- [ ] A paper ballot accepts **multiple** photos and cannot be recorded with zero
      photos.
- [ ] The engine returns an **independent** result per item (per-share weighting +
      that item's quorum); no voting-level pass/fail.
- [ ] Migration converts every existing voting to a one-item voting and every
      existing vote to a ballot + one item-vote (+ photo) with **byte-identical
      results** (golden-file test).
- [ ] `ballots` is unique per (voting, unit, owner); the old `mod_voting_votes`
      table is dropped after backfill.
- [ ] All new UI strings exist in `sk.json`, `cs.json`, `en.json`.

## Project Context

- **Today:** `votings` (`modules/voting/src/db/schema.ts:59`) holds a single
  `quorumType`; `votes` (`:86`) holds one `choice` + one `paperPhotoUrl`, unique
  `(votingId, entityId)`. `voteChoiceEnum` = `za|proti|zdrzal_sa` (`:23`);
  `quorumTypeEnum` = `simple_present|simple_all|two_thirds_all|all_unanimous`
  (`:50`).
- **Per-share resolution:** BYT-20260511-001 — applied **per item** here; the
  ballot uniqueness `(votingId, entityId, ownerId)` also realises the recording-layer
  widening that BYT-20260518-001 noted was deferred.
- **Photos:** stored via `src/lib/storage.ts` (local/S3), like the document library.
- **Mandate link:** `ballots.mandateId` → BYT-20260609-004 (a representative casts
  the whole ballot).
- **Jurisdiction content:** per-item minutes rendering interacts with
  BYT-20260609-007 (jurisdiction content providers) — keep results per-item there.

## Notes

### Decisions locked (2026-06-09)
- Unmarked item on a signed ballot = silence/abstain per jurisdiction rule.
- Bulk-set helper present, with a mandatory review-before-sign step.
- `quorumType` is **per item**, not per voting.
- One signed ballot per owner-share commits to all item choices via `ballotHash`.

### Open questions
- **Item-level reopen/dispute:** v1 reopens/disputes at the voting or ballot level.
  Whether a single item can be disputed/corrected independently (and what that does
  to the signed `ballotHash`) is deferred.
- **Quorum-type catalog vs T5:** `quorumType` is currently an enum; under T5
  (BYT-20260609-007) majority becomes basis×threshold per jurisdiction. The
  per-item `quorumType` here should ultimately reference the T5 rule-pack's majority
  model — sequence this spec after, or alongside, T5's W1 to avoid a double
  migration.
- **Ballot edit window:** confirm an owner can withdraw/re-submit a ballot before
  close, and that doing so supersedes (not appends) the prior signed ballot.

### Implementation (2026-07-02)

Implemented in 6 phases on `main` (no feature branch — per project convention):

- **Phase 1 — schema + migration.** New tables `voting_items`, `ballots`,
  `ballot_item_votes`, `ballot_photos`. Additive migration `0046_multi_item_ballots.sql`
  (create + 1:1 backfill from the legacy model). Secretless hashes via Postgres core
  `sha256()` (no `pgcrypto`). Legacy tables kept during the dual-model window.
- **Phase 2 — engine + types.** `calculateItemResults()` (per-item, reuses the
  per-share §14 engine), `computeBallotHash()` / `computeItemAuditHash()`. Golden
  check `scripts/voting-golden-check.ts` (`pnpm test:voting-golden`) proves
  byte-identical results for single-item votings + hash parity with the migration.
- **Phase 3 — create/edit.** `POST/PATCH /api/votings` accept `items[]`; create UI
  is an items editor (add/remove/reorder, per-item quorum). Item edits blocked once a
  ballot exists.
- **Phase 4 — cast.** New `/api/ballots` (GET/POST/DELETE). Cast UI: per-item
  selectors + bulk-set-remaining + review-before-sign + single signature; unmarked =
  silence; co-owners each cast their own ballot (per-share); withdraw/resubmit
  supersedes. Paper flow accepts multiple photos.
- **Phase 5 — minutes.** `VotingMinutesPDF` rebuilt per-item (own quorum, result,
  vote list, §14/§1187 co-owner breakdown kept country-keyed) + a signatures section.
- **Phase 6 — cleanup.** All consumers switched off the legacy tables (external API
  backward-compatible, seed, shell-merge, admin/user delete routes); legacy
  `/api/votes` removed; migration `0047_drop_legacy_votes.sql` drops
  `mod_voting_votes` + `votings.quorum_type` (enums retained).

All new UI strings added to `sk` / `en` / `cs`. Verified: `tsc --noEmit` = 0 and golden
checks pass. Not yet exercised end-to-end against a live DB.

### Follow-ups (open)

- **`onVoteCreate` hook dormant** — the ballot path does not dispatch it, so
  vote-triggered module notifications no longer fire. Needs a ballot-level
  notification/email design.
- **External API contract** — `/api/external/v1/votings*` gained an additive `items[]`
  field (top-level `quorumType`/`voteCounts`/`votes` retained for back-compat).
  Communicate to the bytové-družstvo consumer via the open external-API handoff.
- **Audit bundle (BYT-20260518-001)** — build on the secretless leaves laid down here.
- **Passkey (RES-20260428-003)** — sign `ballotHash` into `ballots.signature`.
- **Mandate cast-under-ballot (BYT-20260609-004)** — wire the representative flow via
  the existing `ballots.mandateId` FK.
- **T5 (BYT-20260609-007)** — will migrate `voting_items.quorum_type` (enum) to the
  basis×threshold majority model — the accepted second `quorumType` migration
  (Option B trade-off).

### Runtime verification checklist (before closing out)

- [ ] `pnpm db:migrate` applies 0046 then 0047 (0047 is irreversible — backup applies).
- [ ] End-to-end: create multi-item voting → cast (mark some, bulk-set rest, review,
      sign) → withdraw → re-sign → record a paper ballot with ≥2 photos → close →
      per-item results + minutes PDF.
- [ ] Migration backfill parity check (item/ballot/photo counts) per Phase 1 SQL.
