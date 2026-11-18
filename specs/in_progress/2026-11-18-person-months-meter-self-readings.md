---
spec_id: BYT-20261118-006
title: "Person-months and meter self-readings — owner submissions, board review"
status: in_progress
created: 2026-11-18
updated: 2026-11-18
author: Filip
owner: filipvnencak
last_verified: 2026-11-18
project_type: node
depends_on:
  - BYT-20260512-002   # accounting module (meter readings, unit_persons, vyúčtovanie)
  - BYT-20261117-002   # specs/in_progress/2026-11-17-ux-simplification.md (IA: Moje platby, Financie → Ročné úlohy)
related_handoffs: []
tags: [accounting, meters, person-months, owner-portal, vyuctovanie, seniors]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Once a year the board collects two inputs from every flat: **how many people lived
there in each month** (osobomesiace) and **meter readings** (samoodpočty: cold and hot
water, heat indicators). Today that happens on paper slips and in an Excel file.
This spec moves it into the app. Owners submit from a phone under **Moje platby**,
and can edit or withdraw a submission until the board processes it. The board gets
one table per collection round with a missing-submissions list, an internal
"vyriešené" (resolved) flag, building/common meter readings, a reminder e-mail and
CSV/Excel export. The data goes to the yearly vyúčtovanie as a **read-only hand-off**.
No settlement engine changes in this slice.

### Problem statement

- Meter readings already exist (see Project Context), but in a minimal form. There
  is no collection window, no deadline or reminder, no photo, no review flag, no
  building meter, no export and no lock after the year is settled. The owner entry
  point only appears for doms that **already have** a reading
  (`owner-payments.ts:238`, `usesMeters: readings.length > 0`). A dom that has
  never collected readings has no way to start.
- Person counts exist only as a board-side, time-versioned table
  (`mod_accounting_unit_persons`). **No UI or API writes it**: only
  `scripts/accounting-demo-seed.ts` inserts rows. Owners cannot report persons at all.
- Board members chase missing flats by hand and retype slips. Errors land in the
  settlement.

## Scope

**In scope**
- **Collection round** ("Zber odpočtov a osôb") per accounting year: opens/deadline
  dates, which inputs are collected (meters, person-months, or both), and reminder
  lead time.
- **Owner flow (Moje platby, phone-first):**
  - report persons per month for a **range of months** (e.g. Jan–Jun: 2, Jul–Dec: 3);
  - submit a reading **per meter type** with an optional **photo**;
  - **edit** and **withdraw** their own submission until it is locked (resolved by the
    board, round closed for owner edits, or period locked). This is the undo path.
- **Board (Financie → Ročné úlohy → "Odpočty a osoby"):**
  - table of submissions for the round (unit × inputs, value, submitted at, photo, late badge);
  - internal **"vyriešené"** flag per submission, never exposed to owners;
  - board entry and correction on behalf of any unit;
  - **building / common meter readings** (hlavný vodomer, päta domu, …) with a
    **backdated** reading date;
  - **missing-submission list**;
  - **reminder e-mail** before the deadline via the existing cron-route pattern and
    `mod_accounting_notifications_sent` with a new `kind`;
  - **CSV and Excel export** of the round.
- **Lock**: everything for a year becomes read-only, for owners and board alike, once
  that year's settlement is published or the period is closed.
- **Hand-off to vyúčtovanie** (read-only): the wizard gates show round completeness.
  Resolved person-months can be applied to `unit_persons` for **future** predpis
  publishes.
- Meter-reading engine errors converted to **codes** (they are English prose today).

**Out of scope**
- Any change in `modules/accounting/src/engine/*` (behaviour-preserving per the UX
  spec). Engine follow-ups are listed under Deferred as separate slices.
- Settlement for cold water by meters, a persons-key settlement driven by actual
  person-months, and consumption deltas across the year boundary (all engine slices).
- Meter registry with several meters of one type per flat (kitchen + bathroom
  vodomer). See Decisions.
- Remote-read / radio meter integrations, OCR of the photo.
- Corrected statements after a settlement is published (existing corrected-statement path).
- Tenants (nájomníci) submitting. Owners of the unit and the board only.

## Approach

