---
proposal_for: /spec-new
from_retro: 2026-05-15-retro-multi-kind-community-tree.md
finding: 3 (voting algorithm vs weight formula)
created: 2026-05-15
status: pending
---

## Problem

Specs that introduce multiple voting methods routinely list them as sibling bullet points:

> - `weighted_by_share` — HOA flats
> - `one_per_member` — garden plots
> - `one_per_unit` — garages
> - `custom_weight` — admin-defined

This obscures whether each method changes the **weight formula** (same algorithm, multiply by X) or the **resolution algorithm** (different bucketing, different dedup keys, different breakdown structure).

In BYT-20260515-001, the spec listed 4 methods as siblings. Reality:
- `weighted_by_share`, `one_per_unit`, `per_area` → same algorithm (bucket by unit, resolve co-owner conflicts per §14 ods. 4), just different per-unit weight formulas
- `one_per_member`, `custom_weight` → **different algorithm** (no unit bucketing, each membership stands alone, different POST dedup key `(votingId, ownerId)` not `(votingId, entityId)`)

The algorithmic difference forced a Phase 3b carve-out mid-spike with a new `MemberResolution` type, new engine path, new POST dedup logic.

## Proposed change to `/spec-new`

When a spec adds a voting method (or any other "pick from N strategies" feature where each strategy can change algorithm shape, not just parameters), the spec template should require categorizing each method as one of:

- **Weight variant**: same resolution algorithm as method X, only the per-target weight formula changes.
- **Algorithm variant**: introduces a new resolution path, dedup key, or breakdown structure. Specify what differs.

If any methods are algorithm variants, the Approach MUST plan a separate phase / sub-phase for the divergent algorithm — don't bundle it with the weight-variant methods.

## Specific trigger

`/spec-new` should detect when the user mentions multiple voting / quorum / scoring methods and prompt for the algorithm-vs-weight categorization explicitly. Same prompt applies to:
- Permission models (RBAC variants)
- Pricing models (per-seat vs per-action vs flat-rate)
- Anything else where "N strategies" can hide algorithmic divergence.
