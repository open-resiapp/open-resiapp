---
spec_id: BYT-20260512-002
title: "Accounting module for SVB chairman/treasurer to track HOA finances"
status: spec
created: 2026-05-12
updated: 2026-06-09
author: byt-app
owner: byt-app
last_verified: 2026-06-09
project_type: node
depends_on: []
related_handoffs: []
tags: [accounting, finance, hoa, svb, svj, treasurer, fond-oprav, vyuctovanie]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Build a chairman/treasurer-first accounting module for Slovak SVB and Czech SVJ that hides double-entry complexity behind domain terms (predpis, úhrada, fond opráv, vyúčtovanie) while staying legally compliant. Owners get transparent, drill-down access to every cent of their own unit's flows.

Strategic wedge vs. incumbents (DOMUS, SSB2000, DOMSYS): we are the only product that unifies **voting + accounting** — a schôdza decision on FPÚO contribution rate auto-updates next month's predpis and the ledger; an approval of an extraordinary repair flows directly into expense booking with audit trail.

## Scope

### In scope (legally mandatory or core to wedge)

**Accounting engine**
- Internal **double-entry bookkeeping** with Slovak/Czech non-profit chart of accounts (Opatrenie MF SR č. MF/24342/2007-74 for SK; mikro účetní jednotka per zák. 563/1991 Sb. for CZ). User never sees debit/credit terminology — exposed only via optional "Pohľad účtovníka" toggle.
- **Three separately-tracked účetní okruhy**: (a) FPÚO / příspěvek na správu domu, (b) zálohy na služby a plnenia, (c) CZ-only: príspěvek na vlastní správní činnost (§1180 ods. 2 NOZ — equal per jednotka, statutorně neměnné).
- **Samostatné analytické účty per dom** (§7b ods. 4 / §8 ods. 3 zák. 182/1993) when a SVB spravuje viacero domov.
- Transient FPÚO → služby cover (SK §10 ods. 3) flagged and tracked for mandatory return.

**Predpis (fee schedule)**
- Annual schedule with monthly recurrence (not 12 monthly invoices — matches SK/CZ standing-order reality).
- Per-service rows with per-unit allocation key: `share` (spoluvlastnícky podiel), `area_m2`, `persons`, `flat_count_equal`, `fixed`.
- Mass-recompute on rate change with per-byt preview before publish.
- Mid-year revision support (effective_from/to); preserves history for vyúčtovanie.
- PDF export per owner with variabilný symbol prominently displayed.
- **PAY by square QR (SK)** + **QR Platba (CZ, SPAYD)** embedded as static QR on monthly predpis PDF (pre-fills trvalý príkaz: IBAN, suma, VS); dynamic QR (specific amount + VS + reference) on nedoplatok rows in vyúčtovanie PDF.

**Opening-balance correction tool**
- Treasurer-onboarding flow: enter banka + pokladnica + per-unit FPÚO/zálohy zostatok ako k 1.1. (or module-install date).
- System runs **balance invariant check**: `Banka + Pokladnica = Σ FPÚO + Σ Zálohy + Výsledok hospodárenia min. rokov`.
- If unbalanced, treasurer MUST post a korekčné journal entry (default to `Nerozdelený výsledok minulých rokov`) before any other booking is permitted. Block on error, not warn.
- All opening entries flagged as `source_type = opening_balance`; visible separately in Pohľad účtovníka.

**Payment tracking**
- Manual entry + automated bank import.
- **CAMT.053 XML (SBA SK profile + ČBA CZ profile)** as primary import format — one parser covers all SK banks.
- **Fio banka REST API** as zero-friction live-poll path (per-account read token).
- ABO/GPC + MT940 as long-tail fallback (phase 2).
- Auto-match by VS (primary), ŠS (secondary), counterparty IBAN + amount + name (tertiary).
- Confidence-scored match suggestions; manual override UI.
- Idempotency via bank-issued `AcctSvcrRef` as `external_tx_id UNIQUE`.

**Expense ledger**
- Service-aligned categories that auto-map to predpis services (teplo, voda, výťah, fond-opráv-čerpanie, revízie, …) — NOT generic GAAP categories on the surface.
- Required fields: supplier name, DIČ/IČ DPH, IBAN, invoice number, date, amount netto, **DPH rate + amount, amount brutto** (brutto je delený medzi vlastníkov pri rozúčtovaní — i keď SVB nie je platca, dodávateľ účtuje DPH), attachment (PDF/scan).
- OCR-assist on receipt scan (phase 4); manual entry primary.
- Booking to FPÚO pool or services pool; transient cross-pool transfer flagged.
- **Technical-audit link** — kategórie typu `REVIZIA_*` (elektro, plyn, komíny, výťah, hasiace prístroje, bleskozvod, …) majú povinné pole `next_inspection_due_at`. Dashboard "Vyžaduje pozornosť" zvýrazňuje revízie expirujúce v ≤ 60 dňoch; expirované sa eskalujú do upozornenia chairman + notification do app.
- **Dodávateľ directory** s auto-fill: zadanie IČO → fetch z **FinStat API (SK)** / **ARES API (CZ)** → názov, adresa, IBAN, DIČ, **flag "v zozname dlžníkov DPH/odvodov"** (chráni pred ručením za DPH ak by SVB bolo platcom; aj pri neplátcoch zobrazujeme ako varovanie).
- IBAN validation (MOD-97 checksum + country prefix) na zadaní; IČO/DIČ check via FinStat/ARES.

**Inbox pre dodávateľské faktúry (collector email)**
- Každé SVB inštanciu dostane unikátny prijímací email (napr. `svb-{hoa_id}@inbox.byt-app.com`).
- Dodávatelia posielajú PDF faktúr priamo na túto adresu.
- Backend (cron / webhook from SES/Postmark/Mailgun inbound) parsuje attachments, beží OCR (extract: IBAN, suma, VS, IČO dodávateľa, dátum splatnosti, dátum dodania).
- Faktúry padajú do `expense_inbox` queue; treasurer ich v UI schvaľuje, kategorizuje, pripojí na expense — jedným klikom.
- Bezpečnosť: from-domain allowlist konfigurovateľný; spam-filter + virus-scan na attachmentoch.

