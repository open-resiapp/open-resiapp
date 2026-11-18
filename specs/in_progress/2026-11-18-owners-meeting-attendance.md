---
spec_id: BYT-20261118-001
title: "Owners' meeting: announcement, planned attendance (RSVP) and attendance list"
status: in_progress
created: 2026-11-18
updated: 2026-11-18
author: Filip
owner: filipvnencak
last_verified: 2026-11-18
project_type: node
depends_on:
  - BYT-20261117-002   # UX simplification — navigation and UI kit this spec is placed in
  - BYT-20260609-008   # multi-item ballot (implemented) — a meeting voting holds the agenda items
related_specs:
  - BYT-20260609-009   # kiosk mode — reuses the attendance table defined here
  - BYT-20260609-004   # notarised mandate — "represented" attendance links a mandate
related_handoffs: []
tags: [voting, meeting, attendance, rsvp, community, email, export, gdpr, schema-change]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Cover the whole life of an owners' meeting (schôdza vlastníkov) around the vote itself:

1. the board **announces** the meeting (date, time, place, agenda),
2. owners say ahead whether they come — **prídem / neprídem / ešte neviem** — in the app or
   straight from the invitation e-mail,
3. the board sees **who is expected** and what share of votes that is,
4. at the door the board records **who actually came** (prezenčná listina): present, represented,
   absent,
5. the owner later sees their own answer and how they were recorded,
6. the attendance numbers are available to the meeting minutes.

Filip's ask: "účasť a neúčasť na schôdzach".

### Problem statement

- A voting can be of type `meeting` (`modules/voting/src/db/schema.ts:49`,
  `modules/voting/src/votings.ts:132`), but nothing tells owners *when and where* the meeting is
  beyond the voting's `startsAt`, and nobody can say "I will come".
- Event posts with RSVP exist (`community_posts.eventDate/eventLocation`, `src/db/schema.ts:988`;
  `event_rsvps`, `:1024`), but they are a social feature: no link to a voting, no ownership share,
  no invitation e-mail, the reminder goes only to people who already said yes
  (`src/app/api/cron/community/route.ts:143-150`).
- There is **no record of who attended**. The engine treats "present" as "cast a ballot"
  (`modules/voting/src/engine/index.ts:119-121`). The board keeps the attendance list on paper and
  retypes numbers into the minutes.
- The kiosk spec (BYT-20260609-009) sketches a `voting_attendance` table, but only as the kiosk's
  identity anchor. It is not built, and it has no notion of absent / represented / export.

## Scope

**In scope**
- Meeting announcement = an **event post linked to a `meeting` voting** (one meeting ↔ one voting ↔
  one post).
- RSVP with three explicit buttons, change and withdraw; board can enter an answer for an owner
  who phoned.
- Invitation e-mail with three one-click answer links (signed, single-purpose, no login) and a
  reminder e-mail the day before.
- Board overview of answers by unit and ownership share, with expected share present.
- Attendance list recorded by the board at the door: present / represented (with mandate) /
  absent (derived), undo while the voting is open.
- **One shared attendance table** that the kiosk spec reuses (reconciliation below).
- Export of the attendance list as PDF (blank sign-in sheet and filled record) and Excel, with
  the options *one row per owner / per unit* and *include non-residential units*.
- Owner view of own RSVP and own recorded attendance.
- A typed attendance summary for the minutes (data only).
- i18n in `sk`, `en`, `cs`; error codes instead of prose.

**Out of scope**
- Any change to `modules/voting/src/engine/*`, `modules/voting/src/rules/*`, `results.ts` or
  `VotingMinutesPDF` content. Attendance is *shown next to* quorum rules, it does not feed the
  result calculation.
- Kiosk UI, PINs, on-glass signature (BYT-20260609-009) — only the table they need is shared.
- The notarised mandate workflow itself (BYT-20260609-004) — this spec only reads a verified
  mandate.
- Meetings without a voting (informational meetings keep using a plain event post, no attendance
  list). See Notes.
- Online / hybrid meetings, video links, live turnout screen.
- Statutory notice-period enforcement and automatic "substitute meeting" (náhradná schôdza)
  scheduling. See Notes.
- Postal / printed invitations for owners without e-mail (the board gets a list of them, nothing
  more).

## Approach

### 1. What a meeting is — decision

**Anchor on the voting, announce through an event post.**

| Option | Verdict |
|---|---|
| Event post only | No link to units, shares, quorum, mandates, minutes. Rejected. |
| New `meetings` table | Third concept beside voting and post; kiosk and mandates are already keyed by `votingId`. Rejected for v1. |
| **`meeting` voting + linked event post** | Reuses `event_rsvps`, the feed, `PostCard`, the community cron and the voting's scope/weights. **Chosen.** |

- The voting (`votingType = "meeting"`) owns the agenda (items), the scope (`entityId`), the vote
  counter (`voteCounterId`, `modules/voting/src/db/schema.ts:88`) and the attendance list.
- The post (`type = "event"`, new `eventKind = "owners_meeting"`) owns what owners read: title,
  text, `eventDate`, `eventLocation`, and the RSVP rows.
- Link: `votings.meetingPostId → community_posts.id` (module → core, same direction as the
  existing `documentProjectId`, `modules/voting/src/db/schema.ts:93`). Core never imports the
  voting module.
- `eventKind` lets core code (cron, RSVP route, feed) treat a meeting post differently without
  knowing about votings. Existing social events keep `eventKind = "social"` and behave as today.
