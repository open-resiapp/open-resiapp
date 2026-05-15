---
proposal_for: /spec-new
from_retro: 2026-05-15-retro-multi-kind-community-tree.md
finding: 2 (read-write switchover gap window)
created: 2026-05-15
status: pending
---

## Problem

Specs that propose "switch reads to new store now, switch writes later" routinely create a data-freshness gap window between the read-switch deploy and the write-switch deploy. Writes hit the legacy store; reads serve stale jsonb / new table. Users see stale data until the second deploy lands.

BYT-20260515-001 ran into this exact issue between Phase 2b (reads switch to `entities.data` jsonb) and the planned Phase 2c (writes switch). The implementation closed the gap by adding **dual-write at the read-switch deploy** (Phase 2b absorbed Phase 2c's write change as a write-to-both). The spec's original phasing didn't acknowledge the gap; it had to be discovered mid-spike.

## Proposed change to `/spec-new`

When the new spec's Approach mentions any read/write store migration (jsonb folding, table rename, FK repointing, sharded → unified, cache layer change, etc.), the spec template should require an explicit answer to:

> **Gap window**: between the read-switch deploy and the write-switch deploy, how does the new read source stay current?
>
> Accept one of:
> - **(a) dual-write at read-switch**: both stores get every write from that deploy on; legacy store remains until cleanup phase.
> - **(b) batch sync job**: a job replicates legacy → new at interval `T`; document interval + acceptable staleness.
> - **(c) maintenance window**: read-switch + write-switch ship in the same deploy; document the deploy procedure.
>
> "We'll switch writes later" without one of these is a data-freshness bug.

Implementation suggestion: add a step to the `/spec-new` skill's interview that asks "Does this spec involve a read/write store migration?" → if yes, demand the gap-window answer in Approach.

## Why not "always require dual-write"

Some migrations don't actually have a gap window (e.g. atomic rename, single-deploy refactor). Forcing dual-write is overkill. The spec should make the operator pick a strategy and write it down, not pick the strategy for them.
