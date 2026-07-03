# Overnight autonomous run — Accounting module (BYT-20260512-002)

You are running unattended overnight. Work autonomously until the task list below is exhausted or you are genuinely blocked. Do not ask questions — make the best decision, record it in the work log, and continue.

## Context to load first (in this order)
1. `specs/in_progress/2026-05-12-accounting-module-hoa-finances.md` — the spec (goal, approach, phasing, acceptance criteria)
2. `docs/domain/accounting.md` — domain invariants; these override any convenient shortcut
3. `CLAUDE.md` (project) — DB/i18n/migration/legal-content rules all apply
4. Current module code: `modules/accounting/` + migrations `drizzle/0048–0051` + `scripts/accounting-allocation-check.ts`

## Mission
Drive the accounting module forward phase by phase (spec "Phasing" section), starting where the code currently stops. For **each work unit** run this loop:

1. **Implement** — smallest shippable slice (one feature/AC bullet, not a whole phase at once).
2. **Verify** — `pnpm tsc --noEmit` (or `pnpm build` when routing/pages touched). Fix all errors before moving on.
3. **Test** — write tests for the slice (engine logic, allocation math, invariant checks, parsers get priority — pure functions first). Run the test suite. Sum-preserving rounding and double-entry balance invariants MUST have explicit test cases.
4. **Review** — run `/code-review` on the working diff. Fix confirmed findings. Re-run tests.
5. **Commit** — one commit per slice, message per repo convention. Commit locally on `main`. **NEVER `git push`. NEVER deploy. NEVER touch any non-local database or env.**
6. **Log** — append to `WORK_LOG.md` (create if missing): timestamp, slice done, tests added/passing, review findings fixed, decisions made, open questions for Filip.

## Priority order
1. Finish **Phase 1** gaps: predpis editor + publish flow, PAY by square QR on predpis PDF, manual payment entry with proportional partial-payment allocation, karta bytu running balance, owner read-own view, dashboard 4 tiles.
2. Then **Phase 2**: CAMT.053 parser (pure function + fixtures first), auto-match by VS/ŠS/IBAN with confidence scoring, reconciliation UI, Fio connector (mock the HTTP layer in tests).
3. Then Phase 3 onward only if time remains.
4. Interleave: after completing each phase, do one hardening pass — re-run full test suite, `/code-review` the whole accounting diff since last pass, fix, commit.

## Hard rules (violating any of these = stop and log instead)
- Migrations: `drizzle-kit generate` only; hand-written SQL only for destructive alters per CLAUDE.md pattern (snapshot copy + journal entry). Commit migration together with schema change.
- Every FK gets explicit `onDelete`.
- No hard delete of journal entries / doklady / vyúčtovania — 10-year retention.
- Double-entry: sum(debit) = sum(credit) per journal entry, enforced in DB, tested.
- Statutory citations are template-aware, never naively parametrized (SK vs CZ §-refs).
- i18n: every user-facing string via next-intl, keys added to ALL of `sk.json`, `en.json`, `cs.json`.
- Local DB only: `docker compose up db` + `pnpm db:migrate` against local Postgres. Nothing else.
- No `.env` edits, no secrets, no external service calls with real credentials (FinStat/Fio/etc. = mocked in tests, interface + config stub in code).

## Failure policy
- Same error 3 attempts in a row → log it in `WORK_LOG.md` under "BLOCKED", skip that slice, continue with the next.
- If the dev environment breaks in a way you can't repair (DB corrupt, deps broken), stop all work, log state, do NOT try destructive recovery (no volume deletes, no `git reset --hard`, no force-anything).

## Morning deliverable
`WORK_LOG.md` must end with a summary section: phases/slices completed, test count + pass status, commits made (hashes + one-liners), review findings fixed vs deferred, blocked items, recommended next steps.

## Completion sentinel
Only when EVERYTHING in the priority order is done (or everything remaining is BLOCKED), write a final line to `WORK_LOG.md` containing exactly: `OVERNIGHT_RUN_COMPLETE`. An external runner script watches for this line — do not write it early, and do not write it if work remains.

## Resume behavior
If this prompt is given to you again mid-run (session was restarted after a rate limit), first read `WORK_LOG.md` and `git log --oneline -20`, then continue from the first unfinished slice. Never redo committed work.

Note: the standing "don't run tests/lint" preference is suspended for this run only — running the test suite and typecheck is required here.