- Only the board can create a meeting post (`createVoting`, `src/lib/permissions.ts:6`); the
  owner-facing "new event" form never offers it.
- Creating: in **Nové hlasovanie** (template → items → how), choosing "na schôdzi" adds the
  fields *Kedy* (date + time), *Kde*, and a checkbox "Oznámiť schôdzu vlastníkom" (default on).
  Post and voting are written in one transaction; `eventDate` = voting `startsAt`.
- Changing date or place after the invitation went out: the post is updated, RSVP rows are kept,
  and the board is offered "Poslať zmenu vlastníkom" (a new `meeting_change` e-mail, deduped per
  change — see §4). Cancelling the meeting marks the post `expired` and sends a cancellation; the
  voting follows the existing status rules (never deleted once active, `docs/domain/voting.md`).

### 2. Planned attendance (RSVP)

Reused as is: `event_rsvps` (unique per post + user), `rsvp_status` yes/no/maybe
(`src/db/schema.ts:120`), `POST`/`DELETE /api/community/posts/[id]/rsvp`
(`src/app/api/community/posts/[id]/rsvp/route.ts`), labels `Community…rsvp.yes/maybe/no`
(`messages/sk.json:1589`).

Gap to build:

- **Buttons:** three separate full-width buttons **Prídem · Neprídem · Ešte neviem** (≥ 44 px,
  icon + text). The selected one is shown as selected, the other two stay available. No cycling
  toggle (CLAUDE.md UI rule). Meeting posts get their own label keys; the social-event labels are
  not reused because "Možno" reads wrong for a statutory meeting.
- **Undo:** a visible "Zrušiť odpoveď" link calls the existing `DELETE` → state back to
  "bez odpovede". Changing is one tap on another button (existing upsert).
- **Who may answer:** active owners (memberships with role owner) in the voting's entity subtree.
  The current route lets every role with `respondToCommunityPost` answer any event, tenants
  included; for `eventKind = "owners_meeting"` the route additionally checks eligibility and
  returns code `MEETING_RSVP_NOT_ELIGIBLE`.
- **Closing:** answers are accepted until `eventDate`; later → `MEETING_RSVP_CLOSED`. The card then
  shows the answer read-only.
- **Board answers for an owner** (owner phoned, has no account): from the board overview, same
  three buttons per owner row. Stored with `source = "board"` and `recordedById`. The owner can
  still change it.
- **Hardcoded Slovak error strings** in the RSVP route (`:18`, `:22`, `:33`, `:37`, `:47`) are
  replaced by codes in the same change (rule: errors are codes, mapped to catalog by the caller).

`event_rsvps` gains two columns: `source` (`app | email_link | board`) and `recordedById`.

### 3. One-click answer from e-mail

- The invitation and the reminder carry three links: Prídem / Neprídem / Ešte neviem.
- Each link holds a token from the existing stateless HMAC helper
  (`signToken` / `verifyToken`, `src/lib/signed-token.server.ts:95`, `:115`) with a **new purpose
  `meeting-rsvp`** and claims `{ postId, userId, status }`. Per-purpose key derivation already
  guarantees it cannot be used as a vote or login token (`:85`). Expiry = `eventDate`.
- The token can do exactly one thing: upsert that user's RSVP on that post to that status. It
  creates no session and shows no other data. Not single-use on purpose — the action is idempotent
  and the owner may click a different link later; latest click wins.
- **Mail scanners prefetch links**, so a plain `GET` must not write. The link opens a public page
  `/[locale]/schodza/odpoved?t=…` (outside the dashboard, no login): the page verifies the token
  server-side, renders meeting name, date, place and the three buttons, and submits the chosen
  status with a `POST` on load (JS) — with a visible "Potvrdiť" button as the no-JS fallback.
  Result state: "Zapísali sme: Prídem" + the other two buttons to change + "Zrušiť odpoveď".
- Token errors are codes: `MEETING_RSVP_TOKEN_INVALID`, `MEETING_RSVP_TOKEN_EXPIRED`,
  `MEETING_RSVP_CLOSED`; the page shows a friendly text and a link to log in.
- No per-node memory, no new table: stateless tokens work on every replica.

### 4. E-mails and cron

Three new functions in `src/lib/email.ts`, all via `getTranslations({ locale, namespace:
"Email" })` with an optional `locale` param (not the legacy hardcoded pattern):
`sendMeetingInvitation`, `sendMeetingReminder`, `sendMeetingChange` (date/place change or
cancellation).

Dedupe uses the existing `community_notifications_sent` table (`src/db/schema.ts:1046`) with new
`kind` values `meeting_invitation`, `meeting_reminder`, `meeting_change` — no new table.

- **Invitation:** sent when the board clicks "Odoslať pozvánku" (route handler, not a background
  loop). Recipients: eligible owners with an e-mail. The response lists owners **without e-mail**
  so the board delivers on paper. Clicking again sends only to owners not yet invited (new owners).
- **Reminder:** inside the existing `runCron()` of `src/app/api/cron/community/route.ts`, for
  posts with `eventKind = "owners_meeting"` and `eventDate` within the next 24 h. Recipients:
  everyone eligible **except those who answered "no"** (yes, maybe and no answer). Text differs by
  state: "Počítame s vami" / "Ešte ste neodpovedali". Meeting posts are **excluded** from the
  existing generic `event_reminder` branch (`:118-181`) so nobody gets two reminders.
