---
retro_for: BYT-20260512-002
spec_title: "Accounting module — HOA finances (SK + CZ)"
created: 2026-07-07
status: partial  # pending | applied | partial — F4 + F6 applied to project CLAUDE.md 2026-07-07
stored_outside_specs: true   # kept in docs/ by owner request, NOT specs/retros/
implementation_range: 465b940..9eec46b   # third overnight run; whole module context
spec_status_at_retro: 76 implemented / 1 partial / 12 blocked (89 total)
---

# Spec retro — Accounting module (mid-sprint, spec still `in_progress`)

Comparison of the **final spec** against the **final code** after three autonomous
overnight runs. Focus on remaining drift and generalizable lessons — not the
original-plan-vs-code diff. Stored in `docs/` (not `specs/retros/`) per owner request.

## Discrepancies

### 1. Voting integration shipped out of phase-order, via direct call not the event contract
- **Category:** better_approach
- **Spec said:** Phase 7 (after Phase 6); risk note — "coordinate the event contract with the in-progress voting refactor (BYT-20260511-001) before phase 6."
- **Implementation did:** shipped the wedge early (`30ce4fa`) by calling the accounting pipeline **directly** on vote-close — module-gated, non-fatal, idempotent per voting item — because the onVoteClose hook bus can't reach the TS pipeline until a dist build step lands.
- **Why:** waiting on the other refactor's event bus would block the wedge indefinitely; an idempotent direct call is a safe stopgap that the bus can later supersede without double-posting.

### 2. "BLOCKED" was all-or-nothing; 7 ACs actually had a buildable half
- **Category:** spec_incomplete (audit taxonomy)
- **Spec said:** the AC audit marked 18 criteria BLOCKED on external input.
- **Implementation did:** wave 2 shipped 508 / 478-upload+479 / 426 / 425 / 417 by splitting each into a buildable half (own-format PDF ingest, local OCR, consent columns, SK toggle, transfer metadata) + a genuinely-blocked half (ledger double-entry / legal sign-off / email+AV infra).
- **Why:** "blocked on a CZ účtovník / real bank data / email infra" was conflated with "entirely unbuildable." Only PART of each AC actually depended on the external input.

### 3. Quantitative accuracy AC (438) is unverifiable in dev
- **Category:** spec_wrong
- **Spec said:** "auto-match by VS achieves ≥95 % accuracy on a fixture of 1000 SK SEPA payments."
- **Implementation did:** VS exact-match built; no 1000-payment fixture — a synthetic one only measures itself. Left blocked pending real bank data.
- **Why:** the AC prescribed a metric with no available ground-truth data source in the dev environment, so it is circular / unfalsifiable without real statements.

### 4. Exhaustive "only" AC (507) violated by over-delivery
- **Category:** scope_creep
- **Spec said:** "Owner portal shows only: balance, payment history, predpis breakdown, vyúčtovanie PDFs, meter reading entry, čerpanie FPÚO read-only list — nothing else."
- **Implementation did:** an extra debtors card slipped onto the owner surface; every presence check still passed. Caught only by the AC audit; removed by hand this session.
- **Why:** there was no negative assertion — nothing tested that the surface contained *nothing beyond* the enumerated set.

### 5. Statutory PDFs shipped with unverified legal copy; no sign-off gate
- **Category:** spec_incomplete
- **Spec said:** project rule — statutory content is template-aware, never naively parametrized (SK vs CZ §-refs).
- **Implementation did:** template-awareness was implemented well (SK components refuse CZ reuse), but the actual poučenie / §-citation **text** shipped as placeholders "flagged for Filip." No AC blocks release on legal-copy sign-off.
- **Why:** the spec conflated "citations sit in the correct template" (plumbing — code-testable) with "citation text is legally correct" (needs a lawyer/účtovník). Only the first had an AC.

### 6. Domain-engine errors were never localized
- **Category:** spec_incomplete
- **Spec said:** i18n rule — every user-facing string via next-intl, keys in all locales.
- **Implementation did:** the pure engines throw EN-only strings that surface raw in the UI; flagged as tech debt across ~5 slices, never resolved.
- **Why:** the pure-engine/UI split (adopted for testability) wasn't paired with an error-code → i18n-catalog design, so engine errors silently fell outside the i18n rule.

### 7. Unverified-migration pileup when the local DB was unavailable
- **Category:** one_off (with a generalizable lesson)
- **Spec/prompt said:** implement a slice, then verify it (tsc + tests + migrate).
- **Implementation did:** with the local DB down (ayon port-5433 collision), slices 29–34 plus the voting wedge were built code-complete, stacking migrations 0068–0073 unverified until the DB returned.
- **Why:** the autonomous run kept building past the point of verifiability instead of stopping at the first unrunnable slice.

