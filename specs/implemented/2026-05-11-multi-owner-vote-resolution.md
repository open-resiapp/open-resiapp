---
spec_id: BYT-20260511-001
title: "Multi-owner vote resolution per §14 zák. 182/1993 Z.z."
status: implemented
created: 2026-05-11
updated: 2026-05-12
author: byt-app
owner: byt-app
last_verified: 2026-05-12
project_type: node
depends_on: [BYT-20260508-003]
related_handoffs: []
tags: [voting, multi-owner, legal-compliance, refactor, engine, slovak-law]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Make multi-owner flats vote correctly under Slovak HOA law (zák. č. 182/1993 Z.z.
o vlastníctve bytov a nebytových priestorov). Today the voting engine reads
`housing_unit_data.shareNumerator/Denominator` per membership, so a flat with two
co-owners has its full unit weight counted **twice** — a quiet but
material accounting bug that distorts every tally for any community that ever
records co-ownership (BSM spouses, heirs, sales-in-progress, divorced couples,
etc.).

The fix is twofold: (a) stop double-counting by treating each unit as a single
weight regardless of how many memberships back it, and (b) resolve co-owner
disagreement the way the law actually prescribes — `spoluvlastníci majú spolu
jeden hlas` (§14 ods. 4), with internal disputes settled by majority of unit
shares per §139 ods. 2 Občianskeho zákonníka, falling back to "byt sa zdržal"
when co-owners tie.

## Scope

**In scope**

- Voting engine refactor in `modules/voting/src/engine/index.ts`: group votes by
  unit, resolve per-unit collective stance via majority of co-owner unit-shares,
  emit one weighted contribution per unit (not per membership).
- Schema additions on `memberships`:
  `owner_unit_share_numerator INTEGER NOT NULL DEFAULT 1`,
  `owner_unit_share_denominator INTEGER NOT NULL DEFAULT 1`. Existing single-owner
  memberships get `1/1` automatically (one owner = whole unit).
- Backfill migration that sets `1/1` on every existing membership row. The
  refactor is a no-op for any unit that has exactly one owner — only multi-owner
  flats see behavioural change.
- Drop reliance on `memberships.weight` as an integer rational approximation
  (the column exists but is unused today by the engine). Keep the column for
  future per-flat / per-area weighting, but stop encoding share-of-unit in it.
- New result shape returned by the engine: per-unit breakdown showing each
  co-owner's expressed choice + share + the resolved unit choice + the rationale
  ("majorita podielov ZA", "rovnosť hlasov, byt sa zdržal", "jednomyseľne PROTI").
- Zápisnica PDF: when a unit has > 1 owner, render the per-owner breakdown and
  the resolution rationale below the unit row.
- Quorum counting: a unit counts as "voted" (toward presence quorum) if **at
  least one** of its co-owners cast any choice — even if the resolved unit
  choice is `zdrzal_sa` from a tie.
- Empty-set handling: a unit where no co-owner has voted does not contribute to
  the tally and does not count toward quorum.
- Backwards-compatibility layer in `src/lib/legacy-compat.ts` updated in the
  same PR so older legacy-compat consumers don't double-count either.
- Tests: full coverage of the resolution table (see Acceptance Criteria), plus
  a fixture from LV č. 3182 byt 82 (five owners at `1/2 + 1/6 + 1/12 + 1/6 + 1/12`).

**Out of scope**

- Changing the public vote-casting UI (`src/components/voting/*`). Each co-owner
  still sees and casts their own vote; the engine just interprets the results
  differently. UI changes for breakdown-display are limited to the results page
  and the zápisnica.
- Re-voting on already-tallied historical votings. Migration only changes future
  results; closed votings keep their stored final values (we do not recompute
  history retroactively because that would invalidate signed zápisnice).
- A "challenge / override majority" UI for the minority co-owner. Slovak law
  routes that through court, not the app.
- Cross-unit weighting changes (`per_flat`, `per_area`). Only `per_share` mode
  changes here. The other modes already aggregate one weight per unit
  correctly (`per_flat: 1`, `per_area: unit.area`).
- Real-time live tallying. Resolution happens server-side at result-fetch time;
  intermediate states during an open vote use the same logic but produce
  provisional output.

## Approach

### 1. Legal framing — why Option C

Three architectures were considered:

