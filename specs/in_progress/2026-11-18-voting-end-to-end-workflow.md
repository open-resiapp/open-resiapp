---
spec_id: BYT-20261118-002
title: "Written voting as one guided process: announcement → ballots → live quorum → close/reopen → minutes, plus e-vote readiness"
status: in_progress
created: 2026-11-18
updated: 2026-11-18
author: Filip
owner: filipvnencak
last_verified: 2026-11-18
project_type: node
depends_on:
  - BYT-20260609-008   # multi-item votings (implemented) — items, ballots, per-item results
  - BYT-20261117-002   # UX simplification (in progress) — navigation, UI kit, confirmed e-vote
  - BYT-20260508-004   # paper vote requires photo (implemented)
related_handoffs: []
tags: [voting, written-vote, minutes, pdf, paper-ballot, quorum, chairman, legal-signoff, schema-change]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

A volunteer chairman runs a written vote (písomné hlasovanie) a few times a year and has to
remember a statutory sequence: announce it in time, hand out ballot lists, collect paper and
electronic votes, watch whether each question can still pass, close, write minutes, publish.
The app already holds every number needed, but it presents them as loose tools on one page.

Turn the voting detail into **one guided process with five steps** and add the documents the law
asks for around the vote, so the chairman never leaves the app to open Word:

1. **Príprava** — questions, dates, place, officials (overovatelia, zapisovateľ).
2. **Oznámenie** — announcement PDF + printable ballot lists.
3. **Priebeh** — who voted and how, what is missing, quorum per question.
4. **Uzavretie** — close, and reopen with a written reason when a correction is needed.
5. **Zápisnica** — wizard that pre-fills from results and asks only for what is missing.

Plus one card on the chairman's Domov: **"Čo dnes prejde elektronicky"** (e-vote readiness).

### Problem statement

- There is no announcement document. `§ 14a ods. 2` zák. 182/1993 Z.z. requires term, place and
  questions to be announced at least seven days ahead (source: `data/laws/sk/sk-182-1993.json`,
  anchor `p14a-2`). The voting row has no place, no announcement date and no officials.
- There is no ballot list to print. `§ 14a ods. 4` lists what a ballot list must contain and
  requires two verifiers to confirm the signature (`p14a-4`). Chairmen build it by hand.
- The minutes PDF has no place of voting and no names/signature lines of chairperson, recorder
  and verifiers, which `§ 14a ods. 8 písm. a), f)` names as mandatory content (`p14a-8`).
- The UI says a closed voting "cannot be reopened" (`messages/sk.json:612`), while
  `docs/domain/voting.md` says closing is reopenable with a justification note. Meanwhile
  `PATCH /api/votings/[id]` accepts any `status` value with no transition guard, no note and no
  audit record (`modules/voting/src/routes/api/votings/id.ts:70`).
- The chairman cannot tell, before starting a vote, whether enough owners can vote electronically
  for a two-thirds question to pass without collecting paper.

## What already exists (verified 2026-11-18 — spec covers only the gap)

| Area | Exists | Where |
|---|---|---|
| Voting + items, per-item quorum | yes | `modules/voting/src/db/schema.ts:76` (votings), `:143` (items) |
| Ballot per (voting, unit, owner), `voteType` electronic/paper | yes | `schema.ts:174`, enum `:36` |
| Paper ballot photos, ≥1 photo enforced | yes | `schema.ts:246`, `routes/api/ballots/index.ts:251` |
| Paper beats electronic (`§ 14a ods. 7`) | yes, by overwrite | paper replaces the e-ballot row in place `routes/api/ballots/index.ts:287-305`; an e-vote can never overwrite paper (`PAPER_BALLOT_LOCKED`, `cast.server.ts:389`) |
| Last electronic vote wins | yes | `cast.server.ts:413-416` |
| E-voting open from activation | yes | cast checks only `status = active` and `endsAt` (`cast.server.ts:132-137`); `startsAt` is not checked |
| Confirmed e-vote (passkey / e-mail link) | yes (BYT-20261117-002 Phase 6) | `schema.ts:205` `confirmationKind`, `src/db/schema.ts:398` `webauthn_credentials` — **not touched here** |
| Engine: unit resolution, per-item results | yes | `modules/voting/src/engine/index.ts:46`, `:273`, `:477` |
| Results query | yes | `modules/voting/src/results.ts:55` |
| Participation: turnout + not-voted list per (unit, owner) | yes | `modules/voting/src/participation.ts:51` |
| Board console: turnout bar, not-voted list with "Zapísať listinný hlas", photos | yes | `routes/dashboard/id/BoardConsole.tsx:206-316` |
| Per-item "quorum reached" badge, visible to the board during the vote | yes | `src/components/voting/VotingResults.tsx:113-119`, `routes/dashboard/id/page.tsx:245` |
| Minutes PDF (results, ballots, hashes, mandates, confirmation method) | yes | `src/components/voting/VotingMinutesPDF.tsx`, built in `DownloadMinutesButton.tsx:86-198` |
| Per-rollam minimum duration (CZ 15 days) | yes | `modules/voting/src/rules/index.ts:78`, used in `votings.ts:176` |
| New-voting wizard (template → items → how) | yes | `routes/dashboard/new/page.tsx` |
| Running-vote turnout on board Domov | yes | `src/lib/home.server.ts:162-196`, `src/components/home/BoardHome.tsx:127` |
| Single vote counter per voting | yes | `votings.voteCounterId` (`schema.ts:88`) |
| Audit bundle export | spec only | `specs/specs/2026-05-18-voting-audit-bundle-export.md` (BYT-20260518-001) |

