---
proposal_for: /spec-new (also /spec-retro reminder cadence)
from_retro: 2026-05-15-retro-multi-kind-community-tree.md
finding: 8 (phase-granularity drift expected for cross-cutting specs)
created: 2026-05-15
status: pending
---

## Problem

Architecturally-invasive specs (those touching schema + voting + UI + templates + i18n simultaneously) routinely split each phase into 2–3 sub-phases during implementation. The neat phase list in the original Approach turns into a phase + letter-suffix tree:

BYT-20260515-001 specced 8 phases. Reality shipped:
- Phase 1 → 1a, 1b, 1c
- Phase 2 → 2a, 2b
- Phase 3 → 3, 3b
- Phase 6 → 6, 6b, 6c (6c deferred)
- Phase 7 → 7a, 7b, 7c (7c deferred)
- Phase 8 → 8a, 8b

The drift isn't a spec failure — it's how cross-cutting work actually decomposes. But the spec doesn't acknowledge it, so readers assume the original 8-phase plan is load-bearing and the sub-phasing comes as a surprise.

## Proposed change to `/spec-new`

When the spec touches >3 of {schema, business logic, UI, i18n, migrations, external integrations}, the spec template should:

1. Auto-add a disclaimer to the `## Notes` section:
   > **Cross-cutting spec — sub-phasing expected.** Phases below are placeholders that will likely split into N.a / N.b / N.c sub-phases during implementation. Run `/spec-retro` at the end of EACH phase (not just at completion) to capture the granularity that actually shipped.

2. The `/spec-retro` skill should be re-runnable per phase (it already is — but the disclaimer surfaces this fact to the operator).

3. Optional: `/spec-promote spec → in_progress` could detect cross-cutting specs and remind: "Cross-cutting spec — schedule phase-end retros."

## Why this matters

Without the disclaimer, sub-phasing feels like scope creep. With it, sub-phasing is part of the contract, and the retros happen incrementally instead of one big lossy retro at the end.

## Detection heuristic

A spec is "cross-cutting" if its Approach modifies >3 of:
- `src/db/schema.ts` (schema)
- `src/lib/**` non-test files (business logic)
- `src/components/**` or `src/app/**` JSX (UI)
- `messages/*.json` (i18n)
- `drizzle/*.sql` (migrations)
- `handoffs/**` (external integrations)

`/spec-new` can apply this heuristic by scanning the proposed `Affected files` list in the Approach.