| Option | Model | Verdict |
|---|---|---|
| A | Single shared vote slot per unit; first co-owner to vote claims it; others must agree or are blocked. | Legally clean but a race condition in UX; rejected. |
| B | Per-owner split-weight (each membership has `unit_weight × owner_unit_share`); independent voting, sum fractions in tally. | What most paid SK tools (eSchody, Mojepartner) do. Easier, but does not match `spoluvlastníci majú spolu jeden hlas`. Auditable as "we let each co-owner have their slice" — defensible in a friendly audit, hostile in court. |
| **C** | **Per-owner expression + per-unit collective resolution by majority of unit-shares.** | Matches §14 ods. 4 + §139 ods. 2 OZ literally. Each co-owner still votes independently in the UI; engine resolves internally before adding to community tally. Tie → unit `zdrzal_sa`. |

This spec implements **Option C**.

### 2. Schema changes

```ts
// src/db/schema.ts — memberships table
export const memberships = pgTable("memberships", {
  // ... existing columns
  ownerUnitShareNumerator: integer("owner_unit_share_numerator")
    .notNull()
    .default(1),
  ownerUnitShareDenominator: integer("owner_unit_share_denominator")
    .notNull()
    .default(1),
  // ... rest
});
```

Migration `drizzle/00XX_membership_unit_share.sql`:

```sql
ALTER TABLE memberships
  ADD COLUMN owner_unit_share_numerator INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN owner_unit_share_denominator INTEGER NOT NULL DEFAULT 1;

-- Backfill: every existing membership is treated as sole owner.
-- Multi-owner units that were entered manually (no easy_import yet) end up
-- with 1/1 each, which over-weights them — flagged for admin review (see
-- Acceptance Criteria).
COMMENT ON COLUMN memberships.owner_unit_share_numerator IS
  'Owner''s share of the unit (numerator). For BSM co-owners and heirs, 1/2 each. Defaults to 1/1 for sole owners. Validated: per-unit sum across active memberships must equal 1/1.';
```

The constraint that per-unit owner shares sum to `1/1` is enforced at
application level (in import + entity-tree UI), not via a SQL CHECK, because
adding/removing co-owners is multi-step and would require deferred constraints.

### 3. Engine refactor

`modules/voting/src/engine/index.ts` gains a unit-grouping pass:

```ts
// New input shape — vote now carries owner's unit-share, not unit's
// share-of-community (which is on the unit, not the membership).
export interface VoteWithOwnership {
  votingId: string;
  unitEntityId: string;
  userId: string;
  choice: VoteChoice;
  // unit-level (constant per unitEntityId across rows):
  unitShareNumerator: number;
  unitShareDenominator: number;
  area: number | null;
  // owner-level (varies per co-owner):
  ownerUnitShareNumerator: number;
  ownerUnitShareDenominator: number;
}

export interface UnitResolution {
  unitEntityId: string;
  resolved: VoteChoice | "zdrzal_sa"; // ties resolve to zdrzal_sa
  rationale:
    | "single_owner"
    | "unanimous"
    | "majority_share"
    | "tie_abstain"
    | "no_quorum_within_unit"; // only some co-owners voted, no majority
  breakdown: Array<{
    userId: string;
    choice: VoteChoice;
    ownerShareNum: number;
    ownerShareDen: number;
  }>;
  unitWeight: number; // share-of-community as float, for tally
}

export function resolveUnitVote(
  votes: VoteWithOwnership[],
): UnitResolution {
  // All votes share the same unitEntityId.
  const unit = votes[0];
  const unitWeight =
    unit.unitShareNumerator / unit.unitShareDenominator;

  if (votes.length === 1) {
    return {
      unitEntityId: unit.unitEntityId,
      resolved: unit.choice,
      rationale: "single_owner",
      breakdown: [/* ... */],
      unitWeight,
    };
  }

  // Sum owner-unit-shares per choice using exact rational arithmetic.
  // Keep numerators on a common denominator (LCM of owner denominators).
  const sumByChoice = sumOwnerSharesByChoice(votes);
  // sumByChoice = { za: rational, proti: rational, zdrzal_sa: rational }

  const expressedTotal = add(sumByChoice.za, sumByChoice.proti, sumByChoice.zdrzal_sa);
  // Note: expressedTotal may be < 1/1 if not every co-owner voted.

  const max = maxRational(sumByChoice);
  const tied = countAtMax(sumByChoice, max) > 1;

  if (tied) {
    return { /* resolved: "zdrzal_sa", rationale: "tie_abstain", ... */ };
  }
  // Unique majority among expressed votes wins the unit's collective stance.
  return { /* resolved: argmax, rationale: "unanimous" or "majority_share", ... */ };
}
```

Aggregate over the community:

