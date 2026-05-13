---
spec_id: BYT-20260508-003
title: "Easy Import bytov a vlastníkov"
status: implemented
created: 2026-05-08
updated: 2026-05-13
author: byt-app
owner: byt-app
last_verified: 2026-05-13
project_type: other
depends_on: []
related_handoffs: []
tags: [import, owners, units, onboarding]
feature_branch: "feature/easy-import-units-and-owners"
changelog_version: "2.1.1"
changelog_date: "2026-05-13"
docs_version: ""
docs_communicated: ""
---

## Goal

Onboard a brand-new HOA in minutes, not days, even when the admin is a non-technical
retired predseda working from a single Kataster LV. Today an admin must hand-create
each entrance, each unit, and each owner via the entity tree UI — error-prone and
slow for buildings with 50–200 flats. This spec adds an "Easy Import" wizard built
around three inputs the admin can mix and match:

1. **XLSX template** (primary) — Excel-friendly file with locked column formatting,
   dropdowns, and sample rows. CSV remains supported as a secondary fallback for
   users who already script their own exports.
2. **In-browser editable grid** — once any source is uploaded (or starting blank),
   the admin sees the whole dataset as a spreadsheet inside the app, with per-cell
   validation. Errors are fixed inline, no download/upload round-trip.
3. **Paste-from-Kataster LV textarea** — admin opens the LV PDF in their browser,
   `Ctrl+A` / `Ctrl+C`, pastes the raw text into the wizard. A best-effort Slovak
   LV regex pre-fills owner rows into the grid. Parse failures never block — the
   grid is always editable.

The wizard then seeds the full entity tree (community → optional block → optional
entrance → unit) plus owner records and their share weights in one transaction,
after the admin confirms a dry-run preview.

## Scope

**In scope**
- **XLSX template generator (primary)**: tailored to the chosen building structure
  (entrance on/off, block on/off) so admins only see columns that apply. Share
  columns formatted as text (`@`) so Excel does not mangle `1/96` into a date.
  Country and voting-method columns use data-validation dropdowns. Frozen header
  row, sample row pre-filled, cell comments pointing at the Kataster source field.
- **CSV template generator (secondary)**: same column set as XLSX, semicolon
  delimiter (Slovak Excel default), UTF-8 with BOM. Listed under "Advanced" in the
  download UI — most admins never see it.
- File upload accepting both `.xlsx` and `.csv`, server detects by extension and
  magic bytes; uniform validation pipeline downstream.
- **In-browser editable grid**: after upload (or starting from a blank template),
  the parsed dataset is shown as an editable table. Per-cell validation; errors are
  highlighted with a tooltip. Admin fixes errors inline and commits without
  re-uploading. Empty start (no upload) is supported — admin can type the whole
  building in the grid.
- **Paste-from-Kataster LV textarea**: a "Vložiť z LV" affordance opens a textarea
  that runs a Slovak LV heuristic regex on whatever text is pasted (owner blocks
  in the standard `Vlastník: <name>, podiel: 1/96` style). Recognised owner rows
  are appended to the grid as draft rows the admin reviews. Parse misses are
  silently ignored — paste is best-effort, never load-bearing.
- **Share-format leniency**: parser accepts `1/96`, `5614/100000`, `5,614/100000`,
  `5.614/100000`, bare decimals (`0.01042`), and percentages (`1.042%`). All forms
  normalised to exact rational arithmetic. Preview shows the normalised
  `numerator/denominator` so the admin can sanity-check.
- Schema validation (Zod) + per-row dry-run preview reflected directly in the grid.
- Idempotent seed of `entities` (kinds `housing_community`, optional `housing_block`,
  optional `housing_entrance`, `housing_unit`) + `housing_root_data` + `housing_unit_data`.
- **Schema change**: `users.email` becomes nullable. Owner rows with no email
  produce shell users with `email = NULL`, `status = 'pending'`, no password.
  Migration backfills existing NOT NULL constraint removal — no data rewrite.
- Owner records as shell users when email blank + `memberships` linking each owner
  to their unit with `weight` derived directly from that owner's share of community.
- Multi-owner units: same flat repeated on multiple rows, each row carrying that
  owner's sub-share of the community; **sum across all rows must equal 1/1**.
- Dry-run preview shows: # entities to create, # units, # owners (new vs. matched),
  validation errors with row numbers, and total share-sum per unit.
