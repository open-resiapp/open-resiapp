---
proposal_for: /spec-new (also /spec-promote check)
from_retro: 2026-05-15-retro-multi-kind-community-tree.md
finding: 6 (risk estimates must be verified via grep)
created: 2026-05-15
status: pending
---

## Problem

Spec Approach sections routinely cite caller counts as risk markers: "~17 files import the legacy aliases", "~25 files touch housingRootData / housingUnitData", "voting affects 50+ call sites". These numbers are used to defer / gate phases.

BYT-20260515-001 Phase 8b listed "~17 files import the legacy aliases" as the cleanup blocker. Reality: a targeted `grep "import type.*from \"@/types\""` matched **zero** files. The 17 was a fuzzy count from an earlier broad grep that matched local interfaces, prop types, and class fields named `Building` / `Flat` / `Entrance` — none of which imported the alias. The "big cleanup" turned out to be a 3-line type deletion.

Bogus risk estimates push real work into deferred phases that never ship.

## Proposed change to `/spec-new`

When the spec's Approach lists a caller count (any "N files affected" / "K callers"), the count MUST be grounded in a specific grep that matches the relevant pattern (imports, calls, instances of the specific identifier — NOT fuzzy name matches).

`/spec-new` should:
1. When the user mentions a sweep / migration scope ("touches N files", "affects K callers"), ask: "What grep produced this number? Paste the command and the count."
2. Embed the grep command + result count in the spec as a verifiable risk anchor, e.g.:
   ```
   ## Risk anchors
   - File sweep scope: `grep -l "from \"@/types\"" src/ | xargs grep -l "Building\b"` → 17 files (verified 2026-05-15).
   ```
3. `/spec-promote` to `in_progress` re-runs the grep before promotion and warns if the count drifted.

## Why this matters

Spec readers (including future-you) believe the numbers in the Approach. If "~17 files" is fuzzy, every phase that gates on that number inherits the imprecision. Bad estimates kill momentum; either the work is deferred unnecessarily or the implementer hits surprise scope mid-spike.