```ts
export function calculateResults(
  votes: VoteWithOwnership[],
  method: VotingMethod,
  quorumType: QuorumType,
  totalPossibleWeight: number,
  options: CalculateResultsOptions = {},
): VotingResults {
  const byUnit = groupBy(votes, (v) => v.unitEntityId);
  const unitResolutions = Object.values(byUnit).map(resolveUnitVote);

  let zaWeight = 0, protiWeight = 0, zdrzalSaWeight = 0;
  for (const u of unitResolutions) {
    const w = getWeightForMethod(u, method);
    if (u.resolved === "za")          zaWeight += w;
    else if (u.resolved === "proti")  protiWeight += w;
    else                              zdrzalSaWeight += w; // ties + abstains
  }
  // ... existing quorum logic, unchanged
}
```

The `VoteWithShare` shape and `aggregateFlatsForVoter` (which currently sums a
single voter's flats) are kept for the case where the same user owns multiple
flats — that aggregation still happens, but now the per-flat contribution is
correctly the unit's resolved choice, not raw double-counted weight.

### 4. Rational arithmetic

All resolution math runs in exact rationals (`bigint` numerator + `bigint`
denominator) until the final aggregate is exposed as float for percent display.
Reasons:

- Floating-point comparison of `1/2 vs 1/2` is unreliable. We must detect ties
  exactly.
- LV č. 3182 byt 82 uses denominators up to 12; mixed denominators across flats
  span at least `{1, 2, 3, 4, 6, 8, 10, 12, 96}`. LCM stays small (well within
  `Number.MAX_SAFE_INTEGER`) but `bigint` is the defensive choice.
- The exact rational `unitShare × ownerUnitShare` is also written to
  `memberships` via the import spec (BYT-20260508-003), so the same arithmetic
  must give identical results in both contexts.

A small helper in `src/lib/rational.ts` (new file) exports `add`, `mul`,
`compare`, `gcd`, `lcm`, `reduce`, `toFloat` over `{ num: bigint, den: bigint }`.

### 5. Zápisnica / PDF rendering

When the PDF generator hits a unit with > 1 active membership in the
voting's snapshot, render a sub-table:

```
Byt 82 (vchod 11, prízemie)                        váha bytu: 1/96
  Mudrák Peter            podiel 1/2  ZA
  Brošková Katarína       podiel 1/6  ZA
  Mudráková Ema           podiel 1/12 PROTI
  Krišková Veronika       podiel 1/6  ZA
  Mudráková Martina       podiel 1/12 PROTI
  Výsledok bytu: ZA (väčšina podielov 5/6 ZA, 1/6 PROTI)
```

For a tied unit:

```
Byt 10 (vchod 1, 4.p)                              váha bytu: 1/96
  Štolc Ondrej (st.)      podiel 1/2  ZA
  Štolc Ondrej (ml.)      podiel 1/2  PROTI
  Výsledok bytu: ZDRŽAL SA (rovnosť podielov spoluvlastníkov, byt nehlasuje
  podľa §14 ods. 4 zák. 182/1993 Z.z.)
```

The legal citation is parameterised by the country (Slovakia: §14 ods. 4 zák.
182/1993; Czechia: separate citation in the existing CZ ruleset).

### 6. Quorum semantics

A unit counts toward presence quorum (`quorumReached` check) if **any** of its
co-owners has voted. The resolved choice does not affect whether the unit was
"present" — only what its single vote was. This matches the schôdza analogue:
if any co-owner shows up, the unit is represented.

A unit where the resolved choice is `zdrzal_sa` (either because a co-owner
voted abstain, or because of an internal tie) contributes its weight to
`zdrzalSaWeight` and to `totalWeight`, but **not** to `zaWeight` — so the
`two_thirds_all` and `simple_all` thresholds still require `za > X%` of
`totalPossibleWeight`, unchanged.

### 7. Backfill / data-migration concerns

Existing communities entered manually (before BYT-20260508-003 import ships):

- Single-owner flats: trivially `1/1`, no behavioural change. Engine path is
  short-circuited (`single_owner` rationale).
- Multi-owner flats entered with current schema (no `owner_unit_share_*`):
  default `1/1` per the migration. **This means the sum across active
  memberships for that unit is > 1/1**, an invariant violation. Flag these in
  an admin warning banner: "X bytov má neúplne vyplnené podiely spoluvlastníkov.
  Doplnite v správe vlastníkov."
- Provide a one-shot admin tool: "Rozdeliť rovnakým dielom" — for each flagged
  unit, set every owner's `owner_unit_share` to `1/N` where N is the number of
  active memberships. Most BSM cases will be `1/2 + 1/2`; this is a safe
  default but admins should verify.
- Do **not** auto-run this on migrate; it must be an explicit admin action with
  per-flat confirmation, because the wrong split is worse than a flagged
  inconsistency.

### 8. BSM special-case (deferred)

Question raised during spec drafting: should BSM (bezpodielové spoluvlastníctvo
manželov) co-owners be forced to vote identically, since legally they are one
indivisible vlastník? Today, BSM spouses each have their own `users` row and
their own `memberships`, so they can technically express different choices.

Decision for v1: **do not enforce BSM unanimity in code**. If BSM spouses
disagree, the engine resolves them like any other co-owner pair — at `1/2 + 1/2`
that's a tie → `zdrzal_sa`. This is legally defensible (the byt cannot reach
internal agreement, so it does not vote) and lets the spouses sort it out
privately. A future spec may add a "BSM marker" on a membership to enforce
unanimity at the UI level if customers ask.