- Atomic commit: either everything seeds in one DB transaction or nothing does.
- Audit log entry per created entity / membership via `entity_audit_log`.

**Out of scope**
- Direct Kataster API integration (admin still copies fields manually or pastes
  text from the LV). Tracked separately — this spec stops at the
  paste/upload boundary.
- **PDF upload and parsing of LV files.** Digital-text LVs work via copy-paste from
  the PDF viewer into the paste-from-LV textarea; no `pdf-parse` / `pdfjs-dist`
  dependency is added. Pasting the text covers the same data with zero added
  complexity.
- **OCR for scanned LVs.** Tesseract / cloud OCR is overkill for this audience —
  fragile on Slovak diacritics, costs money on managed APIs, and the fallback
  (manually typing into the grid) is acceptable for the rare scan-only LV.
  Revisit only if a paying customer surfaces scanned-LV pain.
- ODS upload (XLSX + CSV cover ~99% of admins; LibreOffice can save as XLSX).
- Editing existing units/owners through the importer (create-only; updates remain
  in the entity tree UI).
- Importing board members, voting history, posts, documents.
- Storing PII fields the cadastre exposes (rodné číslo / birth ID) — explicitly
  excluded for GDPR reasons.

## Approach

### 0. Format choice — why XLSX is primary

The audience is non-technical Slovak HOA admins, frequently retired predsedovia
working in Microsoft Excel or LibreOffice Calc. CSV is technically simpler but
hostile to this audience for three concrete reasons:

1. **Excel mangles share fractions.** `1/96` opened in Excel becomes a date
   (`1. januára 1996`) the moment the cell auto-types as `Date`. XLSX lets us
   pre-format share columns as text and the value survives every round-trip.
2. **Slovak Excel exports use a semicolon delimiter and CP1250 encoding by default.**
   A CSV "saved from Excel" on a Slovak Windows machine routinely arrives with
   garbled diacritics (`Vlastn?k`) and a `;` delimiter. XLSX is binary, encoding-free,
   and unambiguous.
3. **No inline help in CSV.** XLSX supports cell comments, frozen rows, data
   validation dropdowns (country, voting method), and conditional formatting on
   required columns. CSV is a flat blob of text.

CSV remains supported under "Advanced" for users who script their own pipelines.
The grid editor (§5) is the actual UX target — the file is just a transport.

### 1. Wizard flow (admin UI)
1. **Step 1 — Structure choice**: radio group picks one of:
   - `community → unit` (single small building, no block/entrance distinction)
   - `community → entrance → unit` (typical Slovak panelák with multiple vchody)
   - `community → block → entrance → unit` (campus / multi-block community)
2. **Step 2 — Start the dataset**: admin picks one of three on-ramps, all of which
   feed the same grid:
   - **Download XLSX template** (primary button) → fills offline → uploads.
   - **Paste from Kataster LV** → textarea, heuristic regex, rows appear in grid.
   - **Start blank** → empty grid with one row of placeholders, type directly.
   CSV download lives under an "Advanced" disclosure.
3. **Step 3 — Edit + validate in grid**: parsed dataset renders as an editable
   table. Per-cell validation fires on edit; errors highlighted with a tooltip.
   Admin fixes errors inline. A summary panel shows counts and total share-sum.
4. **Step 4 — Confirm**: admin clicks "Import". Server re-validates the final
   grid state and runs the atomic seed in one transaction. On success, redirects
   to the new community page.

### 2. Spreadsheet template — dynamic column set
Single flat sheet (XLSX worksheet `Import` or CSV file), one row per (unit, owner)
pair. Hierarchy is implicit via repeated parent fields. Columns marked `*` are
required. In XLSX, share columns (`owner_share_numerator`, `owner_share_denominator`)
are formatted as text; `country` and `voting_method` are dropdowns; required-column
headers are bold and tinted; the first sample row is pre-filled and the header row
is frozen.