**Missing:** announcement PDF, place/announcement date/officials, statutory lead-time check for
SK, ballot-list PDFs, per-question drill-down and channel split, "can it still pass" hint, guarded
close/reopen with audit, minutes wizard and its extra data, e-vote readiness.

## Scope

**In scope**
- Guided five-step shell on the board's voting detail (`/voting/[id]`), under **Hlasovanie** in
  the chairman navigation of BYT-20261117-002. No new top-level destination.
- New data on a voting: place, announcement timestamp, paper-voting start, officials.
- Announcement PDF and ballot-list PDFs (per owner, pre-filled; one blank), **SK HOA template
  only** in this spec (see "Legally regulated content").
- Lead-time validation in the date pickers and on the server.
- Management view for the board: per question → per unit → per owner, with channel and
  completeness; channel split bar; "can still pass" hint.
- Guarded status transitions, reopen with mandatory note, append-only voting event log.
- Minutes wizard and the typed hand-off object for `VotingMinutesPDF`.
- E-vote readiness card on board **Domov** and inside step 3 of **Nové hlasovanie**.

**Out of scope**
- Any change to `modules/voting/src/engine/*`, existing exports of `rules/index.ts`, or
  `results.ts` tallying. They are used read-only (hard constraint of BYT-20261117-002).
- The casting flow and its confirmation (BYT-20261117-002 Phase 6) — not duplicated.
- Meeting (schôdza) votes: attendance list, RSVP, kiosk (BYT-20260609-009). The shell shows
  steps 1, 3, 4, 5 for a meeting vote and hides the paper documents until that spec lands.
- New quorum types (four-fifths, unanimity for SK) — see Decisions.
- E-mailing the announcement, per-owner delivery tracking, storing generated PDFs — Deferred.
- Notarised mandate workflow (BYT-20260609-004) — the wizard only lists existing mandates.

## Approach

### 1. Placement in the new IA

| Screen | Where | Who |
|---|---|---|
| Five-step process | `/voting/[id]`, board view (replaces the loose blocks of `BoardConsole`) | admin, active chairman; vote counter sees step 3 only |
| Announcement download | `/voting/[id]`, owner view, one secondary link "Oznámenie (PDF)" | owner |
| Readiness card | board **Domov**, below "Čo treba teraz"; compact version in **Nové hlasovanie** step 3 | admin, chairman |
| "Zverejniť zápisnicu do {date}" | board **Domov** → "Čo treba teraz" row, computed on page load | admin, chairman |

Senior baseline applies: one primary button per step, tap targets ≥ 44 px, `text-base`, every
icon labelled, no horizontal scroll at 390 px (drill-down tables become stacked cards). Steps are
a labelled list with the current step marked `aria-current="step"`, same pattern as
`routes/dashboard/new/page.tsx:323`. A step is never locked for reading; only its primary action
is disabled, with the reason written next to it.

### 2. Schema sketch (additive; `drizzle-kit generate`, migration applied by Filip)

```ts
// modules/voting/src/db/schema.ts

// mod_voting_votings — new nullable columns
place:          varchar("place", { length: 500 }),        // where ballot lists are signed / handed in
announcedAt:    timestamp("announced_at"),                // set once, on first activation
paperStartsAt:  timestamp("paper_starts_at"),             // first day of paper voting; e-voting opens at announcedAt

export const votingOfficialRoleEnum = pgEnum("mod_voting_official_role",
  ["chair", "recorder", "verifier"]);

export const votingOfficials = pgTable("mod_voting_voting_officials", {
  id:        uuid("id").primaryKey().defaultRandom(),
  votingId:  uuid("voting_id").references(() => votings.id, { onDelete: "cascade" }).notNull(),
  role:      votingOfficialRoleEnum("role").notNull(),
  userId:    uuid("user_id").references(() => users.id, { onDelete: "set null" }), // soft link
  name:      varchar("name", { length: 255 }).notNull(),  // snapshot printed on documents
  refusedToSign:    boolean("refused_to_sign").notNull().default(false),
  refusalStatement: text("refusal_statement"),            // § 14a ods. 8 — attached statement
  idx:       integer("idx").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ votingIdx: index("mod_voting_voting_officials_voting_idx").on(t.votingId) }));

export const votingEventKindEnum = pgEnum("mod_voting_event_kind", [
  "announced", "closed", "reopened", "ballot_superseded",
  "document_generated", "minutes_finalised", "result_published",
]);

// Append-only. No UPDATE / DELETE path in code.
export const votingEvents = pgTable("mod_voting_voting_events", {
  id:        uuid("id").primaryKey().defaultRandom(),
  votingId:  uuid("voting_id").references(() => votings.id, { onDelete: "restrict" }).notNull(),
  kind:      votingEventKindEnum("kind").notNull(),
  actorId:   uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  note:      text("note"),                                // mandatory for `reopened`
  payload:   jsonb("payload"),                            // { doc, version, contentHash } | { ballotHash, unitId, ownerId } …
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ votingCreatedIdx: index("mod_voting_voting_events_voting_created_idx").on(t.votingId, t.createdAt) }));
```