## Deferred Items
<!-- NOT findings — remaining work, already tracked in the spec's BLOCKED list -->

- [ ] CZ chart of accounts + everything on it (415/427/497/498) — deferred: needs a CZ účtovník.
- [ ] Inter-okruh ledger double-entry (416 + 417 ledger half) — deferred: needs the SK COA account pair + §10 ods. 3 legal answer.
- [ ] CZ reklamace state machine + owner withdraw (420/537) — deferred: CZ-only, no fixtures.
- [ ] ≥95 % auto-match (438) + standing-order QR scan (455) — deferred: real bank data / phone QA.
- [ ] Collector email inbound + AV/allowlist (478-email/480) — deferred: SES/Postmark + AV infra.
- [ ] FinStat/ARES supplier auto-fill (475/476) — deferred: descoped (paid API).
- [ ] Legal-copy sign-off on all statutory PDFs — deferred: Filip/lawyer, release blocker.

## Findings

### 1. Integration sections must specify a fallback when the upstream contract isn't ready
- **Target:** spec_skill
- **From discrepancy:** #1
- **Recommendation:** in a spec's `## Approach` integration subsection, when the feature depends on another in-progress project/refactor, require a stated **fallback integration path** (e.g. a direct idempotent call) that ships value now and is safely superseded when the real contract (event bus, webhook) lands. "Coordinate the contract first" is not a plan — it's a block.
- **Applied:** no

### 2. Split externally-blocked ACs into a buildable sub-AC + a blocked sub-AC
- **Target:** spec_skill
- **From discrepancy:** #2
- **Recommendation:** AC audits (and the spec itself) must not mark a criterion wholesale BLOCKED when only part of it needs external input. Decompose into the buildable half (metadata, UI, own-format, local tooling) and the blocked half (ledger, legal sign-off, paid API, infra), and ship the buildable half. A single "BLOCKED" tag hides deliverable work.
- **Applied:** no

### 3. Quantitative ACs must name their ground-truth data source
- **Target:** spec_skill
- **From discrepancy:** #3
- **Recommendation:** any AC with a numeric target (≥N %, ≤N ms, N-row fixture) must name where the ground-truth data comes from. If it only exists in production/real-world data, the AC explicitly marks its verification **deferred to real data** rather than being tickable against a self-measuring synthetic fixture.
- **Applied:** no

### 4. "Shows only X / nothing else" ACs require a negative test
- **Target:** claude_md
- **From discrepancy:** #4
- **Recommendation:** whenever an AC enumerates an exhaustive allowed set ("shows only …", "exposes exactly …", "nothing else"), the test must assert the surface contains **nothing beyond** the set — not just that each listed item is present. Presence-only checks pass silently on over-delivery.
- **Applied:** yes — project `CLAUDE.md` → `### Specs`, 2026-07-07.

### 5. Legally-regulated documents need two ACs: plumbing + legal-copy sign-off
- **Target:** spec_skill
- **From discrepancy:** #5
- **Recommendation:** for any component emitting statutory content (PDFs, notices, attestations), write two distinct ACs: (a) template-aware plumbing — the correct §-refs render in the correct jurisdiction's template (code-testable); and (b) a **legal-copy sign-off** release gate — the actual statutory text is verified by the domain authority before real delivery. Shipping (a) green must not read as "the legal document is correct."
- **Applied:** no

### 6. A pure engine / UI split must return error codes, not English
- **Target:** claude_md
- **From discrepancy:** #6
- **Recommendation:** when logic is extracted into a pure engine (for testability) and consumed by UI, the engine returns error **codes / typed errors**, and the UI maps each code to an i18n catalog entry. Function purity does not exempt error messages from the project i18n rule — plan the error-code → catalog design in the same slice as the engine.
- **Applied:** yes — project `CLAUDE.md` → `### i18n`, 2026-07-07.

### 7. Autonomous runs must stop at the first unverifiable slice, not stack unverified migrations
- **Target:** workflow
- **From discrepancy:** #7
- **Recommendation:** an overnight/headless run that loses its ability to runtime-verify (DB down, dep broken) must STOP after the first slice it can't verify and log BLOCKED — cap at one unverified migration outstanding. Stacking six unverified migrations turns a one-slice risk into a whole-batch risk that all lands unproven.
- **Applied:** no

## Next
Run `/apply-findings` when ready to route these (F4 + F6 → project CLAUDE.md;
F1/F2/F3/F5 → spec-skill proposals; F7 → overnight-run/workflow policy). The
durable code rules (F4, F6) and the legal-doc gate (F5) are also captured in
auto-memory so they carry into future sessions without re-reading this file.
