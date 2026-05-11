---
spec_id: BYT-20260508-002
title: "Reconcile Phase 9.2 spec text with the in-tree drizzle migration"
status: idea
created: 2026-05-08
updated: 2026-05-08
author: Filip
owner: Filip
last_verified: 2026-05-08
project_type: node
depends_on: []
related_handoffs: []
tags: [spec-drift, migrations, generic-entity-architecture, documentation]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

The Phase 9 spec for the generic-entity-architecture migration tells a future reader: "this file is intentionally outside ./drizzle so drizzle-kit migrate WILL NOT pick it up. To apply: copy into ./drizzle/0027_drop_legacy.sql, append a journal entry pointing at it, and ship a separate deploy."

Reality on 2026-05-07: `drizzle/0027_drop_legacy.sql` exists, is wired into `drizzle/meta/_journal.json`, and applies automatically on the next instance startup with pending migrations. The spec text is stale and actively misleading — a future reader following the spec's "preflight" instructions would assume the destructive drop hasn't shipped yet.

Fix the drift in two parts: (a) update the spec to reflect that 0027 has been promoted, (b) preserve the original "draft outside ./drizzle" body for audit context (it explains the design), and (c) add a single project rule so the next phase migration doesn't repeat this drift.

## Scope

**IN scope:**
1. Update `specs/in_progress/2026-05-01-generic-entity-architecture.notes-phase9.md` (or wherever the Phase 9 spec body lives) to mark Phase 9.2 as "applied as drizzle migration 0027 on YYYY-MM-DD" with a pointer to the actual file path.
2. Move the original "destructive drop draft" SQL from the spec body into an appendix or move to `docs/migrations/phase-9.2-original-draft.sql` so it remains discoverable as historical record.
3. Update the spec's pre-flight checklist section to note: "these checks are now embedded as `SET NOT NULL` constraints in 0027; if backfill 0023/0025 missed any rows, 0027 fails atomically and rolls back. Run the explicit pre-flight queries only when introducing a similar destructive drop in a future phase."
4. Add a new entry under the spec's `## Notes` section: "Phase 9.2 promoted to ./drizzle on 2026-05-07 (commit ___). Spec text was not updated at promotion time → caused confusion during the 2026-05-07 cloud-side incident retro."
5. Add one short rule to project CLAUDE.md: "When promoting a phase-N migration into ./drizzle, update the spec body in the same commit. Do not let drizzle-managed and spec-described state diverge."

**OUT of scope:**
- Re-running or reverting any DB changes. The 0027 migration logic itself is correct; only the spec doc is stale.
- Changing the migration's content. The destructive drop is in production state; touching it is a different spec.
- Migrating Phase 9 spec to `implemented/` folder. That's a `/spec-promote` decision — out of scope here. Reading the spec status in the frontmatter, it should likely move once all dependent customer instances have applied 0027 successfully.

## Approach

1. **Locate the canonical Phase 9 spec.** Either `specs/in_progress/2026-05-01-generic-entity-architecture.md` or one of the `.notes-phase9.md` annexes. Read the full text. Identify every paragraph that says "Phase 9.2 has not yet shipped" / "intentionally outside ./drizzle" / "to apply: copy into".

2. **Edit the spec body.** For each "not yet shipped" paragraph:
   - Prefix with `~~` (markdown strikethrough) if keeping for history, OR move into an explicit `## Phase 9.2 — original design (preserved for audit)` section at the bottom.
   - Add a clear **Status:** line at the top: `Phase 9.2 applied as drizzle/0027_drop_legacy.sql on 2026-05-07. See ## Notes for promotion details.`

3. **Reconcile pre-flight checklist.** Replace the manual-pre-flight bullet list with a paragraph explaining that the checks are now enforced atomically by `SET NOT NULL` in 0027, and reference `pg_dump` backup as the rollback mechanism.

4. **Update `last_verified`** in frontmatter to today's date. The spec is being re-verified against actual code state.

5. **Add the project rule** to byt-app `CLAUDE.md` under a new "Spec discipline" section (mirroring open-resiapp-cloud's pattern):
   > **Phase migrations: spec body must move with the file.** When a draft-only migration SQL is promoted into `./drizzle/`, update the corresponding spec body in the same commit. Strikethrough or move "draft / not yet shipped" passages so a future reader can't follow stale instructions.

6. **No code changes.** The drizzle migration is correct; the journal entry is correct; the customer DBs that have applied it are correct. This is purely doc reconciliation.

## Acceptance Criteria

- [ ] Phase 9 spec body has a "Status: applied" line at the top of the Phase 9.2 section, pointing at `drizzle/0027_drop_legacy.sql` with the promotion date.
- [ ] No paragraph in the active spec body still says "intentionally outside ./drizzle" or "to apply: copy into" without strikethrough/marking it as historical.
- [ ] Spec frontmatter `last_verified` updated to the date of this fix.
- [ ] Original draft SQL preserved either inline (with strikethrough) or in a clearly-labeled appendix/file under `docs/migrations/`.
- [ ] byt-app `CLAUDE.md` has the new "Phase migrations: spec body must move with the file" rule.
- [ ] grep for `intentionally outside ./drizzle` across `specs/` returns zero non-strikethrough hits.

## Project Context

**Touched files:**
- `specs/in_progress/2026-05-01-generic-entity-architecture*.md` (whatever the actual filename is — confirm before editing).
- `CLAUDE.md` — new rule under spec-discipline section.
- (optional) `docs/migrations/phase-9.2-original-draft.sql` if moving the draft out of the spec body.

**Discovery context:** during the 2026-05-07 cloud-side incident retro for ORC-20260507-001, walked through `byt-app/drizzle/` to understand which migrations would apply on the next instance startup. The Phase 9 spec text said `0027_drop_legacy.sql` was "intentionally outside ./drizzle" — but it was inside, journaled, and would have applied automatically on the next restart of customer instance `5e8bc8f5`. Took ~10 minutes to reconcile spec vs reality and confirm the destructive drop's safety mechanisms (BEGIN/COMMIT + `SET NOT NULL` as implicit pre-flight) before deciding it was safe to ship the new image. That confusion is exactly what an up-to-date spec body would prevent.

## Notes

- **Why not just delete the original draft text?** Two reasons. First, the design rationale (why Phase 9.2 was originally separate from Phase 9.1 dual-run) is still valuable as project history — it explains why migrations 0019-0026 do dual-run. Second, future destructive-drop migrations might want to follow the same pattern; preserving the draft is a reusable template.
- **Open: should the rule about spec-body-must-move apply to ALL migration promotions, not just phase migrations?** Probably yes, but the immediate pain was phase migrations specifically (large, multi-step, with separate spec docs). Tighten the rule scope after this fix; broaden if a similar issue recurs on a non-phase migration.
- **Open: `/spec-retro` ran for ORC-20260507-001 on the cloud side captured this drift as out-of-scope.** Should byt-app run its own `/spec-retro` against the Phase 9 spec? Likely — this drift, plus any other Phase 9 deviations from the original spec, would be worth a single retro pass when Phase 9 moves to `implemented/`.