DB impact: 3 nullable columns on `mod_voting_votings` (brief `ALTER TABLE ADD COLUMN`, no
backfill, no rewrite), 2 new module tables, 2 new enums. All in a migration file; nothing at
runtime, no background job, no cron route. Existing `votings.voteCounterId` stays — it is a
*permission* (who may record paper votes), while `voting_officials` is *document content*.

Query functions live in `modules/voting/src/` (`officials.ts`, `events.ts`, `transitions.ts`),
not inline in routes.

### 3. Dates and the statutory lead time

Law as stored in the app's own law library (`data/laws/sk/sk-182-1993.json`):
- `p14a-2`: term, place and questions of a written vote "musia byť … oznámené najneskôr sedem
  dní vopred"; the announcement is delivered on paper to every owner unless the community
  contract sets another way.
- `p14a-5-b`: electronic votes are accepted "odo dňa uverejnenia oznámenia … najneskôr do konca
  termínu určeného na písomné hlasovanie".

Model: **activation = announcement**. On first `draft → active`, `announcedAt = now()` and an
`announced` event is written. E-voting is open from that moment (already how casting behaves).
`paperStartsAt` is the first day ballot lists can be signed; `endsAt` ends both channels.

New pure module `modules/voting/src/workflow/notice.ts` (no DB, no i18n):

```ts
export type NoticeErrorCode =
  | "NOTICE_PLACE_REQUIRED" | "NOTICE_PAPER_START_REQUIRED"
  | "NOTICE_LEAD_TIME_TOO_SHORT" | "NOTICE_PAPER_START_AFTER_END"
  | "NOTICE_VERIFIERS_REQUIRED";
export function minPaperStart(country: Country, announcedAt: Date): Date | null;
export function validateNotice(input: NoticeInput): { code: NoticeErrorCode; details?: { minDate: string } } | null;
```

- SK: lead time 7 days → `paperStartsAt ≥ announcedAt + 7 days`. CZ: no value asserted here —
  the existing `perRollamMinDays: 15` check (`rules/index.ts:78`) keeps guarding CZ; the CZ notice
  rule is a legal sign-off item.
- The per-country constant lives in this new file, so `rules/index.ts` stays untouched.
- Date pickers: `min` of the "Začiatok listinného hlasovania" picker is `minPaperStart(...)`
  computed from today (draft) or from `announcedAt` (active); the hint under the field states the
  earliest date in words. The server re-validates on activation and returns the code; the UI
  maps code → `Voting.workflow.errors.*`.
- After `announcedAt` is set, `title`, items, `place`, `paperStartsAt` are read-only.
  `endsAt` may only move later (never earlier) and only while active — see Decisions.

### 4. Documents (client-rendered with `@react-pdf/renderer`, same as the minutes today)

| Document | Component (new) | Content |
|---|---|---|
| Oznámenie o písomnom hlasovaní | `src/components/voting/VotingNoticePDF.tsx` | community name/address/IČO, who announces, questions numbered with full text, term (from–to), place, how to vote electronically, verifiers, date of announcement |
| Hlasovacia listina — per owner | `src/components/voting/VotingBallotPDF.tsx` | elements of `p14a-4`: full text, numbered questions, term, owner name, unit(s) and ownership share, ZA / PROTI / ZDRŽAL SA boxes per question, date + signature line, two verifier signature lines |
| Hlasovacia listina — blank | same component, `owner = null` | empty name/unit/share lines |

- "All ballot lists" = one PDF, one owner per page (owner with several units: one page listing
  all of them). Source: a new `listEligibleVoters(votingId)` exported from
  `modules/voting/src/participation.ts`, extracted from the query already at `:69-95` (same scope
  rules; behaviour of `getVotingParticipation` unchanged).
- Each generation writes a `document_generated` event `{ doc, version, contentHash }` where
  `contentHash` = SHA-256 of the canonical JSON input of the document (no server secret, per
  `docs/domain/voting.md`). `version` = number of `closed` events + 1.
- Documents are regenerated from data, not stored. Because the inputs are frozen at
  announcement, a later download yields the same content.
- All copy through next-intl (`Voting.notice.*`, `Voting.ballotSheet.*`) in `sk`, `en`, `cs`.
  Dates formatted with the community time zone (`timeZoneForCountry`, as in
  `DownloadMinutesButton.tsx:151`).

#### Legally regulated content

`VotingNoticePDF`, `VotingBallotPDF` and the minutes cite and implement `§ 14a` zák. 182/1993
Z.z. They are **not** parametrized across templates or countries:
- Offered only when the community root is the SK HOA template (country `sk`). For CZ and for
  non-HOA kinds (garden, garage, urbár …) step 2 shows "Dokumenty pre tento typ spoločenstva
  zatiaľ nie sú dostupné" and the process continues without them.
- A CZ variant is a separate content module after CZ legal sign-off (Decisions).

### 5. Step 3 — management view (read-only use of the engine)