| Column | Always | When block on | When entrance on | Notes |
|---|---|---|---|---|
| `community_name*` | ✓ | | | repeated on every row, must be identical |
| `community_address*` | ✓ | | | street name + city; entrance number is NOT part of this |
| `community_ico` | ✓ | | | optional, 8 digits |
| `country*` | ✓ | | | `sk` or `cz` |
| `voting_method*` | ✓ | | | `per_share` / `per_flat` / `per_area` |
| `block_name` | | ✓ | | e.g. `Blok A` |
| `entrance_label` | | | ✓ | e.g. `1`, `3`, `Vchod 1`, `Štúrova 12` — free text |
| `supisne_cislo` | ✓ | | | optional, Kataster súpisné číslo, shared across all entrances of one stavba |
| `unit_number*` | ✓ | | | `Číslo bytu` from LV; unique within (block?, entrance?) |
| `unit_floor*` | ✓ | | | integer; `prízemie` → 0, `1.p` → 1, etc. |
| `unit_area_m2` | (optional) | | | LV does NOT expose this — admin fills later via entity-tree UI or leaves blank |
| `unit_share_numerator*` | ✓ | | | unit's share of community (from LV: `Podiel priestoru na spoločných častiach ... k pozemku`, e.g. `1/96`) |
| `unit_share_denominator*` | ✓ | | | same as above |
| `owner_name*` | ✓ | | | Kataster-formatted full name with titles + maiden name (`Ing. Mária Dratvová r. Štelmachová`) |
| `owner_address` | ✓ | | | optional; `Miesto trvalého pobytu` from LV (may differ from unit address) |
| `owner_email` | ✓ | | | optional; if blank → shell user |
| `owner_phone` | ✓ | | | optional |
| `owner_unit_share_numerator*` | ✓ | | | owner's share **of the unit** (from LV `Spoluvlastnícky podiel`: `1/1`, `1/2`, `3/4`, `7/8`, `1/12`, …) |
| `owner_unit_share_denominator*` | ✓ | | | same as above |

**Source of truth = LV layout.** The CSV/XLSX mirrors what Kataster prints:
- One unit-level row of fields (`unit_number`, `unit_floor`, `unit_share_*`) repeated per owner.
- One owner-level pair (`owner_unit_share_*`) per owner row.
- The importer derives each owner's share of community as
  `unit_share × owner_unit_share` in exact rational arithmetic. Admin never has
  to multiply fractions by hand.

Example: byt 10 in this LV with two equal-share heirs:
- `unit_share = 1/96`, `owner_unit_share = 1/2` (each) → owner-of-community share = `1/192` (each).

Example community of 96 equal units (LV č. 3182):
- Sole owner of byt 1 → `unit_share = 1/96`, `owner_unit_share = 1/1`.
- Two equal heirs of byt 10 → two rows with `unit_share = 1/96`, `owner_unit_share = 1/2` each.
- BSM (spousal co-ownership) appears in LV as one row with both names and `BSM`
  marker — the paste-from-LV parser emits two rows with `owner_unit_share = 1/2`
  each; the wizard pre-fills both names.
- Mixed shares (LV byt 82): five owners at `1/2 + 1/6 + 1/12 + 1/6 + 1/12` of unit
  → five rows, each row's owner-of-community share is the product with `1/96`.

**Multi-owner rows**: a unit with two co-owners appears on two rows; all `unit_*`
fields identical, `owner_*` fields differ.

**Validation (rational arithmetic):**
- For every unit: `Σ owner_unit_share = 1/1` (the unit is fully accounted for among its owners).
- Across the whole file: `Σ (unit_share × Σ owner_unit_share) = 1/1` ≡ `Σ unit_share = 1/1`
  (the community is fully accounted for among its units). One LV per community
  ⇒ the unit shares already encode this from the cadastre.

### 3. Parsing + validation (server)
- Libraries:
  - `xlsx` (SheetJS) for XLSX — reads/writes via `read()` + `utils.sheet_to_json()`,
    same package generates the template via `utils.aoa_to_sheet()` + cell-format
    metadata. MIT licence. Zero native deps.
  - `papaparse` for CSV (handles BOM, quoted commas, semicolon delimiter which
    Excel-SK exports by default).
- File-type dispatch: detect by extension and magic bytes (XLSX = ZIP signature
  `PK\x03\x04`); never trust the extension alone.
- Both adapters normalise to the same in-memory `Row[]` shape; downstream
  validation is format-agnostic.
- Schema: Zod, one row schema per chosen structure. Rejects unknown columns to
  catch swapped templates.