### Where it lives (IA from the UX simplification spec)

- **Owner:** *Moje platby* gets a section **"Odpočty a osoby"**. It is visible only
  while a round is open for the owner's dom (the UX spec says "meter entry only
  inside the reading window"). Outside the window it shows a single line: last
  submission summary plus "Zber je uzavretý". *Domov* shows the deadline card
  ("Odpočty do 15. 1.") through the existing deadlines slot. An owner with one unit
  never sees a unit picker.
- **Board:** *Financie → Ročné úlohy → Odpočty a osoby*. The existing
  `AnnualTasksHub` "meters" tile (`AnnualTasksHub.tsx:26`) points here. The old
  `/accounting/meters` URL redirects (UX constraint: nothing 404s).
- Senior baseline: tap targets ≥ 44 px, `text-base`, one primary button per screen,
  numeric keypad (`inputmode="decimal"`) for readings, month range picked by two
  selects (from / to), not a calendar grid. The photo is "Odfotiť merač" using
  `<input type="file" accept="image/*" capture="environment">`.

### Owner flow

1. **Osoby v byte.** The form has rows "od mesiaca – do mesiaca – počet osôb", one row
   by default, plus "Pridať obdobie". Ranges must not overlap and must fall within the
   round's year. On save, each range expands server-side to one row **per month**
   (see schema), all sharing one `submissionId`. The owner sees the ranges again,
   collapsed from consecutive equal months.
2. **Odpočty.** One card per meter type that the board enabled for the round. Each
   card has value, reading date (default today; within the round year ±
   `roundGraceDays`, never future) and an optional photo. The last known value is
   shown as a hint. A value lower than the last one shows a soft warning
   ("Hodnota je nižšia ako minule — skontrolujte"), not a block, because meters get
   replaced.
3. **Edit / withdraw.** While a submission is **owner-editable** the card shows
   "Upraviť" and "Zrušiť". Edit = void the old row and insert a new one in one
   transaction, with the audit-log pattern already used by `voidReading`. Withdraw =
   void. After the lock the card is read-only with the neutral text "Údaje už
   spracúva výbor. Pre zmenu ich kontaktujte." The owner API returns only
   `canEdit: boolean`. It never returns `resolvedAt`, `resolvedById` or any field
   that tells "resolved" apart from "deadline passed".
4. **Late submission.** After the deadline the owner can still submit while the round
   is open for late entries (decision). Late rows get `late = true`.

**Owner-editable** = not voided AND `resolvedAt IS NULL` AND the round is open
for owner edits AND the year is not locked (below).

### Board flow

- **Round setup:** create/edit round (year, opensAt, deadlineAt, collect meters
  y/n plus which meter types, collect persons y/n, reminder days before deadline,
  allow late y/n), and close it for owner edits. One round per (dom, year) in MVP.
- **Table:** one row per unit with columns *Osoby (person-months total)*, one column
  per enabled meter type, *Stav* (chýba / odoslané / vyriešené / neskoro), *Fotka*.
  Row actions: mark resolved / unresolve, enter or correct on behalf (audit
  justification "board entry"), view photo. Filters: chýbajúce · nevyriešené · všetko.
  Bulk "Označiť ako vyriešené" on the selected rows.
- **Missing list:** units with no non-voided entry for an enabled input. It is a
  filter on the same table, not a second fetch. It also feeds the reminder cron.
- **Building / common meters:** a separate card under the table with label, meter
  type, reading date (backdated allowed, not future), value, optional photo and
  note. Board only. It shows "Súčet bytov vs. hlavný merač" as **informational**
  (difference = straty / spoločná spotreba). The engine does not use it.
- **Export:** "Stiahnuť CSV" and "Stiahnuť Excel". One sheet/file per input
  (persons: unit, VS, month 1–12, total person-months; meters: unit, VS, type,
  date, value, late, resolved, submitted by/at). Includes the building-meter sheet.
  Cells starting with `= + - @` are prefixed with `'` (CSV/formula injection).
  Server route, streamed; reuses `papaparse` and `xlsx` already in `package.json`.

### Lock (read-only after settlement)

