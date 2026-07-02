---
retro_for: BYT-20260609-008
spec_title: "Multi-item votings (multiple resolutions per voting, one signed ballot)"
created: 2026-07-02
status: pending
---

## Discrepancies

### 1. Audit-bundle dependency was inverted
- **Category:** spec_wrong
- **Spec said:** `depends_on: [… BYT-20260518-001]` (audit bundle) and co-designed the
  per-item leaf schema against it.
- **Implementation did:** Audit bundle (518) is still `spec` (unbuilt). Multi-item was
  built first (Option B) and unilaterally **pinned** the canonical hash forms
  (`ballotHash`, `itemAuditHash`) in migration 0046 + engine for the audit bundle to
  adopt later.
- **Why:** Building the audit bundle first would have blocked delivery; the hash formats
  are simple enough to pin now and have 518 consume them.

### 2. External API consumer missing from "Cross-spec impact"
- **Category:** spec_incomplete
- **Spec said:** Cross-spec impact listed audit bundle, passkey, mandate, domain doc,
  minutes — but not the external API.
- **Implementation did:** `/api/external/v1/votings*` read `votings.quorum_type` +
  `mod_voting_votes`; both were being dropped, so the endpoints had to be rewritten
  (kept backward-compatible: top-level `quorumType`/`voteCounts`/`votes` mirror item[0],
  plus a new `items[]`).
- **Why:** The impact analysis focused on internal voting UI/engine and other specs, and
  missed the public API surface that also reads the affected columns/tables.

### 3. Module hook side-effect (`onVoteCreate`) not inventoried
- **Category:** spec_incomplete
- **Spec said:** Nothing about the `onVoteCreate` module dispatch hook.
- **Implementation did:** The legacy `POST /api/votes` dispatched `onVoteCreate` (+ sent
  a confirmation email). The new `/api/ballots` path does neither, so vote-triggered
  module notifications silently stopped firing. Left dormant as a tracked follow-up.
- **Why:** The spec treated the change as data-model + UI; it didn't inventory
  side-effects (dispatch hooks, emails) attached to the old write path.

### 4. Single migration vs additive-then-drop
- **Category:** better_approach
- **Spec said:** Migration section described one migration: create tables → backfill →
  "drop `quorumType` and `mod_voting_votes` after backfill is verified."
- **Implementation did:** Split into two migrations — `0046` (additive: create +
  backfill, legacy kept) and `0047` (destructive drop), with a dual-model window
  between, mirroring the housing_unit_data → 0036 precedent. Kept the build green and
  every phase shippable.
- **Why:** A single create+backfill+drop migration would have forced all consumer
  rewrites into one non-shippable step and left no verification window before the
  irreversible drop.

## Deferred Items

- [ ] Ballot-level **email confirmation** — deferred because: the legacy
  `sendVoteConfirmation` is single-choice; a ballot covers many items and needs its own
  copy/design. Tracked in the spec's follow-ups.
- [ ] **`onVoteCreate` notification re-wire** — deferred because: hook payload is
  single-choice; ballot-level notification shape is undecided.
- [ ] **T5 quorum double-migration** — deferred because: Option B was chosen (ship now,
  accept a second `voting_items.quorum_type` migration under T5 W1). Spec flagged it.

## Findings

### 1. Table-replacement / column-drop specs must carry a full consumer inventory
- **Target:** spec_skill
- **From discrepancy:** #2, #3
- **Recommendation:** For any spec that drops a table/column or replaces a data-write
  path, require a "Consumer inventory" subsection that greps ALL readers/writers of the
  affected tables/columns and lists, per consumer, whether it is migrated / kept
  backward-compatible / deferred. The inventory must explicitly include (a) **external
  and public API** surfaces and (b) **side-effects on the old write path** — dispatch
  hooks, emails, notifications, webhooks — not just direct SQL readers.
- **Applied:** no

### 2. Structural table replacements ship as additive-migration → drop, never one migration
- **Target:** claude_md
- **From discrepancy:** #4
- **Recommendation:** Extend the Database rules: a spec/PR that replaces a table or
  moves a column must land as **two migrations** — an additive one (create + backfill,
  legacy retained = dual-model window) and a later destructive one (DROP), after the
  backfill is verified and all consumers are switched. A single create+backfill+drop
  migration is rejected. (Codifies the housing_unit_data → 0036 / 0046 → 0047 pattern.)
- **Applied:** no

### 3. `depends_on` must distinguish hard deps from soft/co-design deps
- **Target:** spec_skill
- **From discrepancy:** #1
- **Recommendation:** In the spec frontmatter/template, split dependencies into
  "hard" (must be implemented first) vs "soft/co-design" (shared contract, either order).
  When an output format (hash, serialization, canonical encoding) will be consumed by a
  not-yet-built soft dependency, the spec must **pin the canonical format here** (and in
  code/migration) so the dependency adopts it — rather than listing it as `depends_on`
  and implying the reverse build order.
- **Applied:** no

## Notes

The spec was strong where the project already has hard rules: schema shape,
`onDelete` on every FK (the one omission — `ballots.ownerId` — was caught by the
existing CLAUDE rule), and the undo/withdraw path (covered because of the
per-user-mutable-record rule). The gaps were all at the **boundaries** the spec didn't
look across: public API, dispatch side-effects, and dependency build-order.