- **Change:** one e-mail per recipient per change; the dedupe row is keyed by a `changeSeq`
  stored on the sent row (see schema), so a second change can be sent.

**Multi-replica safety.** The cron is an HTTP route called from outside with `x-cron-secret`
(`:205`) — no per-node loop, keep it that way. But the current dedupe is *select, then insert*
(`:151-170`), which double-sends if two runs overlap. For the new kinds use a claim:
`INSERT … ON CONFLICT DO NOTHING RETURNING id` against a **partial unique index** on
`(post_id, recipient_id, kind, change_seq)` limited to the three meeting kinds; send only when a
row came back. Existing kinds and rows are untouched (the index does not cover them). Same claim
in the invitation route, so a double click or two replicas cannot send twice.

Trade-off kept from the existing pattern: the row is written before the send, so a failed SMTP
call is not retried automatically. The invitation route returns the count of failed sends and the
board overview marks those owners "pozvánka nedoručená".

`CronRunSnapshot` (`src/lib/cron-state.ts`) gains `meetingRemindersSent`.

### 5. Board view — who is expected

Place: **Hlasovanie → detail of the meeting voting** (`modules/voting/src/routes/dashboard/id/
BoardConsole.tsx`), new section "Účasť" with two tabs: *Odpovede* (before) and *Prezenčná listina*
(at/after the meeting). Entry points: the board **Domov** "Čo treba teraz" row "Schôdza 3. 12. —
odpovedalo 18 z 42", and the meeting card in **Oznamy**.

- One read: eligible owners in scope with their units and weights, left-joined with RSVP.
  Eligibility and weights reuse the helpers already used by `getVotingParticipation`
  (`modules/voting/src/participation.ts:51`; `computeMemberWeight`, `computeUnitWeight`,
  `src/lib/voting-method.ts`), so share numbers match the vote results. New query function
  `getMeetingRsvpOverview(votingId)` in the voting module, not inline in the route.
- Summary line: **Prídu 14 · Neprídu 3 · Nevedia 1 · Bez odpovede 24**, each with its share of all
  votes ("Prídu: 38 % hlasov").
- Table (cards at 390 px): unit, owner, share, answer, how answered (app / e-mail / board),
  invitation state. Filter chips by answer. Row action: set answer for the owner (§2).
- **Expected share vs. what the meeting needs:** below the summary, each agenda item with its
  quorum type label and whether the expected share could reach it, e.g. "Bod 2 potrebuje
  nadpolovičnú väčšinu všetkých — prídu vlastníci s 38 % hlasov, nestačí". Read-only: quorum type
  comes from `voting_items.quorumType`, the available set from `getAvailableQuorumTypes`
  (`modules/voting/src/rules/index.ts:66`). The comparison is an **informative estimate**, worded
  as such; it never blocks anything and uses no number that is not already in the rules module.
  `maybe` is shown separately and never counted as half (`docs/domain/community.md:33`, `:83`).
- No polling, no websocket. Data loads once per visit and after the board's own mutations.

### 6. Attendance list (prezenčná listina) — the shared model

**One table, `mod_voting_attendance`, owned by this spec. The kiosk spec reuses it.**

```ts
// modules/voting/src/db/schema.ts
mod_voting_attendance {
  id                  uuid pk defaultRandom
  votingId            uuid -> votings.id   on delete restrict  notNull
  ownerId             uuid -> users.id     on delete restrict  notNull   // the owner the row is about
  status              varchar(16) notNull   // 'present' | 'represented'
  mandateId           uuid -> mandates.id  on delete restrict            // required when represented
  representativeName  varchar(255)                                        // printed on the list
  identifiedById      uuid -> users.id     on delete set null            // board member / counter at the door
  idCheckMethod       varchar(32) notNull   // 'photo_id' | 'known_in_person'
  source              varchar(16) notNull default 'board'   // 'board' | 'kiosk'
  signatureStorageKey varchar(1024)         // kiosk on-glass / scanned sheet; null for door ticking
  signatureSha256     varchar(64)           // kiosk: hashed into the audit bundle
  checkedInAt         timestamp defaultNow notNull
  leftAt              timestamp             // owner left before the end (optional)
  note                varchar(500)
  unique (votingId, ownerId)
}
```

Rules:

- A row exists ⇔ the owner was present or represented. **Absent is derived**: eligible owner with
  no row once the voting is `closed`. Before that the owner is "zatiaľ nezapísaný", not absent.
  No `absent` rows are stored, so there is nothing to forget to clean up.
- One row per owner per voting. An owner with several units is ticked once and all their units
  count. Co-owners are separate owners with separate rows; a unit's share present is the sum of
  the present co-owners' unit shares (`memberships.ownerUnitShare*`, `src/db/schema.ts:322`).
- `represented` requires a mandate for that voting from that owner with
  `paperDocumentConfirmed = true` and `isActive = true` (`mod_voting_mandates`,
  `modules/voting/src/db/schema.ts:102`); otherwise `ATTENDANCE_MANDATE_REQUIRED`. No forgeable
  digital proxy is introduced (`docs/domain/voting.md`, invariants on mandates).
- **Who records:** admin and the voting's vote counter — new permission key
  `manageMeetingAttendance: ["admin", "vote_counter"]` in `src/lib/permissions.ts`.