A year is **locked** when `mod_accounting_periods.status IN ('published','closed')`
for that dom+year OR a non-voided settlement for that year exists (decision: does
`reconciling` lock too?). In a locked year every write path rejects with code
`period_locked`, board included:
- `createReading` / `voidReading` (`meters.ts:73`, `:134`). Today they have **no**
  period check. Adding it also covers the MCP `submit_meter_reading` action
  (`src/lib/mcp/actions/accounting.ts:404`), which calls `createReading`.
- person-month writes, building-meter writes, resolve/unresolve, round edits.

Reads and export stay available.

### Hand-off to vyúčtovanie (read-only, no engine change)

What the current code does with these inputs:
- **Meter readings.** `buildMeteredCostShares` (`vyuctovanie.ts:65`) already reads
  non-voided `mod_accounting_meter_readings` for `heat` and `water_hot` within the
  year and calls `engine/heat.ts`, but only if **every** unit has a reading
  (otherwise it falls back to the prescribed split). The wizard gate counts
  `unitsWithoutReadings` (`vyuctovanie.ts:252`) as informational. This slice
  **feeds** that path unchanged. Board-entered and owner-entered rows are the same
  rows.
- **Person counts.** The settlement engine does **not** read persons. It splits
  actual cost proportionally to the **prescribed** amounts, whose allocation basis was
  snapshotted at predpis publish (`engine/settlement.ts:6-12`,
  `docs/domain/accounting.md:45`). `unit_persons` is read only at publish
  (`fee-schedule-publish.ts:102-131`). So owner-reported person-months **cannot
  change a settlement** without an engine change.

So this slice ships:
1. **Wizard gate (informational):** the vyúčtovanie wizard shows "Zber odpočtov a
   osôb: N bytov chýba, M nevyriešených" next to the existing
   `unitsWithoutReadings`. Not blocking, same as today.
2. **"Použiť pre mesačné platby"** (board action, on resolved person-month rows): it
   writes `mod_accounting_unit_persons` rows (`effectiveFrom` = first day of each
   change month). This affects only the **next** predpis publish. Published
   assessments stay immutable (invariant: snapshot at publish). The confirm dialog
   states that.
3. Persons keyed by actual person-months in the settlement, cold-water metering and
   year-boundary deltas are **separate engine slices** (Deferred). Each needs a
   legal-copy check because `VyuctovaniePDFSk` prints the "použitý kľúč".

**Risk to flag (no change here):** `consFor` (`vyuctovanie.ts:140-146`) treats a
**single** reading in the year as the consumption itself, not as a counter delta.
Self-readings collected once a year (one reading per unit) would therefore feed the
**absolute meter state** into the heat/TÚV split. Until the engine slice that takes
the delta against the previous year's last reading lands, the board table must show a
warning when a unit has exactly one reading in the year for a metered type. The
wizard gate repeats that warning. It is display only.

### Reminder e-mail (cron, no per-node loop)

- New route `src/app/api/cron/accounting-readings/route.ts`, `X-Cron-Secret` guarded,
  self-gates on the accounting module being enabled, same shape as
  `src/app/api/cron/accounting-rates`. Registered in `modules/accounting/module.json`
  `cronJobs` and in the cron container lines of `docker-compose.prod.yml:85-87` and
  `docker-compose.hub.yml:87-88` (daily, e.g. `0 8 * * *`). State lives in
  `src/lib/cron-state` (route files export handlers only).
- Logic: for each open round where `now` is within `reminderDaysBefore` of the
  deadline, it finds the active owners of units still missing an enabled input. For
  each it does `INSERT … ON CONFLICT DO NOTHING RETURNING` into
  `mod_accounting_notifications_sent` (kind `reading_reminder`, `roundId`,
  `recipientId`) and sends only when a row was inserted. The insert is the dedupe,
  so it is safe if two app replicas ever receive the call. No in-memory state.
- E-mail: new `sendReadingReminder` in `src/lib/email.ts`, with strings from
  `getTranslations({ locale, namespace: "Email" })` and the optional `locale` param
  (CLAUDE.md email rule). The recipient's locale falls back to
  `routing.defaultLocale`. The deep link goes to Moje platby → Odpočty a osoby.