**Heat / TUV rozúčtování (CZ-mandatory per vyhláška 269/2015 ve znění 376/2021)**
- Configurable základní/spotřební split (40–60 % default, adjustable by PENB).
- Per-jednotka započitatelná plocha + indikátory tepla + TUV vodoměry input.
- Auto-apply ±20 % / +100 % korekce.
- SK: same engine, optional (zák. 657/2004, vyhláška 240/2016).

**Per-unit ledger ("Karta bytu")**
- Running-balance table: Date, Description, Predpis, Úhrada, Zostatok.
- Drill-down: each row → source document (bank line, invoice, manual entry).
- Primary screen after dashboard; matches Excel mental model.

**Sankcie — úroky z omeškania**
- Engine počíta úrok z omeškania per neuhradenú splátku predpisu, na dátum X (default = dnes; configurable for reklamačné listy).
- SK: nariadenie vlády SR č. 87/1995 Z.z. — sadzba = repo sadzba ECB + 5 p.b., počítaná denne. Pravidelne aktualizovaný `interest_rate_history` seed.
- CZ: nařízení vlády č. 351/2013 Sb. — repo sazba ČNB + 8 p.b., per pololetie.
- Pravidelne aktualizované sadzby seedom; konfigurovateľné per HOA (stanovy môžu mať vlastnú sadzbu, max do zákonného maxima).
- Generovanie **upomienky** (PDF) per nedoplatok: tabuľka neuhradených splátok s vypočítanými úrokmi k dátumu, sumár, **dynamic QR na úhradu**, zákonné poučenie.
- Auto-booking úrokov nie je default (kedy zaúčtovať = rozhodnutie predsedu); engine je read-only kalkulátor + PDF generator. Manuálne zaúčtovanie cez predefinovaný journal entry kind.

**Cash-flow projection**
- Graf predpokladaného zostatku FPÚO + bankového účtu na nasledujúcich 6 mesiacov.
- Input: existujúce predpisy (future occurrences from `effective_from/to`) + historical úhrada rate (% z predpisu reálne zaplatené, vypočítané z posledných 12 mesiacov) + známé budúce výdavky (zmluvy s recurring expense, schválené opravy).
- Slúži pre treasurera na rozhodnutie typu "máme na účte 10k, môžeme teraz opraviť strechu za 8k?". Drill-down per mesiac do tabuľky predpokladaných príjmov a výdavkov.
- Nie je accounting forecast (žiaden D/C posting); čisto vizualizačná vrstva nad existujúcimi datami.

**Ročné vyúčtovanie / vyúčtování služeb**
- SK deadline: **31. mája** (zák. 182/1993 §7b ods. 3 / §8a ods. 2). System alerts 30 days before; surfaces sanction (§8a ods. 4 — strata nároku na platbu za správu).
- CZ deadline: **4 mesiace po konci zúčtovacieho obdobia** (zák. 67/2013 §7 ods. 1).
- Per-unit statement: skutečné náklady per služba, přijaté zálohy, rozdíl, použitý kľúč rozúčtovania (§7 ods. 2 zák. 67/2013).
- **Wizard with gates**: (1) all bank lines reconciled, (2) all invoices categorized, (3) meter readings entered, (4) preview per-unit table, (5) publish PDFs, (6) lock period.
- **Reklamace workflow (CZ)** — 30-day owner reklamace window, 30-day predseda response window, status tracking, auto-acknowledge on expiry (§8 zák. 67/2013).
- PDF via existing `@react-pdf/renderer` (mirror `VotingMinutesPDF.tsx`).
- Delivery: in-app notification + email; per-recipient tracking via shared `*_notifications_sent` table; explicit consent log for purely electronic delivery (statutory permission not unambiguous in either SK or CZ — fall back to listinné if owner declines).

**Accounting closes & audit**
- Period lock semantics — published year is read-only; corrections post as reversal in current period.
- 10-year retention enforcement (SK §35 zák. 431/2002; CZ §31 zák. 563/1991) — no hard delete; soft-delete + audit trail.
- Účtovná závierka schválenie tied to shromáždění/zhromaždenie minutes (§7c ods. 9 SK / §1208 NOZ CZ) — závierka not final without recorded vote.
- Append-only event log for každú mutation; signed export for kontrolná komisia.

**Owner self-service**
- Own karta bytu (running balance), payment history, current predpis breakdown, downloadable vyúčtovanie PDFs, meter reading entry.
- **Right-to-inspect (§11 ods. 6 zák. 182/1993 / §1179 NOZ)** — read-only view of all FPÚO čerpanie expense lines + scans, scoped to current dom.
- **Redacted view + visibility flag on every uploaded scan**: pri upload PDF faktúry treasurer vidí explicitné upozornenie "Tento doklad bude viditeľný pre všetkých vlastníkov v rámci práva na nahliadnutie. Obsahuje osobné údaje? Označte na redakciu." Možnosti: `public` (default), `redacted_required` (treasurer musí pred publikovaním uploadnúť maskovanú verziu PDF s prečiernenými GDPR-citlivými časťami) alebo `restricted` (právny dôvod, napr. faktúra za právne služby proti inému vlastníkovi — viditeľné iba kontrolnej komisii + chairmen). Restricted vyžaduje textové odôvodnenie do audit logu.

**Dashboard (4 tiles + Vyžaduje pozornosť)**
- 4 tiles: Pokladnica, Banka, Fond opráv (with target), Nedoplatky (count + sum).
- "Vyžaduje pozornosť" list:
  - unmatched bank lines
  - uncategorized expenses
  - overdue units
  - ročné vyúčtovanie deadline countdown (SK 31.05, CZ 4-month)
  - expirujúce revízie (≤ 60 dní)
  - faktúry v collector inbox čakajúce na schválenie
  - reklamácie po response deadline (CZ)
- 6-mesačná cash-flow projection chart pod tiles.

**Voting integration (wedge)**
- Schôdza/zhromaždenie resolutions that mutate financial parameters (FPÚO rate change, extraordinary repair approval, contracting správca, úver schválenie) → typed pipeline into accounting.
- Resolution outcome creates a draft predpis revision / draft expense authorisation; treasurer reviews + publishes.
- Bi-directional link: each accounting record affected by a vote stores `voting_resolution_id`; vote detail page shows resulting financial impact.