Data: the existing `GET /api/ballots?votingId=` response (ballots with per-item choices, results
with unit breakdowns, participation). **One fetch per page load**, a visible "Obnoviť" button with
"Stav k {time}", no polling, no websocket. Refetch only after the user's own action (paper vote
recorded, ballot deleted). If the response lacks the full eligible list, add it to the same
response rather than a second request.

New pure module `modules/voting/src/workflow/overview.ts`:

```ts
export type UnitItemStatus =
  | "resolved_for" | "resolved_against" | "resolved_abstain"
  | "incomplete"        // some co-owner share uncast → no majority inside the unit yet
  | "no_valid_vote";    // no ballot, or paper ballot left this question unmarked
export type Channel = "electronic" | "paper" | "mixed" | "none";
export function buildOverview(input: OverviewInput): VotingOverview; // per item → units → owners
export function splitByChannel(input: OverviewInput): ChannelSplit[]; // per item, raw share-weight
export function canStillPass(input: OverviewInput): Record<itemId, "passed" | "reachable" | "unreachable">;
```

- Per question: result bar, quorum badge (existing `quorumReached`), and a second line from
  `canStillPass`: **Dosiahnuté** / **Zatiaľ nie — ešte môže prejsť** / **Už nemôže prejsť**.
  `canStillPass` does not re-implement thresholds: it calls `calculateItemResults` on a
  hypothetical ballot set (all outstanding shares vote ZA) and reads `passed`.
- Drill: question → list of units with status chip and channel → owners of the unit with share,
  choice, channel, time. Filter chips: Všetky · Nehlasovali · Neúplné · Listinné · Elektronické.
- Channel split bar per question: cast share-weight by channel, captioned as turnout by channel.
  The binding tally remains the engine result above it.
- "Zapísať listinný hlas" from any row reuses `PaperVoteModal` with the preset (existing
  `BoardConsole.tsx:251-259`); the modal additionally shows the owner's share.
- When a paper ballot replaces an electronic one, the route writes a `ballot_superseded` event
  with the replaced `ballotHash` (no choices) before the overwrite, so the audit trail shows that
  `p14a-7` was applied. The overwrite logic itself is unchanged.
- Voter names are board-only; the owner view and MCP tool contracts are untouched.

### 6. Step 4 — close, reopen, close again

New `modules/voting/src/transitions.ts`:

```ts
export type TransitionErrorCode =
  | "TRANSITION_NOT_ALLOWED" | "REOPEN_NOTE_REQUIRED" | "NOTICE_INCOMPLETE" | "FORBIDDEN";
export async function transitionVoting(principal, votingId, action: "announce" | "close" | "reopen", opts: { note?: string });
```

- Allowed: `draft → active` (announce), `active → closed` (close), `closed → active` (reopen).
  Everything else → `TRANSITION_NOT_ALLOWED`. The status update is a single guarded statement
  (`UPDATE … WHERE id = ? AND status = <expected>`) plus the event insert in one short
  transaction — two replicas or two tabs cannot both succeed.
- `PATCH /api/votings/[id]` stops accepting a raw `status`; it delegates to `transitionVoting`.
- Reopen requires a note of at least 10 characters (invariant in `docs/domain/voting.md`); the
  note is stored on the `reopened` event and shown in the step-4 history list.
- Reopen is a **correction mode**: the board can record, replace or delete paper ballots and fix
  photos. Owners can vote electronically only if `endsAt` is still in the future (existing
  check). Reopen does not move `endsAt`.
- Side effects that must not repeat: no "Nové hlasovanie" push on reopen (today any
  `status: "active"` triggers it, `id.ts:186`); `onVoteClose` and the accounting pipeline run on
  every close (pipeline is idempotent, `id.ts:159-164`).
- Accounting: if a question that passed before reopening no longer passes after the second
  close, `VotingFinancialImpacts` shows a warning row on the affected draft/entry. Nothing is
  deleted or reversed automatically.