- Optional: a second kind `reading_round_opened` sent at round open (decision).

### Error codes (i18n)

Lib/engine paths throw/return stable codes and never English prose. The API maps a
code to `{ error: code }` and the UI maps it to `Accounting.readings.errors.<code>`
in `sk`/`en`/`cs`: `period_locked`, `round_not_open`, `round_closed_for_owner`,
`submission_locked`, `month_range_invalid`, `month_range_overlap`,
`value_negative`, `date_in_future`, `date_outside_round`, `unknown_unit`,
`forbidden`, `photo_too_large`, `photo_type_invalid`, `not_found`,
`already_voided`. In the same slice, `meters.ts` stops throwing
`"accounting: reading value must be >= 0"` etc., and the meters API stops returning
`err.message` raw (`routes/api/meters.ts:85-86`, `:108-114`).

### Schema sketch (`modules/accounting/src/db/schema.ts`, via `drizzle-kit generate`)

All additive. No enum value renamed, no destructive alter, no runtime DDL.

```ts
// Collection round per (dom, year)
mod_accounting_reading_rounds
  id uuid pk
  entity_id   → entities.id          onDelete restrict
  period_id   → accounting_periods.id onDelete restrict
  year int not null
  opens_at timestamp not null
  deadline_at timestamp not null
  closed_for_owners_at timestamp null      // board "uzavrieť zber"
  allow_late boolean not null default true
  collect_persons boolean not null
  meter_types mod_accounting_meter_type[] not null default '{}'
  reminder_days_before int not null default 5   // check 0..30
  created_by_id → users.id onDelete restrict
  created_at
  unique (entity_id, year)

// Owner-reported persons, one row per month (range expands on write)
mod_accounting_person_months
  id uuid pk
  entity_id      → entities.id onDelete restrict
  unit_entity_id → entities.id onDelete restrict
  round_id       → reading_rounds.id onDelete cascade   // owned child of the round
  year int not null, month int not null   // check 1..12
  persons_count int not null              // check >= 0 (and <= 50 sanity)
  submission_id uuid not null             // groups a range; no FK
  late boolean not null default false
  resolved_at timestamp null, resolved_by_id → users.id onDelete set null
  applied_unit_persons_id → unit_persons.id onDelete set null  // "Použiť pre mesačné platby"
  voided_at timestamp null, voided_by_id → users.id onDelete set null
  created_by_id → users.id onDelete restrict
  created_at
  unique (unit_entity_id, year, month) WHERE voided_at IS NULL   // partial

// Existing table — additive columns only
mod_accounting_meter_readings  (+)
  round_id → reading_rounds.id onDelete set null   // null = legacy / outside a round
  photo_storage_key varchar(512) null              // src/lib/storage key
  note varchar(500) null
  late boolean not null default false
  resolved_at timestamp null, resolved_by_id → users.id onDelete set null

// Building / common meters — separate table so the existing unit_entity_id
// NOT NULL + domUnitsWhere invariant (and the vyúčtovanie queries) are untouched
mod_accounting_building_meter_readings
  id uuid pk
  entity_id → entities.id onDelete restrict
  round_id  → reading_rounds.id onDelete set null
  meter_type mod_accounting_meter_type not null
  label varchar(120) not null
  reading_date timestamp not null      // backdated allowed, not future
  value_milli bigint not null          // check >= 0
  photo_storage_key varchar(512) null, note varchar(500) null
  voided_at, voided_by_id → users.id onDelete set null
  created_by_id → users.id onDelete restrict
  created_at

// Notifications: one table, new kind + new dedupe target
mod_accounting_notification_kind  ADD VALUE 'reading_reminder'
mod_accounting_notifications_sent (+)
  round_id → reading_rounds.id onDelete cascade
  unique (kind, round_id, recipient_id) WHERE round_id IS NOT NULL   // new partial index
```

Notes on the sketch:
- The existing dedupe index is `(kind, settlement_id, recipient_id)`
  (`schema.ts:885-887`). `settlement_id` is NULL for reminder rows, and Postgres
  treats NULLs as distinct, so **that index would not dedupe reminders**. Hence the
  new partial unique index on `round_id`.