## Acceptance Criteria

- [ ] Migration adds `owner_unit_share_numerator` and `owner_unit_share_denominator`
      to `memberships` with default `1/1`; all existing rows are `1/1` after the
      backfill.
- [ ] Engine emits one weighted contribution per unit, never per membership;
      verified by a fixture with a 2-owner flat where both vote ZA → tally
      receives `unit_weight` once (not twice).
- [ ] Single-owner flats produce identical results before and after the refactor
      for every existing voting fixture (regression: no change in the
      single-owner path).
- [ ] Resolution table (see below) — each case has a unit-test:

| # | Co-owner shares | Their choices | Expected unit choice | Rationale |
|---|---|---|---|---|
| 1 | `1/1` (sole owner) | ZA | ZA | `single_owner` |
| 2 | `1/1` (sole owner) | (no vote) | (unit not counted) | n/a |
| 3 | `1/2 + 1/2` | ZA, ZA | ZA | `unanimous` |
| 4 | `1/2 + 1/2` | ZA, PROTI | ZDRŽAL SA | `tie_abstain` |
| 5 | `1/2 + 1/2` | ZA, (no vote) | ZA | `majority_share` (only expressed counts) |
| 6 | `1/2 + 1/2` | (no vote, no vote) | (unit not counted) | n/a |
| 7 | `1/4 + 1/4 + 1/2` | ZA, ZA, NO | ZDRŽAL SA | `tie_abstain` (1/2 vs 1/2) |
| 8 | `1/4 + 1/4 + 1/2` | ZA, NO, NO | PROTI | `majority_share` |
| 9 | `1/4 + 1/4 + 1/2` | ZA, ZA, ZA | ZA | `unanimous` |
| 10 | `1/4 + 1/4 + 1/2` | (no vote), NO, ZA | ZA | `majority_share` (1/2 ZA > 1/4 PROTI) |
| 11 | `1/3 + 1/3 + 1/3` | ZA, ZA, NO | ZA | `majority_share` |
| 12 | `1/3 + 1/3 + 1/3` | ZA, NO, ABSTAIN | ZDRŽAL SA | `tie_abstain` (three-way 1/3 each) |
| 13 | `3/4 + 1/4` | NO, ZA | PROTI | `majority_share` (majority owner always wins binary tie-free) |
| 14 | `7/8 + 1/8` | ZA, NO | ZA | `majority_share` |
| 15 | `1/2 + 1/6 + 1/12 + 1/6 + 1/12` (byt 82) | ZA, ZA, NO, ZA, NO | ZA | `majority_share` (5/6 vs 1/6) |
| 16 | `1/2 + 1/2` (BSM spouses) | ZA, PROTI | ZDRŽAL SA | `tie_abstain` — BSM disagreement is not auto-resolved in v1 |

- [ ] Quorum: a unit counts as "voted" if ≥ 1 co-owner cast any choice; verified
      by `simple_all` quorum on a 100-flat community where 51 flats have at
      least one co-owner voting ZA, 49 fully abstain → quorum reached.
- [ ] Zápisnica PDF: a multi-owner unit renders the per-owner breakdown and the
      legal citation (`§14 ods. 4 zák. 182/1993 Z.z.` for SK, equivalent CZ
      citation when `country = 'cz'`).
- [ ] Admin warning banner: communities with units whose owner-unit-share sum
      ≠ `1/1` show a banner with a "Skontrolovať" link to the entity-tree UI;
      banner clears when all sums are exactly `1/1`.
- [ ] No retroactive change: votings with `status = 'completed'` keep their
      stored final tallies. Verified by snapshotting one closed voting before
      and after migration deploy.
- [ ] All wizard / banner / result-page strings use `useTranslations()` and land
      in both `messages/sk.json` and `messages/en.json` in the same commit.
- [ ] Engine has zero `Number` arithmetic for share comparison — all comparisons
      use the `rational` helper.