- **Documents after reopen:** announcement and ballot lists are unchanged (inputs frozen).
  Minutes finalised before the reopen are marked superseded in the history ("Zápisnica v1 —
  nahradená"); the download button is hidden while the voting is reopened; after the second close
  the wizard produces version 2, which states the reopen date and reason.
- Copy fix: `Voting.endVotingConfirmText` no longer claims the voting cannot be reopened (all
  three locales).

### 7. Step 5 — minutes wizard

Available when `status = closed`. Four screens, each with one primary button:

1. **Výsledky** — read-only per-question result (engine output), turnout, channel split.
2. **Osoby a miesto** — chairperson, recorder, verifiers (pre-filled from step 1), place and term
   (pre-filled); per verifier "Odmietol podpísať" + statement.
3. **Prílohy a zverejnenie** — checklist of statutory attachments (`p14a-8`): original ballot
   lists, name list of owners who voted electronically (generated), mandates; shows the
   publication deadline `endsAt + 7 days` (`p14a-9`) and lets the chairman record the date of
   publication (`result_published` event; undo = a second event is not needed, the row is
   editable until minutes are finalised).
4. **Zápisnica** — "Stiahnuť zápisnicu (PDF)"; writes `minutes_finalised { version, contentHash }`.

**Data hand-off.** A pure `buildMinutesInput()` in `modules/voting/src/workflow/minutes.ts`
assembles one typed object from: voting, items, results bundle, ballots, mandates, officials,
events. `DownloadMinutesButton` passes it on; the assembly now inside the button (`:119-181`)
moves there unchanged.

**PDF change is gated.** `VotingMinutesPDF` gets one optional prop `protocol?: MinutesProtocol`
(place, officials with signature lines, e-voter name list, reopen statement, publication date).
- Phase A (no sign-off needed): wizard, storage, hand-off object. With `protocol` absent the PDF
  output is identical to today's — verified by comparing the rendered text of a fixture voting
  before/after.
- Phase B (**blocked on legal sign-off**): the new PDF sections and their wording. Not merged
  until the reviewed Slovak text is attached to this spec.

### 8. E-vote readiness

Pure function, no DB, in `modules/voting/src/workflow/readiness.ts`:

```ts
export type ReadinessCode = "REACHABLE" | "NOT_REACHABLE" | "ELECTRONIC_BLOCKED" | "NO_OWNERS";
export interface ReadinessRow { quorumType: QuorumType; code: ReadinessCode;
  readyWeight: number; totalWeight: number; readyOwners: number; totalOwners: number; }
export function computeEVoteReadiness(input: {
  country: Country; votingMethod: CanonicalVotingMethod;
  owners: { unitId: string; ownerId: string; hasEVoteIdentity: boolean; /* shares, area, weight */ }[];
}): ReadinessRow[];
```

- Quorum types evaluated = `getAvailableQuorumTypes(country, "written")`
  (`rules/index.ts:64`). Today that is:
  - **SK**: `simple_all` (nadpolovičná väčšina všetkých, `§ 14b ods. 1`), `two_thirds_all`
    (dvojtretinová väčšina všetkých, `§ 14b ods. 2`).
  - **CZ**: `simple_all`, `two_thirds_all`, `all_unanimous`.
  `simple_present` is offered only for meeting votes and is not shown on the card.
- For each type the function builds the hypothetical "every e-ready owner votes ZA" ballot set
  and asks the engine (`calculateResults`) whether it passes. Unit resolution therefore applies:
  a unit whose e-ready co-owners hold no majority of the unit does not count.
- `hasEVoteIdentity` (proposed): active user, can sign in, and has a verified e-mail
  (`users.emailVerifiedAt`) **or** an activated passkey (`webauthn_credentials.activatedAt`).
- Loader `getEVoteReadiness()` in `modules/voting/src/readiness.server.ts`: read-only SQL
  (memberships ⋈ unit entities ⋈ users, `EXISTS` on passkeys), called once from
  `src/lib/home.server.ts` during the server render of Domov. Not live, not polled, no client
  fetch. Measure with `EXPLAIN ANALYZE` on the largest demo community before shipping.
- Card copy per row from codes: "Nadpolovičná väčšina — elektronicky dosiahnuteľná (38 z 60
  vlastníkov, 64 % podielov)" / "Dvojtretinová väčšina — elektronicky zatiaľ nie; chýba 9 %
  podielov". One link: "Kto ešte nemá prístup" → **Vlastníci** filtered by status.
- When `isElectronicVotingBlocked` would apply (owners-quarter initiated, `rules/index.ts:97`)
  the compact card in Nové hlasovanie shows `ELECTRONIC_BLOCKED` instead of numbers.

## Acceptance Criteria

**Shell and placement**
- [x] Board view of `/voting/[id]` shows the steps Príprava · Oznámenie · Priebeh · Uzavretie ·
      Zápisnica with the current one marked; each step has exactly one primary button.
- [x] No new item appears in the owner or chairman navigation (assert the full nav item list for
      both roles equals the list in BYT-20261117-002, not just that existing items are present).
- [x] Owner view of a written vote shows exactly one new element — the announcement PDF link —
      and nothing else from this spec (assert absence of officials, drill-down, history, readiness).
- [ ] A vote counter (not chairman/admin) sees step 3 and can record paper votes; steps 1, 2, 4, 5
      actions are not rendered for them and the corresponding endpoints return `FORBIDDEN`.
      (2026-11-18 review: server side now grants paper / participation / door-list rights only to
      board or `votings.voteCounterId` of THAT voting — `counter-authz.server.ts`; the page still
      uses the global `recordPaperVote` role → UI part open.)
- [ ] At 390 px no step scrolls horizontally; all new controls are ≥ 44 px high.

**Preparation and announcement**
- [ ] Place, paper start and at least two verifiers and one recorder can be entered, edited and
      removed while the voting is a draft (create / update / delete all covered).
      (Not true as written: `paperStartsAt` does not exist — see Deviation; place + officials only.)
- [ ] Activating an SK written vote without place → `NOTICE_PLACE_REQUIRED`; with fewer than two
      verifiers → `NOTICE_VERIFIERS_REQUIRED`; with `paperStartsAt` earlier than 7 days after
      activation → `NOTICE_LEAD_TIME_TOO_SHORT` carrying `minDate`. Each code renders a translated
      message in sk, en, cs; no raw code or English prose reaches the UI.
- [ ] The paper-start date picker cannot select a date earlier than the minimum and states the
      earliest allowed date in text. (No `paperStartsAt`; the rule applies to `startsAt`.)