- `bigint` for building meters because main counters can exceed int32 in milli
  units. Unit readings stay `integer` as today. Decision: widen too?
- No CREATE/ALTER at runtime. Everything goes in the generated migration, applied by
  `docker-entrypoint.sh` as usual.

### Access

- Owner: own units only. Reuse `canEnterReading` / `listAccessibleUnits`
  (`meters.ts:63`, `karta-bytu.ts:78`). The owner can void or edit only rows they
  created, and only while owner-editable.
- Board writers (`canWriteAccounting`): any unit, resolve/unresolve, building
  meters, rounds, export, apply-to-unit_persons. Board readers: view and export only.
- Photos: served through an auth-checked route (same rule as reading the row). They
  are never public URLs and never shown to other owners.

### Data fetching

- The owner section loads once with the Moje platby server render: round, own
  entries and `canEdit` flags. No polling, no live updates.
- The board table is **one** query per round (units LEFT JOIN entries), and the
  missing list is derived client-side from it. Export is a separate download route.
  No refetch on events.

## Acceptance Criteria

**Owner**
- [x] While a round is open, an owner with one unit sees "Odpočty a osoby" in Moje platby with no unit picker. An owner with 2+ units picks a unit first.
- [x] Outside a round (before `opensAt` or after it is closed for owners) the section shows only the last-submission summary and no inputs. The `usesMeters` gate (`owner-payments.ts:238`) no longer decides visibility: a dom with zero historic readings sees the section once a round opens.
- [x] Owner submits persons "Jan–Jun: 2, Jul–Dec: 3" → 12 non-voided `person_months` rows (6×2, 6×3) sharing one `submission_id`; the UI re-renders the two ranges.
- [x] Overlapping ranges, months outside 1–12, from > to, or a month already holding a non-voided row → rejected with `month_range_overlap` / `month_range_invalid`, shown as a translated message.
- [x] Owner submits a reading with a photo → row has `round_id`, `photo_storage_key`, and the photo opens for the owner and the board. Another owner of a different unit gets 403 on the photo URL.
- [x] A future reading date → `date_in_future`. A negative value → `value_negative`. A value lower than the previous reading shows a warning and still saves.
- [x] **Edit:** while owner-editable, "Upraviť" voids the old row and inserts the new one in one transaction. The audit log has the void and the insert. The vyúčtovanie query sees only the new value.
- [x] **Withdraw:** "Zrušiť" voids the row. The unit reappears in the board's missing list.
- [x] After the board marks a row resolved, the owner sees it read-only with the neutral lock text, and edit/withdraw via the API returns `submission_locked`.
- [ ] **Negative test (only-X):** the owner GET response for entries contains exactly the allowed keys (`id, kind, months/value, readingDate, photo, late, canEdit, createdAt`). Assert the full key set; `resolvedAt`, `resolvedById`, `appliedUnitPersonsId` and other owners' rows must be absent.
- [x] A submission after `deadline_at` with `allow_late = true` saves with `late = true`. With `allow_late = false` → `round_closed_for_owner`.

**Board**
- [x] Board table lists **every** unit of the dom exactly once (count == `listDomUnits` count), with status chýba / odoslané / vyriešené / neskoro per enabled input.
- [x] The "Chýbajúce" filter shows exactly the units with no non-voided entry for an enabled input. Assert the full set, not just presence of the expected units.
- [x] Mark resolved / unresolve / bulk resolve set and clear `resolved_at`/`resolved_by_id`, and each is audit-logged.
- [x] Board enters or corrects a reading for any unit, with audit justification "board entry".
- [x] Board records a building meter reading with a date in the previous month. A future date → `date_in_future`. The building card shows the informational "súčet bytov vs. hlavný merač" difference.
- [x] A unit with exactly one reading in the year for `heat`/`water_hot` shows the "single reading = counter state" warning in the table and in the vyúčtovanie wizard gate.
- [x] CSV and XLSX export contain persons (per unit × 12 months + total), unit readings, and building readings for the round. A cell value starting with `=` is exported prefixed with `'`.
- [x] Board readers can view and export but get 403 on every write.