- Share parsing: accepts `n/d`, decimal (`0.01042`), percentage (`1.042%`), and
  Slovak decimal comma (`5,614/100000`). Stored as exact rationals (`bigint`
  numerator + denominator); never converted to `number` until display.
- Cross-row validation:
  - Same `community_name` + `community_address` + `country` on every row.
  - `(block_name?, entrance_label?, unit_number)` is the unit key — every row
    sharing that key must also share `unit_floor`, `unit_share_*`, and (if
    provided) `unit_area_m2`. Mismatch flagged with the offending column.
  - **Per-unit owner-share sum = `1/1`** (each unit fully accounted for among
    its owners). Done in exact rational arithmetic — no floats.
  - **Community share sum = `1/1`**: `Σ unit_share` across unique units must
    equal `1/1`. With one LV per community this is automatic, but the check
    catches typos and copy-paste duplicates.
  - `owner_email` if present must look like an email; otherwise blank → shell
    user with `email = NULL`.
- Returns `{ summary, errors }` where `errors[i] = { row, column, code, message }`.
  The grid maps `row`/`column` directly to cell coordinates so highlighting is
  one-to-one.

### 4. Seeding (transactional)
Inside a single `db.transaction(async (tx) => …)` block:
1. Create `entities` row for community (kind `housing_community`) + matching
   `housing_root_data` row (address, ico, voting_method, country).
2. For each unique block name (if structure includes block) create `housing_block`
   entity; same for `housing_entrance`.
3. For each unique unit create `housing_unit` entity + `housing_unit_data` row.
   `area` ← `unit_area_m2` if present, else `NULL`.
   `shareNumerator/Denominator` ← `unit_share_*` from CSV (read directly from LV,
   not derived). Sanity check: this must equal the sum of `owner_unit_share_*`
   rows for that unit scaled by 1 (i.e. `Σ owner_unit_share = 1/1` per unit).
4. For each owner row: if `owner_email` provided, lookup `users` by lowercased email;
   if found → reuse, else insert real user (status `pending`, no password yet —
   pairing flow sets it). If `owner_email` blank → insert shell user with
   `email = NULL`, `status = 'pending'`, no password, `name` from CSV. Then create
   a `memberships` row with
   `weight = floor((unit_share × owner_unit_share) * SCALE)` evaluated as exact
   rationals (`(unit_num × owner_num) / (unit_den × owner_den)`), where `SCALE`
   is a project-wide constant (proposed `1_000_000`) so two BSM co-owners each
   at `1/2` of a `1/96` unit get equal integer weights summing to the unit's
   total. `SCALE` is documented next to `memberships.weight`.
5. Append one `entity_audit_log` entry per created entity / membership, action
   `entity.create` or `membership.create`, `actorUserId` = importing admin.
6. Path + depth + rootId on each entity computed via existing `src/lib/entity-tree.ts`
   helpers — this importer must not duplicate that logic.

### 5. UI surface
- New route: `/[locale]/dashboard/admin/import` (admin-only, gated by middleware).
- Server actions in `src/app/[locale]/dashboard/admin/import/actions.ts`:
  - `generateTemplate(structure, format)` → returns XLSX `Blob` (default) or CSV
    string for download. Format selector lives in the wizard, XLSX selected by
    default.
  - `parsePaste(text)` → runs the Slovak LV heuristic regex against the pasted
    text and returns `Row[]` (best-effort; missing fields left blank for the admin
    to fill in the grid).
  - `previewImport(rows)` → validates a rows array (from upload, paste, or grid
    edits) and returns dry-run JSON.
  - `commitImport(previewToken)` → re-validates and seeds in transaction.
- `previewToken` is a short-lived signed token over the validated payload (so the
  preview shown is the same payload that gets committed — no double-upload).