- [x] First activation sets `announcedAt` once; a later reopen/activate does not change it.
- [ ] An electronic ballot is accepted immediately after activation, before `paperStartsAt`.
      (No `paperStartsAt`; e-votes are accepted from the announcement, cast path ignores `startsAt`.)
- [ ] After activation, title, items, place and `paperStartsAt` are rejected by the API when
      changed. (True for title / items / place / `startsAt`; `paperStartsAt` does not exist.)
- [x] CZ behaviour is unchanged: the existing 15-day minimum still applies and no SK lead-time
      error is produced for a CZ community. (2026-11-18 review: the minimum is now also re-checked
      on announce — a draft PATCH of `endsAt` no longer bypasses it → `PER_ROLLAM_TOO_SHORT` + `minDate`.)

**Documents**
- [x] Announcement PDF contains community identification, numbered questions with full text,
      term, place, verifiers and announcement date; downloadable by board and by owners in scope.
- [x] "Všetky hlasovacie listiny" produces one page per eligible owner with name, unit(s) and
      ownership share; the page count equals the number of eligible owners (not more, not fewer).
- [x] The blank ballot list contains no owner, unit or share data.
- [ ] For a CZ community and for a non-HOA kind, step 2 offers no SK document and shows the
      "not available" state (negative test per template).
- [x] Each download writes one `document_generated` event; downloading twice with unchanged data
      yields the same `contentHash`.
- [x] All document strings exist in `sk.json`, `en.json`, `cs.json`.

**Management view**
- [x] For a fixture with a 50/50 co-owned unit where one co-owner voted, the unit shows
      `incomplete` for every question; when both vote differently it shows `resolved_abstain`.
- [x] A paper ballot with one question unmarked shows `no_valid_vote` for that question only.
- [x] Drill-down question → unit → owner shows share, choice, channel and time for each owner.
- [x] `canStillPass` equals the engine: for every fixture, `"passed"` ⇔ engine `passed`, and
      `"unreachable"` ⇔ engine `passed = false` when all outstanding shares vote ZA.
- [x] Sum of electronic + paper weight in the channel split equals the cast weight of that
      question.
- [x] Recording a paper ballot for an owner with an electronic ballot writes one
      `ballot_superseded` event and the final tally equals today's behaviour.
- [x] Opening step 3 fires one ballots request; no request repeats without a user action
      (assert no timers / intervals in the page).
- [ ] `modules/voting/src/engine/*` and `results.ts` have no diff; existing golden results are
      unchanged.

**Close / reopen**
- [x] `closed → active` without a note, or with a note under 10 characters →
      `REOPEN_NOTE_REQUIRED`; with a note it succeeds and the note appears in the history.
- [x] `draft → closed`, `closed → draft`, `active → draft` → `TRANSITION_NOT_ALLOWED`.
- [x] Two simultaneous close requests: exactly one `closed` event is written.
- [x] Reopen sends no "new voting" push notification.
- [x] After reopen with `endsAt` in the past, an owner's electronic vote is still rejected; the
      board can record a paper ballot.
- [ ] Close → reopen → close creates no duplicate accounting draft; a question that flipped from
      passed to not passed shows a warning on its financial impact row.
      (2026-11-18 review: no duplicate — pipeline idempotent per item; server flag
      `notPassedAnymore` on `/api/accounting/voting-impacts`; warning row in
      `VotingFinancialImpacts` not rendered yet → open.)
- [ ] Minutes finalised before a reopen are listed as superseded and cannot be downloaded as
      current; after the second close the wizard issues version 2.
      (2026-11-18 review, server side done: `minutesHistory()` → `minutes[].superseded` in the board
      GET, `reopened` event payload `supersededMinutes`, `document_generated` for minutes refused
      with `MINUTES_NOT_AVAILABLE` unless closed, minutes version = n-th close. History list / hidden
      download button in the UI → open.)
- [x] `mod_voting_voting_events` has no update or delete code path (grep-level check).
- [x] The close confirmation text no longer says the voting cannot be reopened, in all locales.

**Minutes wizard**
- [ ] Wizard opens only for a closed voting and pre-fills officials, place and term from step 1.
- [x] Phase A: with no `protocol` prop the rendered minutes text of the fixture voting is
      identical to the output before this change.
- [x] Phase B is not merged without a recorded legal sign-off (reviewer, date, approved wording
      attached to this spec).
- [x] Publication deadline shown = end of voting + 7 days; while the result is unpublished after
      close, board Domov shows one row for it, computed at render (no cron, no stored reminder).

**Readiness**
- [x] `computeEVoteReadiness` returns exactly the quorum types of
      `getAvailableQuorumTypes(country, "written")` — SK: 2 rows, CZ: 3 rows, never
      `simple_present` (assert full set and count).
- [x] A unit with two 50/50 co-owners of whom one is e-ready adds nothing to the reachable weight.
- [x] Function output contains codes and numbers only; all text comes from `messages/*`.
- [x] The card is rendered from server data of the Domov request; no client fetch, no polling.
- [x] Owners never see the card.

## Project Context