**Reminder**
- [x] With `reminder_days_before = 5`, the cron run 5 days before the deadline e-mails each active owner of a unit still missing an input once. A second run the same or next day sends nothing to them (dedupe row exists).
- [x] An owner whose units are complete gets no reminder. Assert the recipient set exactly.
- [x] Reminder e-mail renders in sk, en and cs from the `Email` namespace. No hardcoded strings.
- [x] The cron route rejects a missing or wrong `X-Cron-Secret` and no-ops when the accounting module is disabled.
- [x] The cron line is present in both `docker-compose.prod.yml` and `docker-compose.hub.yml`, and the job is listed in `module.json` `cronJobs`.

**Lock and hand-off**
- [x] When the year's period is `published`/`closed` (or a settlement exists), every write (owner and board, incl. MCP `submit_meter_reading`, void, resolve, building meter, round edit, apply-to-predpis) returns `period_locked`. Reads and export still work.
- [x] The vyúčtovanie wizard shows "N bytov chýba, M nevyriešených" for the year's round. It does not block, which matches today's `unitsWithoutReadings`.
- [x] "Použiť pre mesačné platby" on resolved person-months creates `unit_persons` rows only at months where the count changes, and sets `applied_unit_persons_id`. Already published `fee_assessments` stay byte-identical before and after (regression test).
- [ ] `engine/*` files are unchanged in the diff. Settlement output for a fixture year is byte-identical before and after this slice.

**Cross-cutting**
- [x] Every new string exists in `messages/sk.json`, `en.json`, `cs.json`. Every error code has a catalog entry. `meters.ts` and `routes/api/meters.ts` no longer surface English prose.
- [ ] Every new FK declares `onDelete` as in the schema sketch. The migration is generated by `drizzle-kit generate` and committed with the schema.
- [x] The owner section and board table pass the senior baseline at 390 px: ≥ 44 px targets, `text-base`, one primary button, no horizontal scroll.
- [x] `/accounting/meters` redirects to the new board/owner location.

## Project Context

What already exists (verified 2026-11-18):
- **Meter readings table:** `mod_accounting_meter_readings`, `modules/accounting/src/db/schema.ts:904-939`. Enum `heat | water_cold | water_hot | electricity` at `:893`. `unit_entity_id` NOT NULL, values in milli units, void-not-delete.
- **Meter lib:** `modules/accounting/src/lib/meters.ts`: `listReadingsForUnit` `:34`, `canEnterReading` `:63` (owner-of-unit or board, same as karta bytu), `createReading` `:73` (prose errors, no period check), `voidReading` `:134` (owner may void own, board any; audit-logged).
- **Meter API/UI:** `modules/accounting/src/routes/api/meters.ts` (GET/POST/void; returns `err.message` raw at `:85`, `:108`), board/owner page `modules/accounting/src/routes/dashboard/meters/page.tsx` (299 lines, no photo), wired at `src/app/[locale]/(dashboard)/accounting/meters/page.tsx` and `src/app/api/accounting/meters/route.ts`.
- **Owner entry point:** `modules/accounting/src/components/owner/MyPaymentsView.tsx:178-183`, gated by `usesMeters` from `modules/accounting/src/lib/owner-payments.ts:164,238`.
- **Board hub tile:** `modules/accounting/src/components/AnnualTasksHub.tsx:26` (`/accounting/meters`).
- **MCP:** `submit_meter_reading`, `src/lib/mcp/tools/actions.ts:76`, `src/lib/mcp/actions/accounting.ts:395-450` (calls `createReading`).
- **Validator:** `validateMeterReadingInput`, `modules/accounting/src/lib/input-validators.ts:196` (already returns field codes).
- **Persons:** `mod_accounting_unit_persons` (`schema.ts:504-530`), time-versioned `effectiveFrom`. Read only by `fee-schedule-publish.ts:102-131` (→ `personsByMonth` for the `persons` allocation key, `engine/assessment.ts:29-31`). Written only by `scripts/accounting-demo-seed.ts`.
- **Vyúčtovanie:** `modules/accounting/src/lib/vyuctovanie.ts`: gates comment `:36-45`, `buildMeteredCostShares` `:65` (heat/TÚV only, all-units-or-nothing, `consFor` single-reading quirk `:140-146`), `unitsWithoutReadings` `:252`. Heat engine `modules/accounting/src/engine/heat.ts` (vyhláška 269/2015 / 376/2021; "VERIFY BEFORE PRODUCTION" note `:20-24`). Settlement split rule `modules/accounting/src/engine/settlement.ts:6-12`.
- **Periods:** `mod_accounting_periods.status` enum `open | reconciling | published | closed` (`schema.ts:32-37`, table `:199`).
- **Notifications:** `mod_accounting_notifications_sent` + kind enum `['settlement_published']` (`schema.ts:860-889`), used in `vyuctovanie.ts:584-589`. Email pattern: `sendSettlementPublishedNotification`, `src/lib/email.ts:551`.
- **Cron:** routes `src/app/api/cron/community/route.ts`, `src/app/api/cron/accounting-rates`. Crontab lines in `docker-compose.prod.yml:85-87`, `docker-compose.hub.yml:87-88`. Module registration in `modules/accounting/module.json` `cronJobs`.
- **Storage:** `src/lib/storage.ts` (`buildStorageKey` `:74`, `getStorage` `:301`), as used by expense attachments in `modules/accounting/src/lib/attachments.ts`.
- **Export libs:** `papaparse` and `xlsx` (`^0.18.5`) already in `package.json`.
- **IA / UX baseline:** `specs/in_progress/2026-11-17-ux-simplification.md` Phase 4 (Moje platby: "meter entry only inside the reading window"; Domov deadlines) and Phase 5 (Financie → Ročné úlohy: meters).
- **Domain:** `docs/domain/accounting.md:45` (allocation inputs snapshotted at publish). Retro `docs/2026-07-07-retro-accounting-module.md:39` (owner portal "only" list includes meter reading entry, so update that list).