- **When:** from 2 h before `startsAt` until the voting is `closed`. Outside →
  `ATTENDANCE_NOT_OPEN` / `ATTENDANCE_LOCKED`.
- **Undo:** "Zrušiť zápis" deletes the row while the voting is open and no ballot is bound to it
  (kiosk `ballots.attendanceId`); otherwise `ATTENDANCE_HAS_BALLOT`. "Odišiel" sets `leftAt`
  instead of deleting; "Vrátil sa" clears it. After close the list is immutable.
- Double tick from two devices → unique index → `ATTENDANCE_ALREADY_RECORDED`, the UI refreshes
  the row. No live channel needed.
- Query functions (`recordAttendance`, `removeAttendance`, `setLeft`, `getAttendanceList`,
  `getMeetingAttendanceSummary`) live in a new `modules/voting/src/attendance.ts`; pure checks
  return codes.

**Door screen** (tab *Prezenčná listina*): search box (name or unit number) on top, list sorted by
unit, RSVP answer shown as a hint. Each row has explicit buttons **Prítomný** and **Zastúpený**
(the second opens a small dialog: pick the verified mandate, representative name prefilled).
A running header: "Prítomní: 19 vlastníkov · 46 % hlasov". Works at 390 px with one hand.

#### Reconciliation with the kiosk spec (BYT-20260609-009)

The kiosk sketch `voting_attendance` (its "Schema additions" section) **is this table**. When the
kiosk is built it adds no attendance table; it writes rows with `source = 'kiosk'`.

| Kiosk sketch | Here | Why |
|---|---|---|
| name `voting_attendance` | `mod_voting_attendance` | module table prefix used by every voting table |
| `votingId … on delete cascade` | `restrict` | attendance is legal evidence; same as `ballots.votingId` (`schema.ts:177`) |
| `ownerId`, `identifiedById`, `idCheckMethod`, `signatureStorageKey`, `signatureSha256`, `checkedInAt`, unique `(votingId, ownerId)` | identical | — |
| — | `status`, `mandateId`, `representativeName` | absent / represented was missing |
| — | `source`, `leftAt`, `note` | door vs. kiosk, early leave |
| `ballots.attendanceId → voting_attendance.id restrict` | unchanged, points here | kiosk still requires a row before a kiosk ballot |

A kiosk check-in and a door tick for the same owner hit the same unique key, so the second one
updates nothing and reports `ATTENDANCE_ALREADY_RECORDED`. Kiosk-only requirements (signature
mandatory, PIN) stay in the kiosk spec as checks on rows with `source = 'kiosk'`. The kiosk spec
gets a one-line note pointing here when this spec is promoted.

### 7. Export

Board-only (`manageMeetingAttendance`), from the *Prezenčná listina* tab. Rows are built by one
server function; PDF and Excel are two renderers over the same rows.

- **Formats:** PDF with `@react-pdf/renderer` (already a dependency, `package.json:44`, used by
  `src/components/voting/VotingMinutesPDF.tsx`); Excel with `xlsx` (`package.json:67`, today only
  used for import in `src/lib/import/formats/xlsx.ts`).
- **Two documents:**
  - *Hárok na podpis* — blank sheet printed before the meeting: unit, owner, share, empty
    signature column, empty "zastúpený kým" column.
  - *Prezenčná listina* — the filled record: unit, owner, share, state (prítomný / zastúpený kým /
    neprítomný), time of arrival, early leave, totals (owners and share present).
- **Options** (a small dialog, remembered per browser only):
  - rows: **one per owner** (units listed in one cell, shares summed) or **one per unit**
    (co-owners on separate lines under the unit);
  - **include non-residential units / garages**: yes / no. Totals follow the option and say so
    in the footer line.
- Generated on request, streamed, not stored. No personal data beyond name, unit and share — no
  e-mail, phone or address.
- **Legal content rule:** column labels are display labels and parametrize; the document carries
  **no statutory citation** in v1. Offered only for communities on the HOA template until the
  wording is signed off for other kinds (see Notes).

Gap found: there is no field today that marks a unit as non-residential or garage (single `unit`
kind, `src/lib/kinds/registry.ts:123`). The option needs a discriminator — see Decisions.

### 8. Owner view

- **Domov (owner):** a meeting card directly under the running-vote card while a meeting is
  upcoming: title, "streda 3. 12. o 18:00", place, the three buttons or the chosen answer with
  "Zmeniť". One primary action; link "Program schôdze" → voting detail.
- **Hlasovanie → meeting voting detail** (`OwnerBallot.tsx` shell): the same card on top; agenda
  items below. For SK and CZ e-voting is blocked at a meeting
  (`meetingBlocksElectronic`, `modules/voting/src/rules/index.ts:28`, `:39`), so the page explains
  "Hlasuje sa osobne na schôdzi" instead of showing ballot buttons — existing behaviour, only the
  wording is added.
- **Dom:** the meeting post appears in the feed like any event post, with the same card.
- **After the voting is closed:** the card shows one sentence — "Boli ste zapísaný ako prítomný",
  "…zastúpený (Ján Novák)" or "Na schôdzi ste neboli zapísaný" — plus their earlier RSVP. A link
  "Nesúhlasí to?" opens a prefilled message to the board (existing contact path, no new record).

### 9. Privacy (GDPR)

- **Owner sees:** own RSVP, own attendance, and aggregate numbers only (how many come, share
  expected / present). **Not** other owners' names or answers.