- Schema: `modules/voting/src/db/schema.ts` (votings `:76`, items `:143`, ballots `:174`,
  photos `:246`); core `src/db/schema.ts` (`webauthn_credentials` `:398`, users `email_verified_at`).
- Engine / rules (read-only): `modules/voting/src/engine/index.ts`, `modules/voting/src/rules/index.ts`.
- Queries: `modules/voting/src/results.ts`, `participation.ts`, `votings.ts`.
- Routes: `modules/voting/src/routes/api/votings/id.ts` (PATCH status), `routes/api/ballots/index.ts`
  (paper path), `routes/api/ballots/cast.server.ts`.
- UI: `modules/voting/src/routes/dashboard/id/{page,BoardConsole,OwnerBallot}.tsx`,
  `routes/dashboard/new/page.tsx`, `src/components/voting/{VotingMinutesPDF,DownloadMinutesButton,VotingResults,PaperVoteModal}.tsx`.
- Home: `src/lib/home.server.ts`, `src/components/home/BoardHome.tsx`.
- Law source: `data/laws/sk/sk-182-1993.json` (`p14a`, `p14b`), topics `src/lib/laws-topics.ts:41-47`.
- Domain: `docs/domain/voting.md`; older audit `docs/VOTING_LEGAL_AUDIT.md`.
- New files: `modules/voting/src/workflow/{notice,overview,readiness,minutes}.ts`,
  `modules/voting/src/{transitions,officials,events,readiness.server}.ts`,
  `src/components/voting/{VotingNoticePDF,VotingBallotPDF}.tsx`.
- Rules that bind: i18n in sk/en/cs; engines return codes; every FK has `onDelete`; no runtime
  DDL; no per-node loops; legally regulated PDFs not parametrized across templates.

## Notes

### Decisions to confirm

**Legal sign-off (block the marked parts)**
1. **Counting the seven days** (`§ 14a ods. 2`): from publication or from delivery to the last
   owner? Calendar days, and is day 0 counted? The spec assumes `paperStartsAt ≥ announcedAt + 7
   calendar days`.
2. **E-voting during the lead time**: the spec reads `§ 14a ods. 5 písm. b)` as "e-votes are
   accepted from the announcement day", i.e. earlier than paper. Confirm.
3. **Wording of the announcement and ballot list** (blocks shipping the two PDFs), including
   whether one sheet per owner satisfies "hlasovacia listina alebo viaceré listiny" and whether an
   owner with several units signs once.
4. **Minutes Phase B wording**: officials block, e-voter name list, reopen statement.
5. **Reopen**: is correcting a closed written vote defensible at all, and may `endsAt` ever be
   extended after announcement? Spec: correction only, no extension.
6. **Unmarked question on a paper ballot** — label it "neplatný hlas" per `§ 14a ods. 4`? The
   domain doc says an unmarked item "resolves by the jurisdiction's silence rule".
7. **Paper + electronic by the same owner**: statute (`§ 14a ods. 7`) says the electronic vote is
   disregarded; code already does this (competitor Resitech does the same). Open point is only
   whether the replaced e-ballot must stay in the record beyond a `ballot_superseded` event.
8. **CZ**: notice rule and document wording for rozhodování mimo zasedání (`§ 1211–1214` zák.
   89/2012 Sb.) — needed before a CZ document module.
9. **"Usable e-vote identity"**: is a verified e-mail enough under `§ 14a ods. 6` (owner must
   notify their electronic address), or is an explicit consent to e-voting needed?

**Product**
10. Missing majority types: SK offers no `all_unanimous` although `§ 14b ods. 3` needs consent of
    all owners, and there is no four-fifths type for repeated votes (`§ 14b ods. 6`); written
    votes also exclude `simple_present` although `§ 14b ods. 4` mentions owners who "took part in
    the written vote". Competitor Resitech lists these in its readiness view. Engine/rules change
    → separate spec?
11. Voting event log as a new module table (proposed) vs. new values in core
    `entity_audit_action` (the notarised-mandate spec BYT-20260609-004 plans the latter).
12. Keep `votings.voteCounterId` as permission next to the officials table, or derive the
    permission from an official with `role = verifier` and a linked user?
13. Should the lead-time constant live in `workflow/notice.ts` (proposed, keeps `rules/` frozen)
    or move into `CountryVotingRules` once BYT-20261117-002 ships?
14. Channel split bar shows raw cast share-weight by channel, not the unit-resolved result. OK,
    or drop the bar to avoid two different numbers on one screen?
15. Generating ~200 ballot pages in the browser — acceptable, or render on the server?

**Found while verifying (not fixed here unless confirmed)**
- `PATCH /api/votings/[id]` accepts any status value (`id.ts:70`) — fixed by section 6.
- FKs without `onDelete`: `votings.createdById`, `votings.voteCounterId`, all four user/voting
  FKs on `mod_voting_mandates` (`schema.ts:83-123`).
- `VotingMinutesPDF` and `DownloadMinutesButton` carry hardcoded Slovak labels and `sk-SK`
  formatting (`VotingMinutesPDF.tsx:553-571`, `DownloadMinutesButton.tsx:105`).

### Deferred
- E-mail delivery of the announcement and reminders. When added: one
  `mod_voting_notifications_sent` table with a `kind` enum for dedupe, sent from a cron route
  under `src/app/api/cron/` that claims rows with a guarded `UPDATE … RETURNING` so replicas do
  not double-send.
