---
retro_for: BYT-20260515-001
spec_title: "Multi-kind community tree — replace hardcoded housing hierarchy with arbitrary recursive tree"
created: 2026-05-15
status: applied
---

## Discrepancies

### 1. Enum → text FK migration didn't flag string-literal sweep
- **Category:** `spec_incomplete`
- **Spec said:** Phase 1c converts `entities.kind` from enum to text FK via `ALTER COLUMN ... USING (CASE ... END)`.
- **Implementation did:** Migration ran, but 23 source files still hardcoded `"housing_unit"` / `"housing_community"` / etc. in WHERE clauses and INSERT payloads. Every query like `eq(entities.kind, "housing_unit")` matched zero rows post-migration. Required an emergency bulk-sed rename across all callers (Phase 1c follow-up) before any read switch could work.
- **Why:** The spec treated the migration as a pure schema change. The companion code-level rename was implicit; nobody captured it as a phase deliverable.

### 2. Dual-write strategy missing from spec; 2b→2c gap-window unaddressed
- **Category:** `better_approach`
- **Spec said:** Phase 2b switches reads to `entities.data`; Phase 2c switches writes. Phase 8 drops legacy tables.
- **Implementation did:** Between Phase 2b deploy and Phase 2c deploy, reads would serve stale data (legacy tables get writes; jsonb doesn't). Implementation added **dual-write inside Phase 2b** — writes go to both legacy and jsonb at every mutation site. Tables stay populated as rollback source until Phase 8.
- **Why:** The phase ordering created a data-freshness hole the spec didn't acknowledge. Dual-write closes it without inventing a maintenance window.

### 3. Member-scoped voting needed its own resolution algorithm
- **Category:** `spec_incomplete`
- **Spec said:** Four voting methods (`weighted_by_share`, `one_per_member`, `one_per_unit`, `custom_weight`) listed as siblings.
- **Implementation did:** `weighted_by_share` / `one_per_unit` / `per_area` reuse the existing §14 ods. 4 co-owner unit-grouping engine. `one_per_member` / `custom_weight` need a different path — no unit grouping, each membership stands alone. Required a separate Phase 3b with `calculateMemberScopedResults()`, new `MemberResolution` type, and divergent POST dedup keys.
- **Why:** Spec treated the four methods as variations of the same weight formula. Two of them are fundamentally different algorithms — they bucket votes by member, not by unit.

### 4. Kind catalog wasn't enumerated for all templates upfront
- **Category:** `spec_incomplete`
- **Spec said:** Phase 1 adds an `entity_kinds` table seeded with mapped HOA values (`community`, `building`, `entrance`, `unit`, `generic_group`). Phase 4 ships 20 template JSONs.
- **Implementation did:** Phase 5 needed the catalog rows for every kind across all 20 templates (38 entries total — `plot`, `garage_block`, `apiary_zone`, `hunter`, etc.). Required building a `CANONICAL_KIND_CATALOG` array in `registry.ts` with full metadata (icon, allowsMembers, votable, allowedParentKinds, dataSchema, sortOrder) for all 38 kinds.
- **Why:** Spec described the structure (per-instance catalog table) but didn't budget the work of enumerating actual kind metadata. The seed array was implicit.

### 5. Drizzle snapshot management workflow undocumented
- **Category:** `spec_incomplete`
- **Spec said:** Schema changes via `drizzle-kit generate`.
- **Implementation did:** Four migrations (0033, 0034, 0035, 0036) were hand-written SQL — backfills, in-place type conversions with `USING`, DROP TABLE. Each required:
  1. Copy the previous snapshot to `meta/0NNN_snapshot.json`.
  2. Generate a new UUID for `id`; set `prevId` to the previous snapshot's `id`.
  3. For schema-affecting migrations, mutate the JSON tables/enums sections (manual edit for 0034 enum drop; Python JSON parse for 0036 table drop).
  4. Append an entry to `meta/_journal.json`.
  CLAUDE.md says "never manual SQL" but data-preserving migrations need it.
- **Why:** Spec assumed drizzle-kit can generate every migration. It can't — destructive type alters and DROP TABLE need handwritten SQL, and the snapshot-management overhead isn't documented anywhere.

### 6. Phase 8b caller-sweep risk estimate was bogus
- **Category:** `spec_wrong`
- **Spec said:** Phase 8b cleanup includes "Caller sweep — ~17 files import the legacy aliases".
- **Implementation did:** A targeted `grep "import type.*from \"@/types\""` showed **zero** files actually import `Building` / `Flat` / `Entrance` / `HousingRootData` / `HousingUnitData` / `UserFlat` from `@/types`. The 17 files declared their own local interfaces with the same names. Sweep avoided entirely.
- **Why:** The risk number was inherited from an earlier grep that matched ALL occurrences of the names (including local interfaces, class fields, prop types), not just imports of the aliases. Bogus risk estimates push real work into "deferred" phases unnecessarily.

### 7. Voting PDF legal content can't be template-parametrized
- **Category:** `spec_incomplete`
- **Spec said:** Phase 7 "audit hardcoded `Bytový dom` / `Vchod` / `Byt` labels and switch to `Kinds.<slug>` translation keys driven by the root entity's kind / template".
- **Implementation did:** Most JSX labels parametrize cleanly, but `VotingMinutesPDF` carries §14 ods. 4 zák. 182/1993 Z.z. statutory citations and rationale labels (`single_owner`, `unanimous`, `majority_share`, `tie_abstain`) that are HOA-specific by law. Phase 7b parametrized only the leaf label (`unitLabel` prop); the legal text stays HOA-only. Non-HOA tenants generating voting minutes will get the wrong statute.
- **Why:** Spec treated all UI labels uniformly. Legally regulated content is a different beast — it can't be reduced to a per-kind lookup; it needs per-template content stores or kind-aware content modules.

## Deferred Items

These are NOT findings — they are remaining work tracked for future spikes.

- [ ] **Phase 6c** — `src/lib/import/columns.ts` derive per-row columns from `entity_kinds.data_schema`; `src/lib/import/validate.ts` relax share-sum invariants for non-share leaf kinds. Deferred because: operators of non-HOA templates can put `1/1` in share columns as a workaround; column-derivation is UX polish, not a blocker.
- [ ] **Phase 7c** — Login subtitle (`Auth.subtitle = "Bytové spoločenstvo"`) + on-demand JSX label sweeps. Deferred because: pre-login has no root context (no template_slug accessible without a fetch), and no non-HOA tenants exist yet to surface concrete issues.

## Findings

### 1. Always grep all string-literal occurrences of enum values before an enum→text/FK migration
- **Target:** `claude_md`
- **From discrepancy:** #1
- **Recommendation:** When a Postgres enum is being converted to a text column (or its values are being renamed), a single `grep -rn "'enum_value'\\|\"enum_value\"" src/ modules/` per enum value MUST be part of the migration plan. Every match becomes a code change in the same PR as the migration. Without this, the migration silently breaks every query downstream.
- **Applied:** yes

### 2. Read-write switchover specs must address the gap window between read switch and write switch
- **Target:** `spec_skill`
- **From discrepancy:** #2
- **Recommendation:** When a spec proposes "switch reads to new store now, switch writes later", the Approach section must explicitly answer: between deploy A (read switch) and deploy B (write switch), how does the new read source stay current? Acceptable answers: (a) dual-write at deploy A, (b) batch sync job between A and B, (c) maintenance window. "We'll switch writes later" without a plan is a data-freshness bug. `/spec-new` should prompt for this when the spec touches a dual-store migration.
- **Applied:** dismissed (single-operator project; skill prompt would add friction without preventing bugs)

### 3. Voting/quorum specs must distinguish algorithm changes from weight-formula changes
- **Target:** `spec_skill`
- **From discrepancy:** #3
- **Recommendation:** Specs that introduce multiple voting methods must categorize each method as either "same algorithm, different weight" or "different algorithm" up front. The latter needs a separate phase with its own resolution path, dedup key, and breakdown type. Listing them as siblings in a bullet point obscures the algorithmic difference and creates surprise scope expansion mid-spike.
- **Applied:** dismissed (single-operator project; skill prompt would add friction without preventing bugs)

### 4. Multi-template/multi-kind features need a full kind enumeration before bootstrap can ship
- **Target:** `claude_md`
- **From discrepancy:** #4
- **Recommendation:** When a feature introduces a "kind catalog" (or any seeded reference table that other code reads as a lookup), the spec's Acceptance Criteria must require the catalog enumeration to land before the bootstrap script. Reviewers should reject a "bootstrap script lands first, catalog rows follow later" sequencing — bootstrap will reference missing kinds and either fail at runtime or silently create orphan entities.
- **Applied:** yes

### 5. Document the manual snapshot workflow for hand-written Drizzle migrations
- **Target:** `claude_md`
- **From discrepancy:** #5
- **Recommendation:** Add a section to `CLAUDE.md` covering the hand-written SQL migration path: (a) when it's required (enum drops, table drops, data backfills, ALTER COLUMN with USING), (b) the snapshot mirror procedure (`cp prev_snapshot.json new_snapshot.json` + update `id`/`prevId` + mutate via Python JSON parse for schema changes), (c) the journal entry format. Without this, every architectural migration repeats the same trial-and-error.
- **Applied:** yes

### 6. Risk estimates in specs must be verified before being baked into Approach phasing
- **Target:** `spec_skill`
- **From discrepancy:** #6
- **Recommendation:** When a spec's Approach says "N files affected" or "K callers to sweep", that number MUST be grounded in a targeted grep that matches only the relevant pattern (imports, calls, instances of the specific identifier). Fuzzy counts inflate phase estimates and push real work into deferred phases that never land. Reviewers should ask "what grep produced this number?" for any phase that gates on a caller count.
- **Applied:** dismissed (single-operator project; skill prompt would add friction without preventing bugs)

### 7. Legally regulated UI content can't be parametrized like display labels
- **Target:** `claude_md`
- **From discrepancy:** #7
- **Recommendation:** Specs touching components that emit legal content (voting minutes, GDPR notices, statutory citations, accounting attestations) must call out which strings are display-only (parametrizable per-template/per-kind) and which carry statutory references (template-specific by law). The dispatch is not "wrap in `t()`" — it's "ship a separate template-aware content module or restrict the feature to the template that owns the statute". Default: assume legally regulated until proven display-only.
- **Applied:** yes

### 8. Plan-vs-reality phase granularity drift is expected for cross-cutting specs
- **Target:** `spec_skill`
- **From discrepancy:** (meta — applies to specs #1, #3, #4, #5)
- **Recommendation:** Architecturally-invasive specs (those touching schema + voting + UI + templates simultaneously) routinely split each phase into 2–3 sub-phases during implementation. This spec's 8 phases became ~14 sub-phases (1c, 2a/2b, 3b, 6/6b/6c, 7a/7b/7c, 8a/8b). `/spec-new` should default cross-cutting specs to a "phases are placeholders; expect sub-phasing" disclaimer in the Notes section, AND `/spec-promote spec → in_progress` should remind operators to run `/spec-retro` after every phase (already in spec Notes — but the reminder should also be in the skill).
- **Applied:** dismissed (single-operator project; skill prompt would add friction without preventing bugs)