- **Grid component**: client component built on `@tanstack/react-table` with
  custom cell editors per column (`text`, `number`, `dropdown`, `share`). State
  lives client-side; on edit, the row is re-validated locally for cheap checks
  (required fields, format) and the full server `previewImport` re-runs on a
  debounce (~400 ms) for cross-row checks. The grid shows error pills inline and
  a sticky summary bar (total share sum, # errors, # warnings).
- **Paste affordance**: a "Vložiť z LV" button opens a modal with one textarea and
  a "Rozpoznať" submit. Submit calls `parsePaste`, appends recognised rows to the
  grid, closes the modal. No partial state, no progress bar — paste is fast enough
  to be synchronous.

### 6. i18n
All wizard copy + validation messages keyed under `Import` namespace in
`messages/sk.json` (default) + `messages/en.json`. Per project rule: no hardcoded
strings.

### 7. Paste-from-Kataster LV heuristic

Slovak LV (List vlastníctva) PDFs emitted by ÚGKK follow a stable, semi-structured
layout (verified against LV č. 3182, Poprad — Dostojevského 2514, 6 vchody,
96 bytov, 120 vlastníkov, 45 pages). The admin opens the LV in their PDF viewer,
selects all (`Ctrl+A`), copies, and pastes the entire LV text into a single
textarea. `parsePaste(text)` walks the text and emits draft rows.

**Real LV structure (one repeating unit block):**
```
Vchod (číslo)
1
Poschodie
prízemie                ← or 1, 2, …, 7
Číslo bytu
1
Podiel priestoru na spoločných
častiach a spoločných zariadeniach
domu, na príslušenstve a
spoluvlastnícky podiel k pozemku
1/96                    ← unit's share of community
Súpisné číslo
2514
Miestna časť
Iné údaje: Bez zápisu
Poradové
číslo
Titul, priezvisko, meno, rodné meno / Názov
Miesto trvalého pobytu / Sídlo
Dátum narodenia, rodné číslo / IČO / Iný identifikačný údaj
Spoluvlastnícky
podiel
2 Hricová Petra, Dostojevského 2514/1, Poprad, PSČ 058 01, SR, Dátum narodenia: 18.09.1976  1/1
Titul nadobudnutia:
Dohoda o vyspor.BSM - V 3191/2001
…
Správca - Neevidovaní
Iná oprávnená osoba - Neevidovaní
```

**Parsing algorithm:**

1. **Header pass** — extract LV-level fields (`VÝPIS Z LISTU VLASTNÍCTVA č. {N}`,
   `Okres`, `Obec`, `Katastrálne územie`, súpisné č., parcela, `Popis stavby` for
   `community_address`). One row in the LV header table identifies the building.

2. **Unit-block pass** — split the text on the recurring header sentinel
   `Vchod (číslo)\n` and parse each block:
   - `Vchod` = line after `Vchod (číslo)\n`
   - `Poschodie` = line after `Poschodie\n`; normalise `prízemie → 0`,
     `1.p` / bare `1` → `1`, etc.
   - `Číslo bytu` = line after `Číslo bytu\n`
   - `unit_share` = line after the multi-line "Podiel priestoru …
     spoluvlastnícky podiel k pozemku" label (regex captures the next non-empty
     line matching `\d+/\d+`)
   - `Súpisné číslo` = line after `Súpisné číslo\n`

3. **Owner pass** within each unit block — between the `Spoluvlastnícky\npodiel\n`
   label and the closing `Správca - Neevidovaní` sentinel, repeatedly match:
   ```
   /^\s*(?<por>\d{1,3})\s+(?<rest>.+?)\s+(?<num>\d+)\s*\/\s*(?<den>\d+)\s*$/m
   ```
   where `rest` may span multiple physical lines (PDF wrap). Greedy join lines
   until the share fraction is captured at line-end.
   Then split `rest` on `, Dátum narodenia:` to separate `owner_name + address`
   from DOB. The DOB is discarded (PII, GDPR).

4. **BSM expansion** — if `rest` contains `, BSM` and `\sa\s` between two
   capitalised tokens, split the name into two owners and emit two draft rows
   with `owner_unit_share = (num/den) / 2` each.

5. **Output** — `Row[]` shape matching the spreadsheet template. Per row:
   `entrance_label`, `unit_number`, `unit_floor`, `unit_share_*`, `supisne_cislo`,
   `owner_name`, `owner_address` (left of `, Dátum narodenia:`), and
   `owner_unit_share_*`. Email + phone always blank. Area always blank.

**Design rules for the heuristic:**

- **Never throws.** Unparsable text → empty `Row[]` and a friendly
  "Nepodarilo sa rozpoznať žiadneho vlastníka." toast. The admin can always type
  rows directly in the grid.
- **No PDF dependency.** Contract is "pasted text in, draft rows out." Whether
  the admin pasted from a PDF, ran their own OCR, or typed by hand is irrelevant.