- Per-owner delivery record of the paper announcement (handed over / mailbox / registered post).
- Storing finalised PDFs in Dokumenty and attaching them to the audit bundle (BYT-20260518-001).
- QR code on the ballot list that pre-selects owner and unit in `PaperVoteModal`.
- Meeting votes: invitation, attendance list, kiosk (BYT-20260609-009).
- Posting the result as an Oznam in one click after the minutes are finalised.

## Implementation notes (2026-11-18)

Implemented together with the 2026-11-18 legal fixes (brief overrides the
"engine / rules / results.ts read-only" constraint of this spec):

- **Legal fixes:** ballots freeze `owner_unit_share_*` + `membership_weight`
  at cast time (results use them, legacy rows fall back to the current
  membership); `PATCH /api/votings/[id]` runs the pure state machine
  `workflow/transitions.ts` (draft→active, active→closed, closed→active only
  before `result_published_at` and with a ≥10-char note, `publish`); events in
  `mod_voting_voting_events` (append-only, `events.ts`); SK `simple_present`
  offered for written votes (§14b ods. 4); SK `all_unanimous` (§14b ods. 3);
  new `four_fifths_all` reachable only through the §14b ods. 6 repeat flag
  (`voting_items.repeat_of_quorum_type`, `escalateRepeatedQuorum`); six voting
  FKs got `onDelete`.
- **Deviation:** no `paperStartsAt` column — `startsAt` is the start of the
  written voting term; the lead-time rule (notice D ⇒ start ≥ D+8, civil days
  in the community time zone, DECIDED by Filip) is enforced on activation and
  on create-as-active (`workflow/notice.ts`). E-votes are accepted from the
  announcement (cast path never checked `startsAt`).
- **Deviation:** readiness rows = written-vote types minus `simple_present`;
  with SK unanimity enabled SK now has 3 rows (simple_all, two_thirds_all,
  all_unanimous). The 50/50 rule is a conservative pre-filter (the engine
  alone would let one 1/2 co-owner carry the unit).
- **Not done:** NOTICE_PLACE_REQUIRED / NOTICE_VERIFIERS_REQUIRED are not
  enforced on activation (would block the wizard's "launch now"; TODO
  decision); the vote counter's FORBIDDEN codes; 4-screen minutes wizard
  (only the `buildMinutesInput` hand-off + unrendered `protocol` prop);
  `minutes_finalised` / superseded minutes; financial-impact flip warning;
  CZ documents (legal sign-off).
- Legal sign-off TODOs: notice + ballot sheet wording, minutes Phase B.

### Implementation notes — meeting "present" + board list dedupe (2026-11-18)
- Results of meeting votings use the attendance list as "present" (SK §14b ods. 4 denominator,
  CZ §1206 ods. 2 quorum); written votes unchanged. Details in BYT-20261118-001 notes; golden
  cases in `scripts/voting-golden-check.ts` §5.
- Board view: the separate "Ešte nehlasovali (N)" list with per-unit paper buttons is replaced by a
  one-line jump that preselects the "Nehlasovali" filter of the "Priebeh hlasovania" drill-down
  (single list; paper entry per owner stays there, plus the general "Zapísať listinný hlas").
  Without a drill-down (no overview) only the count line is shown.
- Known gap: `canStillPass` outlook (workflow/overview.ts) still estimates on cast ballots for
  meeting votings; the binding "passed" comes from the engine result.

### Implementation notes — review fixes (2026-11-18)
- **Close snapshot** (`freeze.server.ts`, in the close transaction under the voting row lock):
  `votings.frozen_total_weight` / `frozen_voting_method` / `frozen_at`, per-ballot
  `unit_share_*` / `unit_area_m2` (+ legacy owner share), `mod_voting_eligibility_snapshots`
  (every eligible unit × owner, absent included), attendance `weight` / `unit_label`. Reopen clears
  it, the next close rewrites it. `results.ts`, participation, attendance list / export and the
  overview read the snapshot for closed votings. Migration 0087 backfills closed votings with the
  pre-0086 current-membership logic.
- **Results fallback** for a ballot without owner snapshot: membership valid on the end date, else
  the current active membership, owner role first; no membership join any more (no duplicate vote
  rows for a user with two memberships on one unit).
- **Owner-only voting:** `validateCast` always requires an active OWNER membership (web, paper,
  MCP identical); `ownershipSnapshot` reads owner memberships only; the cast UI lists owner units only.
- **Paper ballot write / board delete** run in one transaction: voting FOR SHARE (status re-checked,
  no deadline for board writes), ballot FOR UPDATE; unique race → `BALLOT_CONFLICT` (409).
- **Vote counter per voting:** board (admin / active chairman) or `votings.voteCounterId`.
- **Publish:** `publishedAt` (default now) must be ≥ `endsAt` → `PUBLISH_BEFORE_END`.
- **canStillPass** uses the ballots' frozen shares, the frozen method / total and the meeting presence
  of the actual result (closes the "known gap" above).
- Engine float threshold compares (`simple_all`, `two_thirds_all`, `four_fifths_all`) left as is —
  engine owned by another session; patch proposed in the review report.