## Notes

### Decisions to confirm before `in_progress`
- **Is "resolved" hidden or merely unlabeled?** The owner must see that editing has
  stopped, so they learn *something* changed. Proposal: show only `canEdit=false`
  with neutral text, which gives no way to tell "resolved" from "deadline passed".
  Confirm that is "not visible" enough.
- **Lock trigger:** `published|closed` only, or also `reconciling`? Recommendation:
  lock from the moment a settlement row exists, because editing data that a draft
  settlement used silently desyncs it.
- **Late submissions:** allowed by default (`allow_late = true`) and flagged, or hard stop at the deadline?
- **Multiple meters of one type per flat** (two vodomery). The current model is one
  series per (unit, type), and `consFor` would mix two meters. Options: (a) MVP
  requires one combined value per type (owner sums); (b) meter registry slice
  (`mod_accounting_meters`, serial number, install/replace date) **plus** an engine
  change. Recommendation: (a) now, (b) as its own spec.
- **Who counts as a person** (trvalý pobyt vs. actually living, children, short
  stays): this is a stanovy/zmluva question, not code. The form needs a one-line help
  text approved by Filip. Treat that text as legally sensitive copy.
- **Photo retention / GDPR:** photos may show the inside of a flat. Keep until the
  period is closed + N years (accounting retention), or delete at lock? Who can see
  them: board writers only, or readers too?
- **"Použiť pre mesačné platby" automatic or manual?** Recommendation: manual board
  action, because it changes the next predpis.
- **Round-opened e-mail** (`reading_round_opened` kind): include in MVP or only the pre-deadline reminder?
- **`bigint` for unit readings too** (int32 milli caps at ~2.1 million units)? Widening
  is a destructive type alter, so it needs a hand-written migration (CLAUDE.md
  pattern). Keep `integer` unless a real meter overflows.
- **`xlsx@0.18.5`** is the last npm release and has known advisories on *parsing*.
  We only write, but confirm it is acceptable or switch the writer.

### Deferred (separate slices — engine changes flagged)
- **Engine slice A: year-boundary consumption delta.** Consumption = this year's
  last reading − previous year's last reading (or the meter-install reading), instead
  of the single-reading-as-consumption fallback in `consFor`. Behaviour change in
  the settlement, so it needs a fixture-based legal check.