- **No network calls.** Regex is local; no Kataster API, no AI assist in v1.
- **Output is draft only.** Same validation rules apply once rows land in the
  grid — paste is typing-assistance, not a trust boundary.
- **Order-independent.** LV č. 3182 lists entrances in the order
  `1, 11, 3, 5, 7, 9` (lexical, not numeric). The parser must not assume
  sequential entrance/unit numbers.
- **No DOB stored.** Date of birth is captured by the regex only as a delimiter
  to split `owner_name` from `owner_address`; it is never persisted (GDPR
  exclusion, same rationale as rodné číslo).
- **Duplicate owners across units are normal.** Poradové č. is reused when one
  person owns multiple flats. The owner-merge logic in §4 step 4 (lookup by
  lowercased email) does not apply since LV has no emails — duplicates become
  separate shell users, and the entity-tree UI lets admin merge later. Document
  this in the import preview ("Pozn.: rovnaké meno na viacerých riadkoch ostane
  ako samostatný vlastník; po importe ich môžete zlúčiť v správe vlastníkov.").
- **Unit address is derived, not captured.** Unit address is
  `{street from LV header} {súpisné}/{vchod}` (e.g. `Dostojevského 2514/1`),
  not the owner's `Miesto trvalého pobytu`. The parser computes this and stores
  it on the unit entity; the owner's trvalý pobyt goes into `owner_address`.

## Acceptance Criteria

- [ ] Admin can choose between three structure variants and the downloaded
      template's columns reflect that choice (block/entrance columns dropped when off).
- [ ] XLSX is the default download format; CSV download is available under an
      "Advanced" disclosure.
- [ ] XLSX template opens in Excel, Numbers, and LibreOffice Calc with the share
      columns formatted as text — pasting `1/96` into a share cell stays as `1/96`
      after saving and reopening (no auto-conversion to a date).
- [ ] XLSX template's `country` and `voting_method` columns expose dropdowns
      sourced from the same enums the server validates against.
- [ ] Uploading a well-formed XLSX **or** CSV for a 30-flat panelák with 2 entrances
      produces a dry-run preview listing 1 community, 2 entrances, 30 units, N
      owners, 0 errors, and "total share = 1/1".
- [ ] Round-trip diacritics test: an XLSX saved on Slovak Windows Excel with names
      containing `ľščťžýáíéúô` round-trips through the importer with bytes
      preserved (no `?` or mojibake) and the same is true for a CSV exported from
      that Excel via "Save as → CSV UTF-8".
- [ ] Uploading a file with one duplicate unit row that disagrees on `unit_floor`
      or `unit_area_m2` shows that row in the grid highlighted on the offending
      cell; admin can fix it inline and re-preview without re-uploading. No DB
      writes occur until "Import" is clicked.
- [ ] Uploading a file whose total `owner_share_*` sum across all rows ≠ `1/1`
      shows a "community share != 1/1, got X/Y" error and blocks the import.
- [ ] Share-format leniency: a single sheet mixing `1/96`, `5614/100000`, `0.01042`,
      and `1,042%` parses successfully; the preview shows every value as a reduced
      fraction.
- [ ] Pasting the full text content of a sample Kataster LV into the
      "Vložiť z LV" textarea appends draft rows to the grid pre-filled with
      `entrance_label`, `unit_number`, `unit_floor` (with `prízemie → 0`),
      `unit_share_*`, `owner_name`, `owner_address`, and `owner_unit_share_*`.
      Email, phone, and area remain blank. Unparsable paste content produces an
      empty result with a friendly toast and never throws.
- [ ] **LV č. 3182 acceptance test (Dostojevského 2514, Poprad, 96 bytov, 120
      vlastníkov, 6 vchodov):** pasting the full 45-page LV text appends ≥ 130
      draft rows (96 units × ≥ 1 owner, BSM-expanded). Spot checks:
      (a) byt 1 → 1 row (Hricová Petra, 1/1);
      (b) byt 4 → 2 rows (Dlugoš Martin, Anna Dlugošová, BSM-split to 1/2 each);
      (c) byt 10 → 2 rows (Štolc Ondrej × 2, each 1/2);
      (d) byt 82 → 5 rows summing to 1/1;
      (e) entrance order `1, 11, 3, 5, 7, 9` preserved as encountered; parser
          does not silently re-sort.
- [ ] Per-unit owner-share sum must be `1/1`; an LV row missing a co-owner is
      flagged in the grid with "Súčet podielov vlastníkov v byte ≠ 1/1".
- [ ] Date of birth is never persisted in any column; assert via DB query after
      LV-paste import that no `users` row contains a parsed DOB string.
- [ ] `unit_area_m2` is optional everywhere: a row with blank area validates and
      seeds with `housing_unit_data.area = NULL`.
- [ ] Starting blank (no upload, no paste) and typing one community + one unit +
      one owner directly into the grid commits successfully.
- [ ] `housing_unit_data.area` matches `unit_area_m2` for every imported unit;
      `housing_unit_data.shareNumerator/Denominator` equals the reduced sum of
      that unit's owner shares (e.g. unit with two co-owners at `1/192` stores
      `1/96`).