## Project Context

**Touched files**

- `src/db/schema.ts` — add two columns to `memberships`.
- `drizzle/00XX_membership_unit_share.sql` — new migration + comment.
- `modules/voting/src/engine/index.ts` — main refactor; introduce `resolveUnitVote`,
  `VoteWithOwnership`, `UnitResolution`. Keep `aggregateFlatsForVoter` for the
  one-user-many-flats case but feed it unit-resolved choices.
- `modules/voting/src/routes/api/votes/index.ts` — query joins `memberships`
  for `ownerUnitShare*`; emits `VoteWithOwnership[]`.
- `modules/voting/src/db/queries.ts` (if it exists) — query updates.
- `src/lib/legacy-compat.ts` — same update; do not let legacy callers
  double-count.
- `src/lib/rational.ts` — new helper, BigInt-based rationals.
- `src/lib/voting-pdf.ts` or wherever zápisnica generation lives — per-unit
  breakdown rendering + legal citation.
- `messages/sk.json`, `messages/en.json` — new keys under `Voting.Resolution`
  namespace: `tieAbstain`, `majorityShare`, `unanimous`, `singleOwner`,
  `breakdownLegalCitationSK`, `breakdownLegalCitationCZ`, plus the admin
  warning banner copy.
- `src/components/voting/VotingResults.tsx` (or equivalent) — show per-unit
  breakdown panel when a unit has > 1 active membership.
- `src/app/[locale]/(dashboard)/dashboard/page.tsx` or layout — admin banner
  for inconsistent owner-unit-share sums.
- Tests: `modules/voting/src/engine/__tests__/resolution.test.ts` (new),
  `modules/voting/src/engine/__tests__/regression.test.ts` (existing — must stay
  green for single-owner cases).

**Why this matters**

This bug has been latent because the project's pre-import data is almost
entirely single-owner. As soon as the BYT-20260508-003 import lands and a real
LV is seeded (LV č. 3182 has 24+ co-ownership cases out of 96 flats — 25% of
the building), every vote tally would silently double-count those units. The
import spec depends on this refactor to ship in the same release, otherwise the
first community to use the importer will have visibly wrong vote counts within
days.

**Reference architecture**

`open-housing` voting already has country-pluggable rules (`getVotingRules`).
Extend the same pattern for per-country legal citations in the breakdown.

## Notes

- **Legal interpretation source.** §14 ods. 1, 4 zák. 182/1993 Z.z. + §139
  ods. 2 zák. 40/1964 Zb. (Občiansky zákonník). The "väčšina podielov" rule from
  §139 ods. 2 OZ is the standard route for resolving co-owner disputes in
  common-ownership matters; applying it to voting is the conservative reading.
- **Why not Option B (split-weight) even though competitors use it.** Two
  reasons. First, `spoluvlastníci majú spolu jeden hlas` reads literally; "we
  let each have a fractional vote" is a re-interpretation. Second, the per-unit
  resolution gives transparent, auditable rationale in the zápisnica, which is
  the kind of evidence that survives a court challenge from a disgruntled
  vlastník. Speed of implementation is the only argument for B.
- **Why ties always abstain rather than picking a default.** §14 ods. 4 implies
  the unit must have a unified position. If co-owners can't reach one, the
  byt has not formed a hlas — the legally correct outcome is "byt sa nehlasoval"
  (counted toward presence quorum, not toward the substantive tally).
- **Heir-and-parent edge case (byt 10 in LV č. 3182).** Father and son both
  named Štolc Ondrej, each `1/2`. They are separate `users` rows (different
  DOB). The engine handles them as ordinary co-owners; the zápisnica shows
  their DOBs implicitly by their birth-year-distinguished display names (the
  shell-user creation logic during import preserves both as separate rows even
  though the source name is identical).
- **Future BSM-marker spec.** If a customer reports that BSM spouses
  consistently want to vote together but disagree mid-schôdza by accident,
  consider a `memberships.bsm_partner_membership_id` self-reference that forces
  unanimity at the UI level (first spouse to vote casts the BSM pair's joint
  vote; second spouse sees a confirm/dissent prompt). Not in scope for v1.
- **Czech equivalent.** §1187 zák. č. 89/2012 Sb. (CZ Civil Code) has a similar
  per-unit-vote rule for SVJ; the country-pluggable rules already accommodate
  this. Verify the exact wording during implementation.
- **Test fixture from real LV.** Use `tests/fixtures/lv-3182-poprad.txt`
  (redacted) for both this spec's resolution table case #15 (byt 82) and the
  import spec's parse fixture. Same source of truth, two consumers.
