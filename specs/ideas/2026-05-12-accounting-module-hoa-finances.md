---
spec_id: BYT-20260512-002
title: "Accounting module for SVB chairman/treasurer to track HOA finances"
status: idea
created: 2026-05-12
updated: 2026-05-12
author: byt-app
owner: byt-app
last_verified: 2026-05-12
project_type: node
depends_on: []
related_handoffs: []
tags: [accounting, finance, hoa, svb, treasurer, fond-oprav]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Seed from user: accounting module for SVB chairman/treasurer to track HOA finances — monthly contributions from owners (zálohy), expenses (opravy, služby, správca), fond opráv balance per unit, annual reconciliation (ročné vyúčtovanie).

## Scope

### In scope
- **Predpis (fee schedule)** per unit per period — monthly amounts split into:
  - príspevok do fondu prevádzky, údržby a opráv (FPÚO) — §10 ods. 1 zák. 182/1993 Z.z.
  - zálohy na služby a plnenia spojené s užívaním bytu (teplo, voda, výťah, upratovanie, správca, …)
- **Payment tracking** — manual entry + CSV bank-statement import (Tatra, SLSP, VÚB, ČSOB, mBank); match by VS/ŠS or unit number
- **Expense ledger** — recorded against FPÚO or service-zálohy pool, with category (oprava, údržba, revízia, správa, energie, voda, …) and supplier
- **Per-unit running balance** — FPÚO share + per-service zálohy balance; preplatok/nedoplatok visible
- **Ročné vyúčtovanie** per §8a — generate per-unit annual statement (zaplatené × predpis × rozdiel) as PDF, send via existing email/notification pipeline by 31 May
- **Treasurer/chairman dashboard** — monthly cashflow, overdue units, FPÚO total balance, expense breakdown
- **Owner self-service** — own predpis, payment history, current balance, downloadable yearly statement
- **Multi-country** — SK rules first; CZ ("příspěvek na správu domu" terminology) follows same model via country config (already exists per RES-20260413-002)
- **i18n** — keys in `messages/{sk,en,cs}.json` under `Accounting` namespace
- **Permissions** — treasurer role can write predpis/payments/expenses; chairman read+approve; owner read-own

### Out of scope
- **Podvojné účtovníctvo** — SVB runs single-entry per zák. 431/2002; we do not implement full double-entry GL
- **Tax filing / DPH** — out
- **Payroll** for správca/board — out (recorded as expense only)
- **Open Banking direct connection** — phase 2; v1 = CSV import only
- **Per-meter consumption allocation** (water/heat sub-metering split) — separate spec; v1 assumes share-based or fixed-amount allocation
- **AR invoicing of owners** — predpis is informational, not a fiscal invoice
- **AP invoicing of suppliers** — only expense recording from already-received invoices; no purchase orders
- **Audit / kontrolór workflow** — separate spec
- **Migration of historical years** prior to module install — manual opening-balance entry only

## Approach

### Module placement
- Build under `modules/accounting/` per the plugin-module system (RES-20260428-001).
- Gated as a paid/optional module — chairman activates in module settings.
- Routes mounted under `src/app/[locale]/(dashboard)/accounting/` via module loader.

### Data model (new tables, all FK-scoped to `entities.id` for the housing root)
- `accounting_periods` — year + status (open/closed/reconciled), one per HOA per year.
- `fee_categories` — enum-like rows: `FPUO`, `SVC_HEAT`, `SVC_WATER_COLD`, `SVC_WATER_HOT`, `SVC_ELECTRICITY_COMMON`, `SVC_LIFT`, `SVC_CLEANING`, `SVC_MGMT`, `SVC_OTHER`. Country-scoped.
- `fee_schedules` — predpis header per period (effective_from, effective_to).
- `fee_assessments` — line per (unit × category × month), `amount_cents`, derived from allocation rule (share-based / per-m² / fixed) at schedule creation.
- `payments` — credits per unit, source (`manual` | `bank_import`), `received_at`, `vs`, `ss`, raw bank-row JSON for audit.
- `payment_allocations` — splits a payment across (unit × category × period) FIFO by oldest open assessment.
- `expenses` — debit ledger: `category_id`, `pool` (`FPUO` | `SVC`), `supplier`, `invoice_no`, `paid_at`, `amount_cents`, attachment (document).
- `unit_balances` (view/materialized) — running per-unit balance per category.
- All FKs use explicit `onDelete` (`cascade` for owned child rows, `restrict` for periods and categories).

### Allocation rules
- Default FPÚO allocation: by ownership share (`shareNumerator/shareDenominator` from `housing_unit_data`).
- Services default: same share, but allow per-category override (per-m², per-person, fixed).
- Allocation rule stored on `fee_schedules` row; re-computable for what-if before publish.

### Bank import
- Reuse `src/lib/import/` infra (already has parsers per BYT-20260508-003).
- New `src/lib/import/parsers/bank-{tatra,slsp,vub,csob,mbank}.ts` — CSV → normalized rows.
- Matching: VS = unit code, fallback to ŠS, fallback to manual assign UI.
- Idempotent — hash of `(bank_ref + amount + date)` to prevent double-import.

### Annual reconciliation (`ročné vyúčtovanie`)
- Triggered manually by treasurer when period status flips to `reconciling`.
- For each unit: sum predpis, sum payments allocated, sum service-zálohy consumed (from expenses split by allocation rule), produce `preplatok` / `nedoplatok` row.
- PDF generated via existing `@react-pdf/renderer` pattern (mirror `VotingMinutesPDF.tsx`).
- Delivery: existing email pipeline (`src/lib/email.ts`) + in-app notification; per-recipient tracking via `*_notifications_sent` table per project rule.

### Permissions
- Treasurer role added to `membershipRoleEnum` (currently `owner` is the default; verify chairman + board already exist). Treasurer = write predpis/payments/expenses, no governance powers.
- Owners see only their own unit's predpis/payments/balance/statement.
- Server-side check in every server action + API route; never trust client filter.

### Country config
- SK terminology default ("fond opráv", "predpis", "ročné vyúčtovanie").
- CZ swap via existing `country` config (RES-20260413-002): "fond oprav" → "příspěvek na správu domu", "ročné vyúčtovanie" → "roční vyúčtování".
- Legal references parameterized.

### Phasing
- **Phase 1**: schema + predpis + manual payment entry + per-unit balance + owner read view.
- **Phase 2**: bank CSV import + matching UI.
- **Phase 3**: expense ledger + treasurer dashboard.
- **Phase 4**: annual reconciliation + PDF export + email delivery.
- **Phase 5**: dashboards/charts + overdue notifications.

## Acceptance Criteria

## Project Context

## Notes