- [ ] Confirming a clean preview seeds entities, units, owners, memberships in a
      single transaction; killing the DB connection mid-transaction leaves zero
      rows behind (verified via integration test).
- [ ] Owner with blank `owner_email` becomes a shell user with `email=NULL` and
      `status='pending'`; existing auth flows still work (no row tries to query
      by email and crash on the null).
- [ ] Owner with provided `owner_email` matching an existing user reuses that user
      and creates only the membership.
- [ ] `memberships.weight` is computed directly from each owner's
      `owner_share_*` × `SCALE`; two co-owners of one unit each at `1/192` of
      community get equal weights that sum to the sole-owner-equivalent weight.
- [ ] Each created entity and membership has a corresponding `entity_audit_log`
      row with `action='entity.create'` / `'membership.create'` and the importing
      admin as `actorUserId`.
- [ ] All wizard copy renders in `sk` and `en`; no hardcoded strings in components.
- [ ] Importer is reachable only with `platform_role='superadmin'` or `users.role='admin'`
      — owners and tenants get 403.

## Project Context

**Schema touched** (no new tables — reuses entity model from RES-20260501-002):
- `entities`, `housing_root_data`, `housing_unit_data`, `memberships`,
  `entity_audit_log`, `users`.
- **Migration**: drop NOT NULL on `users.email`. Keep the unique index but make
  it a partial index (`WHERE email IS NOT NULL`) so multiple shell users with NULL
  email can coexist. Audit `auth.ts`, `lib/permissions.ts`, NextAuth credentials
  provider, password reset, registration, and email verification paths for any
  code that assumes a string email — fix or guard before running the migration.

**Tree helper to reuse**: `src/lib/entity-tree.ts` (path / depth / rootId
computation) — the importer must not parse or build `entities.path` itself.

**Kataster mapping cheat-sheet** (verified against LV č. 3182, Poprad,
2026-05-11; for the help text shown in the wizard):
- `Vchod (číslo)` → `entrance_label`.
- `Číslo bytu` → `unit_number`.
- `Poschodie` → `unit_floor` (`prízemie` → 0, bare `1`/`2`/… → integer).
- `Podiel priestoru na spoločných častiach … k pozemku` → `unit_share_*`
  (the unit's share of community; constant within an LV when all flats are
  equal, e.g. `1/96`).
- `Súpisné číslo` → `supisne_cislo` (shared across all entrances of one stavba).
- `Vlastník` name (with titles + `r. {rodné meno}`) → `owner_name`.
- `Miesto trvalého pobytu` → `owner_address` (may differ from unit address —
  inherited flats, secondary residence, etc.).
- `Spoluvlastnícky podiel` → `owner_unit_share_*` (owner's share **of the unit**,
  e.g. `1/1`, `1/2`, `7/8`, `1/12`).
- `, BSM` token in a single owner row containing two capitalised names joined
  by ` a ` → split into two owners, each at half of the listed share.
- **`Výmera podlahovej plochy bytu` is NOT present in a standard LV.** Area
  comes from a separate `Výpis z katastra nehnuteľností - bytový dom` or from
  the technical drawings. Importer treats area as optional and lets admin fill
  it later from a different source.
- **Date of birth, rodné číslo, IČO are NOT imported** — GDPR exclusion. They
  serve only as parse delimiters and are dropped before persistence.

## Notes