- **Board (admin, vote counter) sees:** names, units, shares, answers, attendance — needed to run
  the meeting. Caretaker and tenant see nothing of this.
- This differs from social events, where attendee lists may be visible. The RSVP read endpoints
  must therefore strip per-person data for `eventKind = "owners_meeting"` unless the caller has
  `manageMeetingAttendance`.
- The e-mail token page shows only the recipient's own state.
- Exports are board-only and contain name, unit, share, state — nothing else.
- Retention: RSVP rows are convenience data and may be deleted with the post; attendance rows are
  part of the meeting record and are kept (hence `restrict`). Whether owners may inspect the full
  attendance list as an attachment to the minutes is a legal question — see Notes.

### 10. Hand-off to the minutes

`getMeetingAttendanceSummary(votingId)` returns a plain object:

```ts
{
  votingId, closed: boolean,
  eligibleOwners, presentOwners, representedOwners, absentOwners,
  eligibleWeight, presentWeight,            // same weight basis as getVotingResults
  rows: [{ unitLabel, ownerName, weight, status, representativeName, checkedInAt, leftAt }]
}
```

- Consumers in this spec: the door header, the export, the owner sentence.
- `VotingMinutesPDF` (`src/components/voting/VotingMinutesPDF.tsx`) is legally regulated and is
  **not changed here**. A follow-up change may pass this object as an optional prop and print an
  attendance paragraph — only after legal sign-off of the wording per jurisdiction (SK §14a text,
  CZ equivalent), per the CLAUDE.md rule on regulated content.
- Known mismatch to put in front of the lawyer: for `simple_present` the engine counts "present"
  as the weight of **cast ballots** (`engine/index.ts:119-121`), not the attendance list. An owner
  ticked present who hands in no ballot is present on the list but absent from the calculation.
  This spec does not touch that; it only makes the two numbers visible side by side on the board
  console.

### Schema summary (all via `drizzle-kit generate`, additive)

| Object | Change |
|---|---|
| `mod_voting_attendance` | new table (§6) |
| `mod_voting_votings.meeting_post_id` | new nullable FK → `community_posts.id`, `onDelete: set null`, unique where not null |
| `community_posts.event_kind` | new `varchar(24) not null default 'social'` (`social` \| `owners_meeting`) |
| `event_rsvps.source` | new `varchar(16) not null default 'app'` |
| `event_rsvps.recorded_by_id` | new nullable FK → `users.id`, `onDelete: set null` |
| `community_notification_kind` enum | add `meeting_invitation`, `meeting_reminder`, `meeting_change` |
| `community_notifications_sent.change_seq` | new `integer not null default 0` |
| `community_notifications_sent` | new partial unique index `(post_id, recipient_id, kind, change_seq)` for the three meeting kinds |

DB impact: migration-time only, run once by `docker-entrypoint.sh`; no runtime DDL, no background
loop, no in-memory shared state. `ADD COLUMN … DEFAULT` with constants is metadata-only on
PostgreSQL 16. The partial index covers only rows of the new kinds (none exist), so building it is
instant. Enum additions are plain `ADD VALUE` — no value is renamed, so no literal sweep is needed.

## Acceptance Criteria

**Announcement**
- [x] Creating a voting of type "na schôdzi" with "Oznámiť schôdzu" checked creates the voting and
      one event post with `eventKind = "owners_meeting"` in one transaction, linked through
      `meetingPostId`; date, time and place are shown on the card.
- [x] A user without `createVoting` cannot create a post with `eventKind = "owners_meeting"`
      through any endpoint.
- [x] Changing date or place keeps existing RSVP rows and offers to notify owners; cancelling
      expires the post and notifies owners. (2026-11-18 review: cancel only while the voting is
      active; a second cancel is a no-op without e-mails — `alreadyCancelled`.)

**RSVP**
- [x] The meeting card shows exactly three answer buttons (Prídem / Neprídem / Ešte neviem), each
      a separate control ≥ 44 px; no control cycles through values.
- [x] An eligible owner can answer, change the answer, and withdraw it ("Zrušiť odpoveď" → no
      answer); each state survives reload.
- [x] A tenant, caretaker or an owner outside the voting's scope gets `MEETING_RSVP_NOT_ELIGIBLE`.
- [x] After `eventDate` any write returns `MEETING_RSVP_CLOSED` and the card is read-only.
- [x] A board member can set, change and clear the answer for an owner; the row has
      `source = "board"` and `recordedById` set; the owner can override it.
- [x] The RSVP route returns error codes only; no Slovak sentence comes from the API.
- [x] Existing social event posts behave exactly as before (labels, permissions, reminder).

**E-mail**
- [x] "Odoslať pozvánku" sends one invitation per eligible owner with an e-mail and returns the
      list of owners without one; a second click sends nothing to owners already invited.
- [x] Each of the three e-mail links records that answer without login; opening the link URL with
      a plain `GET` and no script execution writes nothing.
- [x] A token for owner A / meeting X cannot change owner B's answer, another meeting's answer, be
      used as a vote-confirmation or login token, or be used after `eventDate`
      (`…_TOKEN_INVALID` / `…_TOKEN_EXPIRED`).
- [x] The token page shows only that owner's state and lets them change or withdraw it.
- [x] The cron sends one reminder per owner in the 24 h before the meeting to owners who answered
      yes, maybe or nothing, and **none** to owners who answered no; a meeting post triggers no
      generic `event_reminder`.