- **Engine slice B: persons key from actual person-months** for persons-keyed services
  (odvoz odpadu, výťah, …) in the settlement, instead of the prescribed-proportional
  split. It changes `engine/settlement.ts` inputs and the "použitý kľúč" printed in
  `VyuctovaniePDFSk`, so it needs legal-copy sign-off.
- **Engine slice C: cold water (`water_cold`) metered split**, optionally reconciled
  against the main building meter (losses distribution rule = decision for that slice).
- **Meter registry** (several meters per type, replacement history, serial numbers, calibration due dates).
- **MCP tools** `submit_person_months` and `get_reading_round_status` on top of the new lib functions.
- **Kiosk/paper intake:** board scans paper slips → bulk entry screen.
- Competitor Resitech has "Osobomesiace a samoodpočty" in its owner menu: owner
  submissions, whole-building readings with backdated dates, a "vyriešené" flag and
  export. The owner profile also shows person-months and meter readings. This spec
  covers the same ground plus the lock and settlement hand-off. A per-owner profile
  view of these is left to the owners-profile work.

## Implementation notes (2026-11-18)

Implemented in the working tree (no commit, no tests run). Ticked ACs = behaviour
implemented in code; the automated tests the ACs describe (only-X key-set test,
byte-identical fee_assessments / settlement regression) are NOT written yet.

- **Schema** (`modules/accounting/src/db/schema.ts`, additive): `mod_accounting_reading_rounds`,
  `mod_accounting_person_months` (partial unique `(unit, year, month) WHERE voided_at IS NULL`),
  `mod_accounting_building_meter_readings` (bigint value), meter_readings `+round_id, photo_storage_key,
  note, late, resolved_at, resolved_by_id`, notification kind `reading_reminder`, notifications_sent
  `+round_id` + partial unique `(kind, round_id, recipient_id) WHERE round_id IS NOT NULL`. Migration
  still to be generated by `pnpm db:generate` (coordinator).
- **Lib**: `reading-rounds.ts` (rounds, owner view, submissions, resolve, board table, building meters,
  apply-to-unit_persons, photo visibility), `reading-rounds-format.ts` (client-safe codes / ranges /
  `spreadsheetSafe`), `reading-lock.ts` (year lock), `reading-rounds-export.ts`, `reading-reminders.ts`.
  `meters.ts` now throws `ReadingError` codes and checks the lock in create + void (covers MCP).
- **API**: `/api/accounting/readings/[[...path]]` (board, export, photo, round, persons, meter, resolve,
  building, apply-persons). `/api/accounting/meters` returns `{ error: code }` only.
- **UI**: owner `ReadingsSection` in Moje platby (`#odpocty`); board page `/accounting/readings`
  (hub tile + vyúčtovanie gate link there); `/accounting/meters` redirects (board → readings, else Moje
  platby). Old module meters page removed.
- **Cron**: `/api/cron/accounting-readings` (daily 08:00), module.json + both compose files.
- **Decisions taken**: resolved hidden (only `canEdit`); lock also on `reconciling` (and any settlement row);
  late allowed + flagged; one value per meter type per round (no registry); persons help text = neutral
  placeholder `TODO(legal copy sign-off)`; photos board (admin/treasurer/chairman) + submitting owner, via
  the auth-checked photo route; apply-to-predpis manual; reminder only (no round-opened mail); integer
  unit readings; xlsx write-only.
- **Deviations**: strings live in the `ReadingRounds` namespace (errors `ReadingRounds.errors.*`, e-mail
  `ReadingRounds.email.*`) instead of `Accounting.readings.errors` / `Email` — parallel-agent rule.
  Reading date must lie inside the round year (`ROUND_GRACE_DAYS = 0`, `TODO(decision)`): vyúčtovanie
  filters by calendar year, so a ± grace date would silently not count. Reminders go out in the default
  locale (users have no locale column, `TODO(decision)`). Resolve works per unit row (all the unit's round
  entries), not per single submission.
- **Not done**: Domov deadline card ("Odpočty do 15. 1.") — home deadlines slot is outside this slice's
  files; retro doc owner-portal "only" list update; tests; MCP `submit_meter_reading` still lets board
  readers (chairman) write via `assertUnitLedger` (lock check added only).

