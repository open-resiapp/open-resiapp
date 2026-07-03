---
subsystem: accounting
last_updated: 2026-07-03
updated_by: Filip (interview via /domain-extract)
---

## Mental model

Complete, precise money-tracking system for a Slovak SVB (and Czech SVJ): every euro the community prescribes (predpis), collects (úhrada), and spends (výdavok) is recorded and traceable — operated by the chairman/treasurer without accounting expertise, transparent to every owner. Hiding double-entry bookkeeping behind domain terms (predpis, úhrada, fond opráv, vyúčtovanie) is core identity, not a UI choice.

One accounting engine for all countries; country-specific behavior (chart of accounts, deadlines, statutes, QR format) is configuration resolved from the building's country. The engine is generic enough for any community kind (garden, garage, urbár), but statutory content is SVB/SVJ-template-only.

## Invariants

1. Every journal entry always balances: Σ debits = Σ credits. Enforced at the database level. No exceptions ever.
2. Money never exists without a paper trail: every posting carries a source reference (bank line, invoice, manual entry, opening balance). An orphan posting is a corrupt state.
3. FPÚO (fond opráv), služby (service advances), and CZ-only správní činnost are separate pools. Money never moves between pools silently — a cross-pool transfer is always explicit and flagged, and the SK transient FPÚO→služby cover (§10 ods. 3 zák. 182/1993) tracks a mandatory return until repaid.
4. A published/locked period is immutable. Corrections post only as reversals in the current open period. Editing history is a corrupt state.
5. Nothing financial is ever hard-deleted. Void/archive only — 10-year retention (SK §35 zák. 431/2002; CZ §31 zák. 563/1991).
6. Opening balance must satisfy `Banka + Pokladnica = Σ FPÚO + Σ zálohy + výsledok minulých rokov` before the first business posting is permitted. Unbalanced books never enter the system.
7. Every owner always sees their own unit's complete flows; right-to-inspect (SK §11 ods. 6 / CZ §1179 NOZ) gives every owner read access to the whole dom's FPÚO spending. There is no hidden money.
8. A free-form manual journal entry ("any transaction") is allowed as last resort only — always audit-logged with actor and justification, always transparent to owners, and it still obeys invariants 1–5.
9. Multi-dom SVB: each dom has its own FPÚO (SK §10 ods. 4). Financial records are always scoped to the dom, never merged at the SVB parent.
10. The sum of per-unit allocations always equals the allocated total (sum-preserving rounding). Cents never appear or vanish in a split.
11. Every displayed balance is derived from postings; a balance is never a stored mutable number.

## Sign and direction conventions

| Value | Positive means | Negative means |
|---|---|---|
| Karta bytu running balance | Owner owes community (nedoplatok) | Owner overpaid (preplatok) |
| Vyúčtovanie result per unit | Nedoplatok — owner pays | Preplatok — community returns |
| Predpis row | Always positive (obligation created) | — |
| Úhrada / payment | Always positive; direction implied by type (in from owner / out to supplier) | — |
| Cash-flow projection | Money in pool | — (FPÚO below target = warning) |

Owner-facing convention everywhere: **positive = debt** (matches "koľko dlží" mental model of SK chairmen).

Internal ledger uses classic debit/credit with non-negative amounts in separate columns — amounts are never signed.

## Scope rule

- All financial records belong to the **dom** (building entity), never the SVB parent. Multi-dom SVB = separate books per dom; parent is organizational identity only.
- Owner access derives from membership: a user reads a unit's data only if they hold a membership on that unit. Enforced server-side in every query — unauthorized request returns 403, not a hidden UI element.
- Allocation inputs (ownership share, unit area, person count) are **snapshotted on each assessment at publish time**. Later changes to ownership or area never retro-alter published assessments.
- Treasurer/chairman authority comes from the community's **board role**, not a global user role.
- Country behavior (chart of accounts, statutory deadlines, QR payment format, legal references) resolves from the building's country setting.
- **Debt follows the person, not the unit.** An assessment binds to whoever owned the unit at its due date. Sale does not transfer debt — the seller settles before transfer; the buyer starts clean. A departed owner's balance remains theirs. For a split year, each owner receives a vyúčtovanie for their ownership period.

## Counterparts and pairs

| Action | Counterpart / correction |
|---|---|
| Predpis published | Superseding revision from `effective_from`; a published schedule is never deleted |
| Predpis draft | Discard freely — no ledger side effects |
| Payment matched wrongly | Void → unallocates, restores each assessment's open balance, writes audit row |
| Expense mis-entered (open period) | Edit or void + audit row |
| Any record in a locked period | Only a reversal entry in the current open period |
| Overpayment | Parks as preplatok on the unit → FIFO against oldest open assessment, or refunded |
| FPÚO → služby borrow (SK) | Mandatory tracked return; flagged until repaid |
| Opening-balance entry | Immutable after lock, forever |
| Vyúčtovanie published | CZ: reklamace workflow (30+30 days, §8 zák. 67/2013); SK: corrected statement + reversal postings |

## Edge cases

What breaks when developers don't know these rules:

1. **Editing a balance directly instead of posting an entry.** Balances are derived; an UPDATE on a balance corrupts the books (invariant 11).
2. **Deleting instead of voiding.** Cascade-deleting a unit or owner wipes journal history and breaks 10-year retention. Everything financial soft-archives.
3. **Recomputing published assessments from live data.** Ownership or area changed mid-year → published assessments must read their snapshot; recompute-from-live silently rewrites history.
4. **Naive rounding on allocation splits.** A proportional split must be sum-preserving (round last component); per-row rounding leaks cents and violates invariant 10.
5. **Scoping money to the SVB parent instead of the dom.** A query without dom-level scoping merges two FPÚOs — illegal under SK §10 ods. 4.
6. **Trusting client-side role checks.** Another unit's karta bytu must 403 server-side; hiding the button is not protection.
7. **Reusing the SK PDF template for CZ (or any other country/kind).** Statutory citations differ per country and apply to SVB/SVJ only; legal content is template-aware, never parametrized.
8. **Treating predpis as an invoice.** Predpis is a payment schedule/obligation, not a fiscal document — no invoice numbers, no VAT logic on it.
9. **Matching payments by amount alone.** VS (variabilný symbol) is the primary matching key; amount-only matching cross-matches same-amount payments from different owners.
