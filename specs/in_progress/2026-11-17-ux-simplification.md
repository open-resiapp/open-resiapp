---
spec_id: BYT-20261117-002
title: "UX simplification: role-based shell, task-based pages, confirmed e-vote"
status: in_progress
created: 2026-11-17
updated: 2026-11-17
author: Filip
owner: filipvnencak
project_type: node
depends_on:
  - RES-20260609-001   # onboarding wizard / import out of sidebar
tags: [ux, navigation, accounting, voting, community, owners, settings, passkey, schema-change]
feature_branch: "feat/ux-simplification"
---

## Goal

The app is organised by data type, not by task. An owner (often 50–75, on a phone, visits a few
times a year) lands on a home screen that shows neither the running vote nor what they owe. The
volunteer chairman gets 15 equal accounting tiles, five ways to add a person and developer pages.

Make the app effortless: role-based navigation with at most 4 owner destinations, a task-first
home, one page per job, plain Slovak, and an e-vote that is actively confirmed (passkey or e-mail
link) as `docs/domain/voting.md` requires.

Evidence: 140 screenshots (admin + owner, 1440 px + 390 px) and a 7-part audit on 2026-11-17.
No customer interviews exist yet — this is heuristic, to be validated with 5 owners 65+.

## Decisions (Filip, 2026-11-17)

1. Komunita is **merged** into one feed with the notice board; no separate hub.
2. E-vote confirmation: **passkey and e-mail link**, both.
3. Modules and External connections leave the chairman's settings; they live behind one
   "Pokročilé" link.

## Hard constraints

- Behaviour-preserving for legally regulated code: `modules/voting/src/{engine,rules,results.ts}`,
  `VotingMinutesPDF`, `modules/accounting/src/engine/*`, accounting PDFs, `ConsentGate` logic.
  Change their shells only.
- Statutory features are demoted, never removed: fund transfers (§10 ods. 3), journal and annual
  statements approval, debtor list, right to inspect (§11 ods. 6), opening balance.
- No schema change except the passkey table in Phase 6. No runtime DDL, no background loops,
  no in-memory state that must be shared between replicas.
- All strings through next-intl in `sk`, `en`, `cs`. Domain errors as codes.
- Data fetching: resolve reference data once (server layout → context); no duplicate calls on a
  screen; nothing new is live/polled.
- Senior baseline: tap targets ≥ 44 px, body text ≥ 16 px (`text-base`), contrast ≥ 4.5:1, one
  primary button per screen, every icon has a visible text label, no horizontal page scroll at
  390 px.
- Routes keep working: old URLs redirect, nothing 404s.

## Phases

### Phase 0 — defects (independent of the redesign)

- [ ] `/accounting/inspect` renders (wrapper page exists; today the folder is empty → 404).
- [ ] `zod` declared in `package.json`.
- [ ] No raw i18n key reaches the UI: `Templates.<slug>.name` falls back for legacy kind slugs
      (`housing_community` → hoa), `CommunityInfo.role.*` and `BoardMembers.role_*` cover every
      board role incl. treasurer, in all three locales.
- [ ] community-info shows "čaká na schválenie" only to pending users.
- [ ] Profile no longer shows the internal legal note (`prefEDeliveryLegal`).
- [ ] Transfers page: no "(AC 416/417)", no untranslated "re-flag". Journal shows translated
      entry-type labels instead of raw codes.
- [ ] Owner opening `/accounting/vyuctovanie` gets their own settlement or a friendly
      "not ready yet" state, never a bare error.
- [ ] Voting detail does not overflow at 390 px. Closed voting shows results/minutes or an
      explicit "no items" state.
- [ ] New voting offers only quorum types valid for the community's country and voting type.
- [ ] A module that holds data cannot be uninstalled from the UI.
- [ ] Login has a working "Zabudli ste heslo?" path (only if a reset flow exists server-side;
      otherwise report).
- [ ] Dead code removed: `src/db/seed.ts` + `db:seed`, unused `@tanstack/react-table`.

### Phase 1 — server shell and shared context

- [ ] Dashboard layout resolves session, building, branding, enabled modules, current entity,
      consent status and onboarding status once on the server and provides them through a
      `ShellContext`.
- [ ] Sidebar, EntitySwitcher, OnboardingBanner, ConsentGate, `useCommunityKinds` read from the
      context — no client fetch for these on mount.
- [ ] Consent gate is a full-screen step without navigation; children are not blocked on a
      client round trip.

### Phase 2 — UI kit (`src/components/ui`)

- [ ] `Button`, `Card`, `Modal` (focus trap, Escape, `aria-modal`), `ConfirmDialog`, `Field`,
      `Input`, `Select`, `Textarea`, `PageHeader`, `EmptyState`, `Tabs`, `Badge`, `Icon`
      (one SVG set, no emoji as UI icons), `ActionMenu`.
- [ ] Semantic colour tokens in `globals.css` replace the blue→gray remap for kit components;
      dark mode handled inside the kit.
- [ ] New and rewritten pages use the kit. `confirm()` calls are replaced by `ConfirmDialog`
      with the consequence stated.

### Phase 3 — role-based navigation

- [ ] Owner: **Domov · Hlasovanie · Moje platby · Dom**. On mobile a visible bottom tab bar,
      no hamburger. Profile and logout in an avatar menu.