- [ ] Two overlapping cron runs (or two replicas) send each owner at most one reminder — verified
      by running `runCron()` twice concurrently against one DB. (Claim now keyed by the current
      `meeting_change_seq`; a failed send releases its claim for a retry. Concurrency test not run.)
- [x] All three e-mails render in `sk`, `en`, `cs` from the `Email` namespace.

**Board overview**
- [x] The overview lists every eligible owner once per unit with share and answer, and the four
      totals (yes / no / maybe / no answer) sum to the number of eligible owners.
- [x] Share percentages equal those computed by the voting's existing weight helpers for the same
      owners (cross-checked against `getVotingParticipation`).
- [x] Each agenda item shows its quorum type and the expected-share estimate; `maybe` is not added
      to the expected share.
- [x] Opening the overview makes one data request; nothing polls.

**Attendance list**
- [x] A board member or the vote counter can mark an owner present or represented from 2 h before
      start until the voting is closed; outside that window the write fails with a code.
      (2026-11-18 review: "the vote counter" = `votings.voteCounterId` of this voting, not the global
      role; the write runs with the voting row FOR SHARE so it cannot slip past the close.)
- [x] `represented` without a verified active mandate for that owner and voting fails with
      `ATTENDANCE_MANDATE_REQUIRED`.
- [x] A recorded entry can be removed while the voting is open and no ballot is bound to it; an
      owner who left can be marked and unmarked as left.
- [x] After the voting is closed no attendance row can be created, changed or deleted, and every
      eligible owner without a row is reported absent. (2026-11-18 review: the eligible set, weights
      and unit labels are frozen at close — `mod_voting_eligibility_snapshots` + attendance
      `weight` / `unit_label`; list, export and totals of a closed voting read the frozen data.)
- [x] Marking the same owner twice (two devices) leaves one row and returns
      `ATTENDANCE_ALREADY_RECORDED`.
- [x] There is exactly one attendance table in the schema; the kiosk spec's `attendanceId` can
      reference it without a second table or a copy of rows.
- [x] Present share in the header equals the sum of weights of present + represented owners not
      marked as left.

**Export**
- [x] The blank sign-in sheet and the filled attendance list download as PDF; the filled list also
      as `.xlsx`; both renderers produce the same rows and totals for the same options.
- [x] "One row per owner" yields one line per owner; "one row per unit" yields every unit once
      with its co-owners; totals are identical in both modes.
- [ ] With non-residential units excluded, no such unit appears and the totals footer states the
      exclusion.
- [x] The export contains only name, unit, share, state, times — no e-mail, phone or address
      column exists in either format (assert the full column set, not only presence).
- [x] The export contains no statutory citation and is unavailable outside the HOA template.

**Owner view and privacy**
- [x] The owner sees their own answer before the meeting and, after the voting is closed, one
      sentence stating present / represented by whom / not recorded.
- [x] For a meeting post, every response delivered to a caller without `manageMeetingAttendance`
      contains only that caller's own RSVP/attendance plus aggregate counts — assert that no other
      user id or name is present in the payload.
- [x] Caretaker and tenant accounts get 403 on the overview, attendance and export endpoints.

**Minutes hand-off**
- [x] `getMeetingAttendanceSummary` returns counts and weights that match the attendance list and
      export for the same voting.
- [ ] `VotingMinutesPDF`, `engine/*`, `rules/*` and `results.ts` are byte-identical before and
      after this change. (False: the "present" change and the 2026-11-18 review fixes changed
      `engine/*`, `rules/*` and `results.ts`.)

**Cross-cutting**
- [x] Every new string exists in `sk.json`, `en.json` and `cs.json`; every new error code maps to
      a catalog entry in all three.
- [x] Every new FK declares `onDelete`.
- [ ] All new screens pass the senior baseline of BYT-20261117-002 at 390 px (targets ≥ 44 px,
      text ≥ 16 px, one primary button, no horizontal scroll).
- [x] No new top-level navigation item is added for either role.

## Project Context

**Exists — reuse**
- Meeting voting type: `modules/voting/src/db/schema.ts:49`, `modules/voting/src/votings.ts:132`;
  label `votingTypeMeeting` `messages/sk.json:659`.
- Vote counter on the voting: `modules/voting/src/db/schema.ts:88`.
- Event posts: `community_posts` `src/db/schema.ts:975` (`eventDate` `:988`, `eventLocation`
  `:989`); post types `:105`.
- RSVP: enum `src/db/schema.ts:120`, table `:1024`, route
  `src/app/api/community/posts/[id]/rsvp/route.ts` (POST upsert, DELETE withdraw).
- Shared card with injected footer: `src/components/nastenka/PostCard.tsx:17`.
- E-mail dedupe table: `src/db/schema.ts:1046`, kinds enum `:122`.
- Cron: `src/app/api/cron/community/route.ts` (secret check `:205`, event reminders `:118-181`),
  run snapshot `src/lib/cron-state.ts`.
- Event reminder e-mail: `sendEventReminder` `src/lib/email.ts:293`.
- Signed stateless tokens: `src/lib/signed-token.server.ts` (purposes `:22`, sign `:95`,
  verify `:115`).
- Eligibility and weights: `modules/voting/src/participation.ts:51`, `src/lib/voting-method.ts`,
  owner unit share `src/db/schema.ts:322`.
- Quorum rules (read-only): `modules/voting/src/rules/index.ts` (`getAvailableQuorumTypes` `:66`,
  `meetingBlocksElectronic` `:28`, `:39`).