**Permissions & roles**
- Add `treasurer` (pokladník) to the **board-role model** (`BoardMemberRole` — the model that already defines `chairman`), **not** `membershipRoleEnum` (verified 2026-06-09: enum = admin/owner/tenant/vote_counter/caretaker, no chairman). Treasurer: write predpis/payments/expenses, no governance. `chairman`: approval + read. `owner`: read-own.
- Server-side check on every server action + API route.

**GDPR — debtor disclosure (SK)**
- §9 ods. 3 zák. 182/1993: build-in toggle for ≥500 EUR threshold; surface only jméno + suma; CZ disabled by default (no statutory basis).

**Multi-country & i18n**
- SK (default) and CZ feature parity. EN as admin/audit lingua.
- Country config (RES-20260413-002) supplies terminology + legal references + deadlines + tax IDs format.
- All UI text via `useTranslations()` under `Accounting` namespace in `messages/{sk,cs,en}.json`.

**UX guardrails**
- Two-mode UI: "Pohľad pokladníka" (default, no debit/credit terminology) and "Pohľad účtovníka" (reveals journal + chart of accounts, for audit/accountant review). Toggle in profile menu.
- Concierge import: accept prior-year Excel (units/owners/balances) + bank statements + last-year vyúčtovanie PDF for opening balances. No 20-step setup wizard.

### Out of scope

- **DPH / tax filing** — SVB and SVJ are not VAT payers in the typical case; if a specific SVB becomes plátce DPH, treat as separate spec.
- **Daň z príjmu PO / DPPO export** — out (separate spec).
- **Payroll** for predseda/správca/board members — booked as expense; no payroll calculation engine.
- **Open Banking AISP** for non-Fio banks — requires NBS/ČNB licencia or TPP agency; defer until product justifies.
- **Inter-SVB or inter-tenant transactions** — single-tenant boundary stays at one HOA root entity.
- **AR invoicing of owners** — predpis is a schedule, not a fiscal invoice; we do not emit faktúry to owners.
- **AP invoicing of suppliers / purchase orders** — only expense recording from already-received invoices.
- **Property management for landlords** — this is HOA accounting, not nájomné účtovníctvo for individual byty.
- **Migration of historical years** prior to module install — manual opening-balance entry only; no historical replay.
- **Connection to účtovný program třetí strany** (KROS, Money S3, Pohoda) — export-only, no live sync.

## Approach

### Module placement

Built under `modules/accounting/` per the plugin-module system (RES-20260428-001). Gated as a paid/optional module per host config. Routes mounted under `src/app/[locale]/(dashboard)/accounting/` via module loader.

### Data model

**Core ledger (double-entry, hidden from UI)**

- `accounting_periods` — (entity_id, year, status: `open` | `reconciling` | `published` | `closed`, opened_at, closed_at). Unique on (entity_id, year).
- `chart_of_accounts` — country-scoped chart per Opatrenie MF SR č. MF/24342/2007-74 (SK) / vyhláška 504/2002 Sb. (CZ). Loaded as seed data; never user-editable in v1.
- `journal_entries` — header (period_id, posted_at, description, source_type, source_id, voting_resolution_id?, created_by_user_id, locked_bool).
- `journal_lines` — line (journal_entry_id, account_id, debit_cents, credit_cents, accounting_okruh: `FPUO` | `SVC` | `MGMT`, unit_id?, service_category_id?). Sum of debits = sum of credits per entry; CHECK constraint at DB level.

**Domain surface (what the user sees)**

- `fee_schedules` — header per period (entity_id, period_id, effective_from, effective_to, status: `draft` | `published`).
- `fee_schedule_services` — per-service rows on a schedule (id, schedule_id, service_category_id, allocation_key, rate_cents, fixed_amount_cents?).
- `service_categories` — `FPUO`, `MGMT_CZ`, `SVC_HEAT`, `SVC_WATER_COLD`, `SVC_WATER_HOT`, `SVC_ELECTRICITY_COMMON`, `SVC_LIFT`, `SVC_CLEANING`, `SVC_INTERNET`, `SVC_OTHER`. Country-scoped.
- `fee_assessments` — derived row per (unit × service × month): unit_id, service_category_id, period_id, month, amount_cents, allocation_basis_snapshot_json. Generated when schedule publishes; immutable after period locks.
- `payments` — bank-side: source (`manual` | `bank_import` | `fio_api`), received_at, value_date, amount_cents, vs, ss, counterparty_iban, counterparty_name, narrative, external_tx_id UNIQUE, raw_payload_json.
- `payment_allocations` — splits a payment across assessments: payment_id, unit_id, service_category_id, period_id, amount_cents, allocated_by (`auto` | `manual`).
- `expenses` — supplier-side: invoice_no, supplier_name, supplier_dic, supplier_iban, invoice_date, paid_at, service_category_id, accounting_okruh, amount_cents, document_id (attachment).
- `meter_readings` — unit_id, meter_type (`heat`, `water_cold`, `water_hot`, `electricity`), reading_date, value, raw_units (for CZ rozúčtování engine).
- `reclamations_cz` — owner reklamace per §8 zák. 67/2013: vyuctovanie_id, unit_id, opened_at, response_due_at, status, body, response_body.
- `unit_balances_view` — materialized per (unit_id, service_category_id, period_id) running balance.

Every `journal_lines` posted by domain code carries `source_type` + `source_id` back to the surface table (predpis publish, payment match, expense booking, vyúčtovanie close) — enables drill-down from karta bytu to invoice scan to journal posting.

All FK use explicit `onDelete` per project rule: `cascade` for owned children (assessments, allocations, lines), `restrict` for periods + categories + chart accounts.

### Booking model (internal, never user-facing)

Implemented as small posting engine in `modules/accounting/src/engine/booking.ts`:

- Predpis publish → posts assessment as `Dr Pohľadávky voči vlastníkom / Cr Záväzok z titulu FPÚO (resp. služieb)` per okruh.
- Bank payment matched → `Dr Bankový účet / Cr Pohľadávky voči vlastníkovi`.
- Supplier expense → `Dr Náklady-servis-X / Cr Záväzky voči dodávateľom` then payment `Dr Záväzky / Cr Bankový účet`.
- Vyúčtovanie close → preplatok/nedoplatok reclassification posting.
- All postings stamped with `source_type`, `source_id`, `voting_resolution_id?`.