- **Migration risk — nullable `users.email`**: blast radius spans NextAuth credentials
  provider (lookup-by-email), invitation/pairing flows, password reset, registration,
  email verification, and any UI that renders `user.email` directly. Sub-task list
  to land before the migration: (a) make every email lookup explicitly filter
  `email IS NOT NULL`; (b) make every UI render `user.email ?? user.name` or
  similar; (c) prevent shell users from being targeted by login (status `pending`
  + null email already blocks credentials sign-in, but verify with a test).
- **Share scale constant**: pick `SCALE = 1_000_000` and document it next to
  `memberships.weight`. Changing it later requires a migration that recomputes
  every weight — pin the value in a single `src/lib/voting.ts` constant.
- **Kataster format edge case**: cadastre share strings sometimes use Slovak
  decimal comma (`5614,32/100000`) — parser must accept both `,` and `.`, and
  also bare integers (treat as denominator `1`).
- **Out-of-band**: a future spec can wrap a Kataster API client around this
  importer (auto-fill the grid from a parcel number) — the grid/`Row[]` shape is
  the seam, so the addition is purely additive.
- Cross-cutting i18n rule applies — all `Import` namespace keys must land in both
  `messages/sk.json` and `messages/en.json` in the same commit as the UI.
- **2026-05-11 — XLSX promoted to primary format, in-grid editing added.** Original
  spec was CSV-only with a JSON dry-run preview. Audience pressure (retired
  predsedovia, Excel-on-Windows, fraction columns mangled into dates) made CSV the
  wrong default. XLSX + a `@tanstack/react-table`-backed editable grid keeps the
  technical seam (`Row[]` → validator → seed transaction) identical while giving
  non-technical admins a spreadsheet-shaped workflow they already know.
- **Why no PDF parsing / OCR.** Kataster LVs are digital-text PDFs; the value of a
  PDF parser over `Ctrl+A` → paste is zero for the same input. Scanned-LV OCR
  needs Tesseract or a paid API, both of which are fragile on Slovak diacritics
  and add a permanent maintenance cost for an edge case the manual-grid fallback
  already covers. Revisit only if a paying customer surfaces scanned-LV pain;
  even then, OCR can run *outside* the importer (e.g. user runs their own OCR,
  pastes the text), keeping this code path simple.
- **Library choice — SheetJS (`xlsx`) vs `exceljs`.** `xlsx` is smaller, MIT, has
  better data-validation/dropdown support per cell. `exceljs` has a nicer stream
  API but is heavier. Default to `xlsx`; reconsider if bundle impact on the
  server build is significant.
- **Grid library — `@tanstack/react-table` vs Handsontable vs AG Grid.** Tanstack
  is headless (we own the cells), free, and integrates cleanly with the project's
  React 19 / Tailwind stack. Handsontable's free tier is non-commercial only —
  unusable for open-housing. AG Grid Community works but is heavier than needed
  for a single-page wizard. Default to Tanstack.
- **2026-05-11 — verified against real LV č. 3182 (Dostojevského 2514, Poprad).**
  Walked the full 45-page text. Three findings reshaped the spec:
  1. **No area column in LV** — `unit_area_m2` made optional. Was previously a
     required column.
  2. **Share model flipped** — LV gives `unit_share_of_community` (per unit) and
     `owner_unit_share` (per owner), not pre-multiplied `owner_share_of_community`.
     Renamed columns and changed seeding to multiply rationals on the server.
     Friendlier for the admin: copy fractions verbatim from LV.
  3. **BSM expansion needed** — spouses listed as one row in LV (`Manžel a
     manželka, …, BSM`) must become two owner rows in our model. Parser handles
     this; spec AC pins down byt 4 (`Dlugoš Martin a Anna Dlugošová, BSM`) as a
     canonical fixture.
  Also confirmed: emails and phones never present in LV; DOB present but
  excluded from persistence; same owner can appear under multiple poradové č.
  in adjacent units (Klein, Štolc, Simčisková, Polák Dušan twice in byt 87).
- **Save the LV as a test fixture** when implementing — e.g.
  `tests/fixtures/lv-3182-poprad.pdf` + extracted `tests/fixtures/lv-3182-poprad.txt`.
  Don't commit owner PII to the public repo; use a redacted copy with names
  replaced by `Vlastník N` and addresses by `Adresa N` for OSS fixtures, keep
  the real LV in a private fixture for cloud-side regression tests.