- Mandates: `modules/voting/src/db/schema.ts:102`, route
  `modules/voting/src/routes/api/mandates/index.ts`.
- Voting detail UI: `modules/voting/src/routes/dashboard/id/{page,BoardConsole,OwnerBallot}.tsx`.
- Minutes PDF: `src/components/voting/VotingMinutesPDF.tsx`, `DownloadMinutesButton.tsx`.
- Permissions: `src/lib/permissions.ts` (`createVoting` `:6`, `recordPaperVote` `:8`,
  `respondToCommunityPost` `:18`).
- Law anchors for the meeting topic: `src/lib/laws-topics.ts:49-51` (SK § 14a, § 14, § 7c;
  CZ § 1207, § 1206, § 1205, § 1210, § 1191).
- Domain notes: `docs/domain/voting.md`, `docs/domain/community.md` (RSVP semantics `:33`, `:61`,
  `:83`).

**Does not exist — this spec adds**
- Any attendance table or query (`grep -ri attendance|prezen` over `src/`, `modules/`,
  `messages/` returns nothing).
- Link between a voting and a post; `eventKind`.
- Invitation / change e-mails; reminder to non-responders; one-click e-mail answer; public token
  page.
- Board RSVP overview by share; export of any attendance document; `.xlsx` writing.
- Per-user e-mail locale: `users` has no locale column, so e-mails go out in
  `routing.defaultLocale` (same as today's e-mails).

## Notes

### Decisions to confirm before `spec`

1. **Anchor = meeting voting + linked event post** (§1), not a new `meetings` table. Consequence:
   a meeting with nothing to vote on has no attendance list. OK for v1?
2. **Reminder audience:** yes + maybe + no answer, not "no". Or remind everyone?
3. **One-click link behaviour:** POST on page load with a no-JS confirm button (scanner-safe,
   feels like one click) vs. always require a tap on "Potvrdiť" (two clicks, simplest).
4. **Attendance window and freeze:** opens 2 h before start, frozen when the voting is closed.
   Alternative: explicit "Uzavrieť prezenčnú listinu" action with its own timestamp (two more
   columns on votings).
5. **`idCheckMethod` at the door:** required choice (photo ID / known in person) per row, or a
   default of "known in person" to keep door ticking to one tap?
6. **Non-residential / garage flag:** no such field exists on units today. Add
   `data.unit_type` to the `unit` kind's `dataSchema` (flat / non-residential / garage) in this
   spec, or ship the export option later with whichever spec introduces unit types?
7. **Multi-unit owner with different representatives per unit:** v1 stores one representative per
   owner per voting. Enough?
8. **Permission:** new key `manageMeetingAttendance` (admin, vote counter) vs. reusing
   `recordPaperVote`.
9. **Owners seeing names of who is coming:** default here is counts only. Some communities may
   want names visible like for social events — per-community setting, or never?

**Legal sign-off items (do not ship wording before these are answered)**
- L1. **Notice lead time and form of the invitation** under SK § 14a zák. 182/1993 Z.z. and the CZ
  provisions (anchors in `src/lib/laws-topics.ts:50-51`): is there a minimum period, and does an
  e-mail invitation satisfy it? Neither is recorded in `docs/domain/voting.md`, so the app sends
  the e-mail as a convenience and makes no claim that it is the statutory notice.
- L2. **Meeting quorum and substitute meeting:** the rules module has `fallbackQuorum`
  (`rules/index.ts:11`, 0.5 SK / 0.4 CZ) but no consumer; whether attendance from this list may
  drive a "meeting is / is not quorate" statement.
- L3. **"Present" for `simple_present`:** attendance list vs. cast ballots (§10).
- L4. **Content of the attendance list** (mandatory columns, signature, representative details)
  and whether owners may inspect it with the minutes — drives §7 columns and §9 visibility.
- L5. **Attendance paragraph in `VotingMinutesPDF`**, per jurisdiction.
- L6. Whether the attendance list applies to non-HOA community kinds (garden, garage, urbár…) or
  stays HOA-only.

### Deferred
- Statutory notice warning ("pozvánka odchádza neskoro") — after L1.
- Quorate / not quorate banner and substitute-meeting helper — after L2.
- Attendance in the minutes PDF and in the audit bundle — after L5.
- Meetings without a voting; recurring meetings; calendar (.ics) attachment in the invitation.
- Printable paper invitation for owners without e-mail; SMS reminder.
- Automatic retry of failed e-mail sends.
- Per-user e-mail language.
- Attendance history per owner ("zúčastnil sa 3 z 5 schôdzí") on the owner profile.
- Live door view shared between two devices.

### Sources
- Competitor Resitech has: a meeting notice type with date/time on the card, RSVP yes/no/maybe in
  the app or one click from e-mail, an attendee list, a reminder the day before, and attendance
  list export to PDF/Excel with "include non-residential/garages" and "row per owner or per unit".
  Ideas borrowed; wording and layout are our own.
- Kiosk spec BYT-20260609-009 mentions that the kiosk ballot is `voteType = electronic` while the
  rules block electronic voting at a meeting for SK and CZ (`rules/index.ts:28`, `:39`). Not
  solved here; noted so the kiosk spec resolves it.

## Implementation notes (2026-11-18)

Implemented in one pass (no commits; coordinator generates migration 0086).

- **Schema.** Core: `community_posts.event_kind` (social | owners_meeting), `event_rsvps.source`
  + `recorded_by_id` (→ users, set null), 3 new `community_notification_kind` values,
  `community_notifications_sent.change_seq` (nullable) with partial unique index
  `community_notifications_sent_meeting_claim_idx (post_id, recipient_id, kind, change_seq) WHERE
  change_seq IS NOT NULL`. Deviation from §4: the predicate is on `change_seq IS NOT NULL`, not on
  the new enum literals — PostgreSQL rejects a new enum value used in the same transaction that adds
  it, and enum→text casts are not immutable. Legacy kinds keep `change_seq` NULL, so the index never
  covers them. Voting: `mod_voting_votings.meeting_post_id` (→ community_posts, set null, unique
  where not null) + `meeting_change_seq`; new table `mod_voting_attendance` exactly as §6
  (`id_check_method` default `known_in_person`).
- **Code.** Pure rules/builders `modules/voting/src/workflow/attendance.ts` (codes, window, RSVP
  overview with engine-based estimate, attendance summary, export rows + closed column set);
  queries `modules/voting/src/attendance.ts`; e-mails + claims `meeting-notify.server.ts`; token page
  logic `meeting-token.server.ts`; routes `/api/votings/[id]/attendance(/export)`,
  `/api/votings/[id]/meeting`, public `/api/meeting-rsvp`; page `/[locale]/schodza/odpoved`.
  UI: `MeetingPanel.tsx` (board tabs + door list + export, owner card), `AttendancePDF.tsx`,
  shared `src/components/community/MeetingRsvpButtons.tsx`, feed card, Domov rows/cards
  (`modules/voting/src/ui/MeetingHomeCards.tsx`). E-mail copy in `MeetingAttendance.email`.
- **Decisions taken.** (1) v1 requires a meeting voting — no attendance list for a meeting without
  a vote. (2) Reminder audience = yes + maybe + no answer. (3) E-mail link opens a page with a single
  "Potvrdiť" tap; no auto-POST, no write on GET; one token per e-mail, answer in `?s=`. (4) List
  freezes on close, editable again only while reopened (status active). (5) `idCheckMethod` default
  `known_in_person`. (6) Non-residential/garage export option hidden — TODO until a unit-type
  discriminator exists. (7) One representative per owner. (8) No new permission key: board
  (`isBoard`) or `recordPaperVote` roles (admin, vote_counter). (9) Owners see counts only.
- **Notice.** Date changes re-check the 7-full-day rule (`workflow/notice.ts`) → `MEETING_NOTICE_TOO_SHORT`;
  the invitation response carries a non-blocking `noticeWarning`.
- **Not done / follow-ups.** Undo checks "any ballot of the owner in this voting" until kiosk adds
  `ballots.attendanceId`. `MinutesProtocol.attendance` (workflow/minutes.ts) is typed and accepted
  but nobody passes it yet and the PDF does not render it (L3/L5). TODO(legal): attendance as the
  §14b ods. 4 denominator — engine untouched, both numbers shown side by side on the door screen.
  Draft meeting votings are announced from the voting detail after activation (not on activation).
  "Nesúhlasí to?" is a plain hint, no prefilled message.


### Implementation notes — "present" in the result (2026-11-18, decided by Filip "podľa zákona")
- L3 resolved: a meeting voting's result now measures `simple_present` (SK §14b ods. 4) against the
  attendance list. `results.ts` loads `mod_voting_attendance` once (present + represented, not
  left, as-of ownership, voting scope) ∪ cast ballots → `computePresence` (engine, pure) → engine
  option `{ votingType: "meeting", presence }`. Weight basis = the tally's: a unit counts once,
  full weight, if any co-owner is present (differs from the door header, which sums co-owner shares).
- CZ §1206 ods. 2: meeting quorum = present weight > 50 % of all votes for every quorum type
  (`rules.meetingQuorumShare`); `simple_present` = majority of present; no silence-is-no at a
  meeting. §1210 náhradní shromáždění (40 %) — TODO(decision), no substitute-meeting flag exists.
- Empty attendance list → fallback to cast ballots + result code `ATTENDANCE_MISSING`; inquorate CZ
  meeting → `MEETING_QUORUM_NOT_REACHED`. UI: `ResultPresence` under each item result
  (`VotingResults.presence.*` / `.codes.*`).
- Minutes hand-off: `MinutesProtocol.presence` (basis, owners, weight, share, CZ quorum) derived from
  the result. Data only; L5 (PDF wording) still TODO(legal).

### Implementation notes — unit type / "Len byty" export (2026-11-18)
- Decision 6 resolved: units carry `entities.data.unit_type` (`flat | non_residential | garage |
  other`, no migration; absent = flat) — helper `src/lib/unit-type.ts`. Voting weight unchanged
  (SK §14(3): one vote per flat AND per non-residential unit).
- Export option unhidden as a checkbox "Len byty (bez nebytových priestorov a garáží)" in
  `MeetingPanel.tsx` → `?units=residential` → `getAttendanceExport(..., { residentialOnly })` →
  `buildAttendanceExport({ includeUnit })`. Rows drop excluded units (owner rows keep only their
  included units + weight); **totals intentionally stay over all eligible owners** (every NP votes)
  and the option shows that hint. TODO(decision): the AC wants totals to follow the option and the
  footer to state the exclusion — not done (PDF/xlsx footer unchanged); AC left unticked.