- [ ] Board/admin: **Domov · Oznamy · Hlasovanie · Financie · Vlastníci · Dokumenty ·
      Nastavenia**. Sidebar on desktop, drawer on mobile; badge with the count of items waiting.
- [ ] Nav is one typed config filtered by permission, board role and enabled module.
- [ ] Label "Dashboard" is gone (Domov).

### Phase 4 — owner experience

- [ ] **Domov (owner)**, in order: running vote card with deadline and one button (or
      "Hlasovali ste"); balance card (owe / all paid / overpaid) with "Ako zaplatiť"; deadlines
      (reading window, settlement ready); latest 3 notices; board contacts. No "Nová udalosť".
- [ ] **Moje platby**: one screen — status sentence, monthly amount with IBAN, VS and PAY by
      square QR, last 3 payments, yearly settlement result + PDF, meter entry only inside the
      reading window, link "Ako hospodári dom" (inspect). An owner with one unit never sees a
      unit list. Interest table collapsed, full ledger behind "Celá história".
- [ ] **Dom**: notices feed, documents, board contacts, neighbours directory.
- [ ] **Domov (board)**: "Čo treba teraz" list (pending registrations, unmatched payments, unpaid
      invoices, running vote turnout, overdue inspections) + latest notices.

### Phase 5 — board pages

- [ ] **Financie**: landing = 3 numbers + ordered checklist; sections *Platby od vlastníkov*
      (bank import/matching, unmatched, manual entry in a dialog, units with balances),
      *Faktúry a výdavky* (upload-first, form in a dialog with supplier/amount/date/file visible,
      one "Uhradiť" action + overflow menu), *Ročné úlohy* (monthly fees, meters, settlement,
      annual statements approval), *Nastavenia a pre účtovníka* (IBAN, variable symbols, debtor
      publication, journal, transfers, opening balance). Revisions surface only as a deadline
      alert plus a link. Every old accounting URL still resolves.
- [ ] Plain wording: predpis → "Mesačné platby", párovanie → "Priradiť platbu k bytu",
      okruh → "Fond", otváracia súvaha → "Počiatočné zostatky".
- [ ] **Vlastníci**: one table with a status chip (Nemá účet · Pozvaný · Aktívny · Čaká na
      schválenie), one primary "Pridať vlastníka", an inbox "Čaká na vás (N)" for registrations.
      The admin-types-a-password form is removed. Registration QR is reachable from this page.
- [ ] **Oznamy / feed**: one feed (notice board + events + help + sale/gift) with filter chips and
      one "+ Nový"; owners can post resident types, only the board posts "Oznam". Create form has
      3–4 fields per type. `/komunita/*` redirects into the feed. No schema change — the feed
      reads both existing APIs. Directory stays, linked from Dom.
- [ ] **Nastavenia**: Spoločenstvo (incl. logo) · Budova a byty · Orgány správy · Hlasovanie.
      Modules, External connections, Import and Setup guide sit behind "Pokročilé".
- [ ] **Profil**: account card, password behind a click, two toggles (settlement by e-mail,
      share contact in directory), consents behind a link; vote and notice notifications default on.
- [ ] **Nové hlasovanie**: template → items → how; no "Stav" field (dates decide); default end
      +14 days.
- [ ] **Running vote (board)**: turnout, list of units that have not voted with "Zapísať listinný
      hlas", close with confirmation, results and minutes after closing.

### Phase 6 — confirmed e-vote (schema change)

- [ ] Casting flow on mobile: one item per screen with full-width ZA / PROTI / ZDRŽIAM SA →
      review ("Hlasujete za byt 101") → confirm → receipt with date, "Zmeniť do …" and the hash
      behind "Podrobnosti".
- [ ] A ballot is only recorded after an active confirming action bound to the exact ballot
      content: WebAuthn assertion (passkey) **or** a single-use e-mail link. Session alone is
      rejected by `POST /api/ballots`.
- [ ] Owner can register a passkey inline during the first vote and manage passkeys in Profil
      (list, delete — undo path covered).
- [ ] Challenges and e-mail tokens are stateless and signed (HMAC, short expiry, bound to voter,
      voting, unit and ballot digest) — no per-node memory. A stale e-mail token cannot overwrite
      a newer ballot.
- [ ] Paper votes and mandates are unaffected. Confirmation method and time are stored with the
      ballot and available to the minutes/audit bundle.
- [ ] Unmarked items are never labelled as abstention.

**DB impact (needs `pnpm db:migrate` by Filip, not applied by the implementer):**
one new table `webauthn_credentials` (user FK `onDelete: cascade`, credential id unique, public
key, counter, transports, created/last used) and, only if not already present, nullable
`confirmation_method` / `confirmed_at` on `mod_voting_ballots`. Generated with
`drizzle-kit generate`; additive, no backfill, no lock beyond the brief `ALTER TABLE ADD COLUMN`.

## Out of scope

- Merging the post tables / projects into one model (schema work, separate spec).
- Route language unification, `legacy-compat` removal, module `dist/` pipeline.
- UI tests / CI wiring for the golden scripts.

## Verification

`npx tsc --noEmit -p .` clean. Manual pass by Filip on both roles at 390 px and 1440 px.