Chart of accounts seed: SK = analytics under 311 (pohľadávky), 472 (záväzky z FPÚO), 478 (záväzky zo služieb), 221 (banka), 211 (pokladnica), 5xx (náklady), 6xx (výnosy). CZ analogous per vyhláška 504/2002.

### Allocation engine

**Predpis allocation keys** (apply at schedule publish):
- `share` — spoluvlastnícky podiel z `housing_unit_data.shareNumerator/shareDenominator`.
- `area_m2` — z `housing_unit_data.area`.
- `persons` — z nového `unit_persons_count` field (membership-scoped, time-versioned).
- `flat_count_equal` — 1 / total_units (for CZ §1180 ods. 2).
- `fixed` — flat amount per byt.

Allocation basis snapshot stored on `fee_assessments` row at publish time — protects against schema drift mid-year.

**Partial-payment allocation** (apply at payment match):
- Default strategy: **`proportional`** — incoming sum is split across open assessments for that unit in the period proportionally to their open amounts (e.g. predpis = 30 FPÚO + 20 teplo + 50 voda + 20 výťah = 120; payment 100 → 25 FPÚO + 16.67 teplo + 41.67 voda + 16.66 výťah, sum-preserving with banker's rounding on the last component).
- Alternative strategy: **`priority_ordered`** — per-HOA configurable order list (e.g. služby first, FPÚO last); paying down assessments in order until payment exhausted. Selected per HOA in module settings, default = proportional.
- Across periods: FIFO by oldest-open-assessment regardless of strategy.
- Strategy + ordering stored per HOA in `accounting_settings`; change creates new effective-from row, historical allocations preserved.
- Manual override always available on reconciliation UI — treasurer can re-allocate explicitly.

### Bank import

Reuses `src/lib/import/` infra. New parsers:

- `src/lib/import/parsers/bank-camt053.ts` — primary, SBA SK + ČBA CZ profiles. Regex `/VS(\d{1,10})/SS(\d{1,10})/KS(\d{1,4})` on `EndToEndId`; fallback to `RmtInf/Ustrd` regex.
- `src/lib/import/parsers/bank-fio-json.ts` — Fio REST API JSON (per-account read token in `external_connections`).
- `src/lib/import/parsers/bank-abo.ts` — phase 2 fallback for VÚB / ČSOB CZ users on legacy exports.

Matching pipeline in `modules/accounting/src/matching/`:
1. VS → unit_code mapping (per-unit, per-period predpis bears assigned VS).
2. ŠS → period/month if structured.
3. Counterparty IBAN match against owners' bank accounts.
4. Counterparty name fuzzy match → suggestion only, never auto-applied.

Idempotency: `external_tx_id UNIQUE` on `payments` table; re-import is no-op.

### Reconciliation UX (Xero-style)

Two-pane reconciliation screen:
- Left: unreconciled bank lines (with parsed VS/ŠS/IBAN highlighted).
- Right: system's best-match suggestion (open assessment for that VS) with confidence badge.
- One-click "Sedí" / "Nájsť iné" / "Rozdeliť na viac úhrad".

### Heat / TUV rozúčtování engine (CZ-mandatory)

`modules/accounting/src/engine/heat-allocation.ts`:
- Input: total annual heat cost, per-jednotka započitatelná plocha (m²), per-jednotka indikátor reading; configurable base-share %, configurable correction band.
- Output: per-unit allocation rows, posted as service expense allocation at vyúčtovanie close.
- Engine pure-fn + unit-tested per known examples from MMR ČR.

### Annual vyúčtovanie wizard

`modules/accounting/src/routes/dashboard/vyuctovanie/[year]/page.tsx` with steps:
1. **Reconcile gate** — query unmatched bank lines; can't proceed until 0.
2. **Invoices gate** — query expenses with `service_category_id IS NULL`; can't proceed until 0.
3. **Meter readings** — table of units × meter types; missing rows highlighted.
4. **Preview** — full per-unit settlement table; treasurer can drill into any cell.
5. **Publish** — generates PDF per unit, emails via existing `src/lib/email.ts` pipeline, records delivery in `*_notifications_sent` (per project rule), locks the period.
6. **Lock confirmation** — period status → `published`; subsequent edits in this year require reversal in current year.

PDF mirrors `VotingMinutesPDF.tsx` structure: header (SVB name, period, owner), per-service table, totals, signature blocks, legal references.

### Reklamace workflow (CZ)

`modules/accounting/src/routes/owner/reclamations/page.tsx` for owners; treasurer-side at `modules/accounting/src/routes/dashboard/reclamations/page.tsx`. State machine: `open` (30-day window) → `responded` (30-day response window) → `closed`. Auto-close on window expiry per §8 zák. 67/2013.

### Voting integration

`modules/voting` already publishes typed resolution outcomes (per generic entity architecture). New event consumer in `modules/accounting/src/integration/voting-listener.ts`:
- Resolution kind `fpuo_rate_change` → draft `fee_schedule_revision` for treasurer review.
- Resolution kind `expense_approval` → draft `expense_authorisation` linked to vote.
- Resolution kind `manager_contract` → draft expense series.
- Bi-link stored on `journal_entries.voting_resolution_id` and on `voting_resolutions.financial_impacts` summary view.

### Permissions

Add `treasurer` (pokladník) to the board-role model (`BoardMemberRole` in `src/types/index.ts` + its persisted board table) — **not** `membershipRoleEnum`. Verified 2026-06-09: `membershipRoleEnum` = admin / owner / tenant / vote_counter / caretaker; `chairman` lives in `BoardMemberRole`, so `treasurer` belongs there too. Server-side guard on every server action + API route under `modules/accounting/`. Owner read-own check enforced at query level (always filtered by `unit_id IN (memberships WHERE user_id = ?)`).

### Opening-balance correction tool

`modules/accounting/src/routes/dashboard/onboarding/opening-balance/page.tsx`:
1. Štep: enter bank account balance(s) + pokladnica.
2. Štep: per-unit FPÚO + zálohy zostatky (CSV upload alebo manual table).
3. Štep: system computes invariant `Banka + Pokladnica - (Σ FPÚO + Σ Zálohy)` and surfaces the rozdiel.
4. Štep: ak rozdiel ≠ 0, treasurer must post a korekčné journal entry against `Nerozdelený výsledok minulých rokov` (or other free-form analytic) — UI guides through this with confirmation.
5. Lock: opening balance period closes; no other booking permitted until invariant = 0.
All opening entries stamped `source_type = opening_balance`; visible separately + cannot be deleted post-lock.

### QR code generation

`modules/accounting/src/qr/`:
- `pay-by-square.ts` — SK PAY by square (Bysquare format), encodes IBAN + amount + VS + KS + SS + currency + due date + note. Library: existing OSS Node port of bysquare spec.
- `qr-platba.ts` — CZ SPAYD (Short Payment Descriptor), text format `SPD*1.0*ACC:IBAN*AM:amount*CC:CZK*X-VS:vs`.
- Static QR for monthly predpis (uses standing-order amount).
- Dynamic QR for vyúčtovanie nedoplatok and úroky-z-omeškania upomienka (specific sum + VS).
- Embedded as PNG into `@react-pdf/renderer` documents.

### Cash-flow projection

`modules/accounting/src/projection/cashflow.ts` — pure function:
- Input: opening balance per pool (FPÚO + bank + services), list of future predpis occurrences from active schedules, list of recurring expenses (suppliers with monthly recurrence), list of approved one-off expenses (voting resolutions with `expense_authorisation`), historical úhrada rate per HOA.
- Output: per-month projected closing balance per pool.
- Rendered as line chart (Recharts) below dashboard tiles.
- Marker dots on months where projected FPÚO &lt; configurable target threshold.

### Sankcie engine

`modules/accounting/src/sanctions/interest.ts`:
- Input: list of overdue assessments per unit, target date.
- Lookup rate per day from `interest_rate_history` (SK: zákonná repo+5; CZ: repo+8).
- Compute per-day compounded? — SK statute uses **simple per-day** calculation; CZ same. Verify against current case law in implementation.
- Output: per-assessment interest amount, total per unit.
- Upomienka PDF generator + dynamic QR for full owed amount.

### Supplier / IČO validation

`modules/accounting/src/suppliers/lookup.ts`:
- SK: FinStat API (api.finstat.sk; requires API key — `FINSTAT_API_KEY` env). Endpoints: subjekt detail by IČO, plátca DPH check, dlžník DPH list, dlžník socpoist list.
- CZ: ARES (wwwinfo.mfcr.cz/ares — free, no key). Endpoint: subjekt detail by IČO. Plátca DPH check via separate adisrws.mfcr.cz Adis web service.
- Cached lookup (24h) in `supplier_lookup_cache` table; refresh-on-demand button in UI.
- On dlžník/insolvency hit → red flag on supplier row + confirmation dialog before saving expense.

### Collector email for invoices

- Per-HOA generated address `svb-{slug}@inbox.{host_domain}`; stored on HOA settings.
- Inbound email via SES/Postmark inbound webhook (provider per deployment).
- Pipeline: parse MIME → extract PDF attachment(s) → virus-scan (ClamAV) → OCR via Tesseract / Google Cloud Vision → extract candidate IČO/IBAN/sum/VS/dates → push row into `expense_inbox` (status `awaiting_review`).
- UI: treasurer sees inbox list, click row → preview PDF + extracted fields pre-filled → confirm + categorize + post as expense.
- From-domain allowlist optional per HOA (`accepted_supplier_domains`).

### Country config

Reuse RES-20260413-002. Per-country settings:
- Chart of accounts seed file (`modules/accounting/src/seeds/coa-sk.ts`, `coa-cz.ts`).
- Terminology (predpis vs předpis, fond opráv vs příspěvek na správu domu, ročné vyúčtovanie vs roční vyúčtování).
- Deadlines (SK 31.05 vs CZ 4 mesiace).
- Heat-rozúčtování engine on/off + default base-share %.
- §1180 ods. 2 NOZ rule (CZ-only equal-per-jednotka for správní činnost).
- Legal reference IDs surfaced in vyúčtovanie PDF + reklamace notice.
- **Currency + rounding**: SK = EUR, dva desatinné miesta vo všetkých kontextoch. CZ = CZK, **dva desatinné miesta v bankových operáciách a journal entries**, ale **vyúčtování default zaokrúhľuje finálnu sumu per byt na celé CZK** (konfigurovateľné v HOA settings; rozdiely zo zaokrúhľovania sa zaúčtujú na účet `649 — Jiné ostatní výnosy` / `549 — Manka, škody a haléřové vyrovnání`).
- **QR format**: SK = PAY by square; CZ = QR Platba (SPAYD).
- **IČO lookup provider**: SK = FinStat; CZ = ARES.
- **Interest-rate formula** + history: SK nariadenie 87/1995; CZ nař. vlády 351/2013.

### Phasing

- **Phase 1 — Foundation** (5-7 weeks)
  - Schema + chart of accounts seed (SK only).
  - **Opening-balance correction tool with invariant check**.
  - Predpis editor + publish flow.
  - **PAY by square QR on predpis PDF**.
  - Manual payment entry with proportional partial-payment allocation.
  - Per-unit karta bytu with running balance.
  - Owner read-own view.
  - Dashboard 4 tiles.

- **Phase 2 — Bank import** (3-4 weeks)
  - CAMT.053 parser.
  - Fio REST API connector.
  - Reconciliation two-pane UI.
  - Auto-match by VS/ŠS/IBAN.

- **Phase 3 — Expenses + suppliers** (4 weeks)
  - Expense ledger + categories with brutto/DPH + technical-audit `next_inspection_due_at`.
  - Supplier directory with FinStat (SK) IČO lookup + dlžník flag.
  - Invoice attachment upload + visibility flag (public/redacted/restricted).
  - Pool routing (FPÚO vs SVC vs MGMT).
  - Cash-flow projection chart.

- **Phase 4 — Vyúčtovanie** (4-5 weeks)
  - Vyúčtovanie wizard + gates.
  - Meter reading capture.
  - PDF generation + dynamic QR on nedoplatky.
  - Delivery + `*_notifications_sent` integration.
  - Period lock semantics.

- **Phase 5 — Sankcie + collector inbox** (3 weeks)
  - Úroky-z-omeškania engine + rate history seed.
  - Upomienka PDF generator.
  - Collector email + OCR pipeline for inbound supplier invoices.

- **Phase 6 — CZ parity** (4-5 weeks)
  - Chart of accounts CZ.
  - Heat / TUV rozúčtování engine.
  - §1180 ods. 2 separate okruh.
  - Reklamace workflow.
  - QR Platba (SPAYD) generator.
  - ARES IČO lookup.
  - CZ currency rounding rules.
  - Country config glue.

- **Phase 7 — Voting integration** (2-3 weeks)
  - Voting → accounting event pipeline.
  - Bi-link UI on vote detail + journal entry.

- **Phase 8 — Audit & accountant view** (2 weeks)
  - Pohľad účtovníka toggle + chart-of-accounts surface.
  - Signed export bundle for kontrolná komisia.
  - 10-year retention enforcement on soft-delete.

## Acceptance Criteria

### Legal compliance

- [ ] Internal ledger is double-entry; sum debits = sum credits per `journal_entry` (DB CHECK).
- [ ] SK chart of accounts loaded from Opatrenie MF SR č. MF/24342/2007-74.
- [ ] CZ chart of accounts loaded per vyhláška 504/2002 Sb.
- [ ] Three okruhy (FPÚO, services, MGMT_CZ) tracked separately; transfers between flagged.
- [ ] FPÚO → služby transient cover (SK §10 ods. 3) records a return-due flag visible to treasurer.
- [ ] Ročné vyúčtovanie generates by SK 31.05 deadline; system surfaces sanction (§8a ods. 4) 30 days prior.
- [ ] CZ vyúčtování generates within 4 months of period end per §7 zák. 67/2013.
- [ ] CZ reklamace state machine respects 30+30 day windows per §8 zák. 67/2013.
- [ ] CZ heat/TUV rozúčtování engine implements vyhl. 269/2015 ve znění 376/2021 (base 40–60 %, ±20 %/+100 % korekce).
- [ ] 10-year retention enforced — no hard delete of journal entries, doklady, vyúčtovania.
- [ ] Účtovná závierka schválenie blocked until shromáždění/zhromaždenie vote recorded (§7c ods. 9 SK / §1208 NOZ CZ).
- [ ] Right-to-inspect read-only view available to every owner of the dom (§11 ods. 6 SK / §1179 CZ).
- [ ] SK debtor disclosure toggle only enables names + sumy for owners with nedoplatok ≥ 500 EUR (§9 ods. 3 zák. 182/1993).
- [ ] Electronic delivery of vyúčtovanie requires recorded owner consent; non-consenting owners fall back to listinné doručenie.
- [ ] Vyúčtovanie and upomienka PDFs cite the instance country's own statutes (SK §-refs vs CZ §-refs); the SK template is never reused verbatim for a CZ instance — statutory-citation content is template-aware, not naively parametrized (project rule: legally-regulated content).

### Core flows

- [ ] Treasurer can publish a fee schedule for a period and see per-unit assessments generated correctly per each allocation key.
- [ ] Mid-year schedule revision preserves historical assessments and applies new rates from `effective_from`.
- [ ] Manual payment entry posts journal + allocates per configured strategy (proportional default).
- [ ] Partial payment (received &lt; predpis) splits proportionally across services; sum-preserving rounding.
- [ ] Strategy toggle (proportional ↔ priority_ordered) persists per HOA and is auditable.
- [ ] CAMT.053 import is idempotent (re-import → 0 new rows).
- [ ] Fio API connector polls successfully with stored token and dedups by `ID operace`.
- [ ] Auto-match by VS achieves ≥95 % accuracy on test fixture of 1000 SK SEPA payments.
- [ ] Reconciliation UI lets treasurer accept/reject/split a suggested match in ≤2 clicks.
- [ ] Expense entry requires DIČ/IČ DPH, IBAN of supplier, invoice number, attachment, netto/DPH/brutto.
- [ ] Vyúčtovanie wizard blocks progression if unreconciled bank lines or uncategorised invoices remain.
- [ ] Vyúčtovanie PDF matches statutory contents (per-service skutečné náklady, přijaté zálohy, rozdíl, použitý kľúč rozúčtovania).
- [ ] Period lock turns published year read-only; correction posts as reversal in current year.
- [ ] Cross-period overpayment applies FIFO to the oldest open assessment across periods; leftover credit parks as a `preplatok` on the unit, not silently absorbed.
- [ ] `allocation_basis_snapshot_json` is frozen on each assessment at publish; later edits to a unit's area / share / persons do not retro-alter already-published assessments.

### Onboarding & opening balance

- [ ] Opening-balance tool surfaces `Banka + Pokladnica - (Σ FPÚO + Σ Zálohy)` rozdiel in real time.
- [ ] Cannot leave onboarding until invariant = 0 (korekčný entry required).
- [ ] All opening entries flagged `source_type = opening_balance` and undeletable post-lock.

### QR + payments UX

- [ ] PAY by square QR on every SK predpis PDF; scan with Tatra/SLSP/VÚB app pre-fills trvalý príkaz correctly.
- [ ] SPAYD QR on every CZ předpis PDF; scan with major CZ banking apps pre-fills payment.
- [ ] Dynamic QR on nedoplatok rows in vyúčtovanie PDF carries exact sum + VS + reference.
- [ ] Upomienka PDF for úroky z omeškania includes dynamic QR for sum due to date.

### Sankcie

- [ ] Úroky-z-omeškania engine matches manually-computed reference for SK fixture (nariadenie 87/1995) ±0.01 EUR.
- [ ] CZ engine matches reference per nař. vlády 351/2013.
- [ ] Rate history seed updates on schedule (cron); current ECB/ČNB repo always available.
- [ ] Upomienka PDF lists each overdue assessment with per-assessment interest + total + zákonné poučenie.

### Technical-audit link

- [ ] Categories `REVIZIA_*` enforce `next_inspection_due_at` not null.
- [ ] Revízia expirujúca v ≤ 60 dňoch appears in "Vyžaduje pozornosť"; expired escalates to chairman notification.
- [ ] Calendar export (.ics) per HOA of all upcoming revízie deadlines.

### Suppliers & invoice intake

- [ ] IČO entry triggers FinStat (SK) / ARES (CZ) lookup; result cached 24h.
- [ ] Dlžník DPH / insolvency hit shows red flag + requires confirmation before saving expense.
- [ ] IBAN field validates MOD-97 checksum.
- [ ] Collector email per HOA accepts inbound PDF; OCR extracts IČO/IBAN/sum/VS into `expense_inbox` row.
- [ ] Treasurer can post inbox row as expense in ≤2 clicks.
- [ ] Inbound collector-email attachments are virus-scanned and pass the optional per-HOA from-domain allowlist before entering `expense_inbox`; failures are quarantined, never auto-posted.

### Cash-flow projection

- [ ] Dashboard chart shows 6-month projected balance per pool.
- [ ] Drill-down per month lists projected revenues + expenses.
- [ ] Recurring expenses (suppliers w/ recurrence) reflected in projection.

### Owner transparency

- [ ] Every uploaded scan has visibility flag; default = `public`.
- [ ] `redacted_required` blocks publishing until redacted PDF version uploaded.
- [ ] `restricted` requires text justification in audit log; not visible to non-board owners.
- [ ] Right-to-inspect view shows every FPÚO čerpanie expense + scan (respecting visibility).

### Currency / rounding (CZ)

- [ ] CZK vyúčtování per-unit final sum rounds to whole CZK by default (configurable).
- [ ] Rounding differences post to `649` / `549` per CZ chart of accounts.
- [ ] Journal entries always store 2 decimals regardless of vyúčtování rounding.

### UX

- [ ] No "debit/credit" / "journal entry" / "trial balance" terminology in any default-mode screen.
- [ ] "Pohľad účtovníka" toggle reveals journal + chart of accounts on demand only.
- [ ] Dashboard renders 4 tiles + Vyžaduje pozornosť list on a single viewport.
- [ ] Karta bytu shows running balance in Excel-style table, drill-down to source on every row.
- [ ] Owner portal shows only: balance, payment history, predpis breakdown, vyúčtovanie PDFs, meter reading entry, čerpanie FPÚO read-only list — nothing else.
- [ ] Concierge import accepts prior-year Excel + bank statements + last-year vyúčtovanie PDF for opening balances.
- [ ] All UI text routed through `useTranslations()` / `getTranslations()` from `Accounting` namespace; no hardcoded strings.

### Voting integration (wedge)

- [ ] Resolution `fpuo_rate_change` creates draft schedule revision visible to treasurer in &lt; 5 sec.
- [ ] Resolution `expense_approval` creates draft expense authorisation linked to the vote.
- [ ] Every `journal_entry` originating from a vote stores `voting_resolution_id`; vote detail page lists resulting financial impacts.

### Permissions & roles

- [ ] `treasurer` (pokladník) is added to the board-role model (same model as `chairman`), **not** naively to `membershipRoleEnum` — see Notes 2026-06-09 drift finding.
- [ ] `treasurer` + `admin` can create / edit / void predpis, payments, expenses, meter readings; `chairman` and `owner` cannot post or mutate financial records.
- [ ] `chairman` has full accounting read + approval actions (závierka, expense authorisation) but no direct ledger writes (separation of duties).
- [ ] Owner reads are server-side scoped: every owner query is filtered by `unit_id IN (memberships WHERE user_id = ?)`; requesting another unit's karta bytu / payments returns 403, not just a hidden UI element.
- [ ] Every server action + API route under `modules/accounting/` runs the role check before any DB read; under-privileged requests return 403.

### Audit trail & data lifecycle

- [ ] Append-only event log records every mutation (insert / update / void) with actor, timestamp, and before/after snapshot; no in-place field overwrite occurs without a corresponding log row.
- [ ] Signed export bundle for kontrolná komisia reproduces the full ledger + event log and verifies tamper-evidently without DB access.
- [ ] No hard delete anywhere — units, payments, expenses, journal lines use `archived_at` soft-delete; archiving a unit preserves its historical journal lines and assessments.
- [ ] Opening-balance and locked-period entries cannot be voided or edited; the only correction path is a reversal posted in the current open period.

### Mutable-record correction (open period)

- [ ] In an open period, a mis-entered manual payment / expense / meter reading can be voided or edited; the action writes an audit-log row and re-derives affected unit balances.
- [ ] Voiding a matched payment unallocates it from its assessments and restores each assessment's open balance.
- [ ] A draft (unpublished) fee schedule can be discarded with no ledger side effects; a published schedule cannot be deleted — only superseded by an `effective_from` revision.
- [ ] An owner can withdraw their own open reklamace before the response deadline; withdrawal is logged and closes the case.

### Architectural / project rules

- [ ] Every FK in new schema specifies explicit `onDelete`.
- [ ] All FK to `entities.id` for housing root scope; multi-dom SVB uses one entity per dom with shared parent.
- [ ] Route handlers under `app/**/route.ts` export only HTTP methods + Next config (no module-level state).
- [ ] `*_notifications_sent` reused for per-recipient delivery tracking; no purpose-specific email tracking table.
- [ ] Single bundled migration per phase (no half-applied migrations).
- [ ] Server-only modules (`*.server.ts`) carry `import "server-only"`; client-safe types/constants split into separate file when needed.

## Project Context

### Stack
- Next.js App Router + TypeScript + Tailwind CSS v4
- PostgreSQL 16 + Drizzle ORM
- NextAuth v5 (beta.30)
- next-intl (sk default, en, cs)
- `@react-pdf/renderer` for PDFs
- Plugin-module system per RES-20260428-001

### Dependencies
- Generic entity architecture (RES-20260501-002)
- Plugin module system (RES-20260428-001)
- Country i18n config (RES-20260413-002)
- Voting engine (already live + currently being refactored per BYT-20260511-001)
- Import infrastructure (BYT-20260508-001 ... 004)
- Notifications-sent pattern (project CLAUDE.md)

### Competitor landscape
- **DOMUS (ANASOFT APR)** — dominant SK incumbent, správca-first, opaque to owners; desktop legacy + recent web. Read-only owner portal at poschodoch.sk.
- **SSB2000** — CZ desktop incumbent; paid training mandatory.
- **DOMSYS** — CZ SaaS, modern, 987 Kč/byt/mes Standard (high for self-managed).
- **EasySVB, Hugo SVB, CoRect Plus** — SK desktop, chairman-targeted, no public pricing.
- **SimpleUcto** — CZ free desktop, accounting-only, no SVJ domain model.
- **Excel templates** — dominant for &lt;20-unit self-managed SVB/SVJ.

**Empty market slot:** chairman-first SaaS, public per-byt pricing, owner-transparent by default, voting + accounting unified. No incumbent occupies it.

### Legal sources (verify current text before phase implementation)
- SK: zák. 182/1993 Z.z. (§7b, §7c, §8, §8a, §8b, §9, §10, §11), zák. 431/2002 Z.z., Opatrenie MF SR č. MF/24342/2007-74.
- CZ: zák. 89/2012 Sb. (§1179, §1180, §1181, §1208), zák. 67/2013 Sb., vyhláška 269/2015 Sb. ve znění 376/2021 Sb., zák. 563/1991 Sb., vyhláška 504/2002 Sb.
- GDPR + eIDAS for electronic delivery + retention overrides.

### Bank import sources
- SBA SK XMLStatement v3.0 (2024) — primary parser target.
- ČBA CZ camt.053 dialect — secondary parser target.
- Fio banka REST API — `https://fioapi.fio.cz/v1/rest/periods/{token}/{from}/{to}/transactions.{fmt}`.

## Notes

### Open questions

- **2026-05-12**: Confirm CZ vyhláška 269/2015 base-share % after 376/2021 amendment — research flagged 40–60 % but exact final numbers unverified.
- **2026-05-12**: Verify §1184a NOZ (or equivalent) on electronic delivery without prior consent — research could not confirm.
- **2026-05-12**: Verify whether SK FPÚO → služby transient cover (§10 ods. 3) requires zhromaždenie approval — statute silent.
- **2026-05-12**: Need real exported file samples from each bank before locking parsers (CAMT.053 SK, Fio CSV/JSON, VÚB ABO).
- **2026-05-12 → resolved 2026-06-09**: `chairman` is NOT in `membershipRoleEnum` (verified: enum = admin / owner / tenant / vote_counter / caretaker). It is a `BoardMemberRole` in `src/types/index.ts` (chairman / council_member / committee_member / committee_chairman). **Therefore `treasurer` (pokladník) must be added to the board-role model, NOT `membershipRoleEnum`** — Scope + Approach §Permissions corrected accordingly. Confirm whether board roles need a persisted enum/table migration for `treasurer`.
- **2026-05-12**: PAY by square — confirm OSS Node library exists with current spec; if not, port spec ourselves (it's ~150 lines).
- **2026-05-12**: FinStat API pricing — free tier limits unknown; ARES is free for CZ. Budget impact for SK lookup at scale.
- **2026-05-12**: Inbound email provider — SES Inbound vs Postmark Inbound vs Mailgun. Each has different per-HOA address routing model. Pick one for first deployment.
- **2026-05-12**: Úroky z omeškania — simple vs compounded per day. SK case law strongly indicates simple per § Občianskeho zákonníka 517 ods. 2 + nariadenia 87/1995; verify before AC test fixture is locked.
- **2026-05-12**: Visibility flag enforcement — does `redacted_required` need OCR-based PII detection helper, or is manual redaction always required? Default = manual; OCR-assist as nice-to-have.

### Risks

- **Chart of accounts scope creep** — SK/CZ neziskové účtovné jednotky chart is large (~150 účty); seed only what's needed for SVB flows. Risk of "but my účtovník wants 5xx breakdown" pull — push back: surface only domain categories; full chart visible in Pohľad účtovníka.
- **Multi-dom SVB** — §10 ods. 4 mandates separate FPÚO per dom. Schema must scope all financial tables by `entity_id` (dom-level), not by parent SVB. Current entity model already supports this.
- **Heat/TUV engine is high-stakes** — incorrect rozúčtování generates reklamace storms. Build with table-driven test fixtures from MMR ČR examples before shipping.
- **Voting integration latency** — voting refactor (BYT-20260511-001) still in progress; coordinate event contract before phase 6.
- **GDPR debtor disclosure** — UI must default toggle OFF and require explicit confirm + threshold check; legal exposure if a chairman publishes a name &lt;500 EUR.
- **Retention enforcement** — 10-year soft-delete requires careful migration design; deleting a unit cascades into journal entries, which must be preserved. Use `archived_at` not row deletion.

### Decisions made

- **Double-entry internally, single-entry UI** — settled. SK + CZ legally require podvojné účtovníctvo; user-facing surface hides it.
- **CAMT.053 first, per-bank CSV never** — settled. One XML parser covers all SK banks.
- **Wedge = voting + accounting unified** — settled. No competitor has this.
- **Chairman-first, owner-transparent** — settled. Owner gets full karta bytu + right-to-inspect by default, not as an upgrade.
- **Partial-payment allocation = proportional default, priority_ordered as opt-in** — settled. Proportional matches owner expectations + CZ vyúčtování semantics; priority order available for SVB whose stanovy mandate it (e.g. "služby first, FPÚO last"). Both auditable; treasurer can manually override per payment.
- **Opening-balance invariant = blocking** — settled. Treasurer cannot post first business entry until banka+pokladnica = Σ FPÚO + Σ zálohy + výsledok hospodárenia. Prevents the "Excel chaos carryover" failure mode common to inherited SVB books.
- **QR codes mandatory on every PDF** — settled. PAY by square (SK) + SPAYD (CZ), static on predpis, dynamic on nedoplatok/upomienka.
- **CZK vyúčtování rounding to whole koruna** — settled as default, configurable per HOA; bookings stay 2-decimal.

### Follow-up specs to file

- Open Banking AISP integration (post-MVP).
- DPH plátca SVB edge case.
- DPPO daň z príjmu PO export.
- Inter-SVB module (multi-tenant for správca with portfolio).
- OCR-based PII detection on uploaded scans (auto-suggest redaction zones).
- Kontrolná komisia signed bundle export (could be merged into phase 8 if straightforward).
- Direct integration with externý účtovný program (Pohoda, Money S3, KROS) — export-only.
- Mobile-first app for treasurer (approve inbox invoices from phone).
- Stripe / direct-debit for owners who prefer card over SEPA — likely never relevant for SVB, monitor demand.
