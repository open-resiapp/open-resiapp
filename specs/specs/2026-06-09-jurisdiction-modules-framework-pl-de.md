---
spec_id: BYT-20260609-007
title: "Jurisdiction modules + framework hardening + PL/DE (T5)"
status: spec
created: 2026-06-09
updated: 2026-06-09
author: byt-app
owner: filipvnencak
last_verified: 2026-06-09
project_type: other
depends_on:
  - RES-20260428-002   # plugin/module system (the framework being hardened)
  - RES-20260505-001   # voting as a free module (the module being split per-jurisdiction)
  - BYT-20260413-003   # czech voting rules (existing CZ rule values)
related_handoffs: []
tags:
  - modules
  - jurisdiction
  - i18n
  - voting
  - capability-security
  - nlnet-grant
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Deliver NLnet grant task **T5** (110 h): turn the voting subsystem's
**country-toggled code paths** into proper **jurisdiction modules** built on a
**hardened module framework**, prove the architecture on **four** legal systems by
adding **Poland (UWL)** and **Germany (WEG)** reference jurisdictions alongside the
existing **SK (§14a)** and **CZ (§1206/§1210)**, and add **Polish and German
translations** to the SK/CZ/EN locales. After T5, *a new country is a data + module
contribution, not a fork* (grant technical challenge #4), and *a module can be
installed without trusting it with the whole building's data* (challenge #6).

### Problem statement

Three concrete gaps between the grant's promise and the code:

1. **Country logic is toggled in shared code, not modular.** `modules/voting/src/
   rules/index.ts` hard-codes `Country = "sk" | "cz"`, `SK_RULES`/`CZ_RULES`
   constants, and a `Record<Country, …>` map; routes branch on
   `root?.country ?? "sk"`. `docs/domain/voting.md` already calls this out: *"until
   [the per-country module split] lands, every shared rule path is a legal
   liability."* Adding a country today means editing core, i.e. a fork-shaped change.
2. **Statutory content is hard-coded to SK.** `src/components/voting/
   VotingMinutesPDF.tsx` lives in **core** and cites SK law (§14 ods. 4 zák.
   182/1993 Z.z.) — the exact case CLAUDE.md flags as *not* naively parametrizable
   across jurisdictions. There is no seam for CZ/PL/DE statutory text.
3. **Module permissions are coarse.** The framework (RES-20260428-002) grants
   `db:read` / `db:write` wholesale and treats code signing as *optional*. The
   grant's challenge #6 wants capability-scoped data access ("smart-lock never sees
   the audit log; accounting never sees personal messages") and **signed** bundles.

## Scope

**In scope — five workstreams**

- **W1 — Rule-pack schema + registry (jurisdiction-as-data).** A typed rule-pack
  schema (extends the existing `CountryVotingRules`) and a **registry** that
  replaces the hard-coded `Record<Country, …>` and the `country` enum, so a
  jurisdiction's *rule values* are data.
- **W2 — Jurisdiction content modules (the statutory split).** A `JurisdictionProvider`
  interface supplying the *legally-regulated content* that does **not** parametrize
  — minutes/zápisnica statutory citations, mandate-document template, legal
  disclaimers. Refactor the core SK-specific `VotingMinutesPDF` to ask the active
  jurisdiction provider.
- **W3 — Extract SK & CZ into jurisdiction modules.** Move SK and CZ from
  country-toggled shared code into two modules (rule pack + content provider) with
  **no behavioural regression**.
- **W4 — PL & DE reference jurisdictions.** Two new jurisdiction modules (rule pack
  + content provider) for Poland (UWL) and Germany (WEG), proving the framework on
  four legal systems.
- **W5 — Framework hardening + PL/DE i18n.** Capability-scoped data-access contract,
  **mandatory** signed bundles, versioned migrations; and full `pl.json` / `de.json`
  locales added to SK/CZ/EN.

**Out of scope**
- Legal *certification* of PL/DE rule values — T9 legal opinions cover SK/CZ only.
  PL/DE values are best-effort reference implementations pending the published
  rule-pack open-draft + contributor/legal review (flagged in the catalog below).
- Austrian / Hungarian jurisdictions — invited as community contributions, not T5.
- Finance / service / integration module *implementations* — only the framework
  they plug into is in T5 scope (per the grant, those modules are v3.x).
- True runtime sandboxing (vm2 / isolated-vm / WASM) — remains RES-20260428-002
  Phase 2; capability scoping here is enforcement at the SDK boundary, not a VM.
- The notarised-mandate *workflow* itself — that is BYT-20260609-004; T5 only
  ensures each jurisdiction provider can supply its mandate-document template + the
  rule-pack flag for whether a mandate needs notarisation.

## Approach

### The load-bearing split: data vs statutory content

Per CLAUDE.md (legally-regulated content must not be naively parametrized):

- **Data-driven (rule pack):** numeric thresholds, enums, windows, booleans —
  quorum basis/threshold, abstain & silence semantics, per-rollam / written-ballot
  windows, electronic-voting blocks, notarisation flags. These parametrize cleanly.
  *A new jurisdiction's rule values are a data contribution.*
- **NOT data-driven (content module):** statutory citations in the minutes PDF, the
  mandate-document template, legal disclaimers. §14a / §1206 / UWL / WEG cite
  different laws that don't apply to each other. Each jurisdiction ships a
  **content provider**; core asks the *active* provider for citations instead of
  hard-coding SK.

This split is the spec. Getting it wrong (parametrizing statutes, or hard-coding
rule values) reproduces exactly the two gaps T5 exists to fix.

### W1 — Rule-pack schema & registry

Extend the existing `CountryVotingRules` (it already has `perRollamMinDays`,
`silenceIsNo`, `fallbackQuorum`, `ownersQuarterBlocksElectronic`,
`meetingBlocksElectronic`, `repeatedVoteEscalation`, `availableQuorumTypes`) into a
versioned `RulePack` that also expresses the dimensions the grant's challenge #4
names — **majority types, written-ballot windows, notarisation requirements**:

```ts
interface RulePack {
  schemaVersion: 1;
  jurisdiction: string;          // 'sk' | 'cz' | 'pl' | 'de' | future — a registry key, NOT an enum
  // — counting semantics —
  abstain: 'counts_against' | 'ignored';
  silence: 'not_counted' | 'counts_against_after_window';
  // — majority: basis × threshold (separated so PL share-basis and DE head-basis differ) —
  majorityBasis: ('present' | 'all_shares' | 'all_heads')[];
  majorityThreshold: ('simple' | 'two_thirds' | 'three_quarters' | 'unanimous')[];
  fallbackQuorum: number;        // náhradná schôdza / replacement assembly
  // — windows —
  perRollamMinDays: number | null;
  writtenBallotWindowDays: number | null;
  // — electronic voting blocks —
  electronicBlocks: { meeting: boolean; ownersQuarter: boolean };
  repeatedVoteEscalation: boolean;
  // — representation —
  mandateRequiresNotary: boolean;   // feeds BYT-20260609-004
  mandateChainingAllowed: false;    // never (§14a); kept explicit
}
```

A **registry** resolves `jurisdiction → RulePack` from data contributed by installed
jurisdiction modules, replacing `getVotingRules()`'s hard-coded map. The existing
helpers (`validatePerRollamDuration`, `isElectronicVotingBlocked`) read from the
resolved pack unchanged in signature.

**`country` enum → registry key.** `countryEnum = ["sk","cz"]` (`src/db/schema.ts:57`)
becomes a text jurisdiction key referencing the registry (so `pl`/`de`/future need
no enum migration). Per the CLAUDE.md enum→text rule, **grep every string literal**
`"sk"`/`"cz"` across `src/` and `modules/` first; each match becomes a code change
in the **same** migration PR (the known hotspots are `root?.country ?? "sk"` casts
in `modules/voting/src/routes/**`). Hand-written migration per the drizzle rules.

### W2 — Jurisdiction content provider

```ts
interface JurisdictionProvider {
  jurisdiction: string;
  rulePack: RulePack;
  // statutory content — per-jurisdiction, NOT parametrized:
  minutesStatutoryCitations(ctx): CitationBlock;   // for VotingMinutesPDF
  mandateDocumentTemplate(ctx): MandateTemplate;    // for BYT-20260609-004
  legalDisclaimers(ctx): Disclaimer[];
}
```

`VotingMinutesPDF.tsx` is refactored to be **jurisdiction-agnostic**: it asks the
active provider for its `CitationBlock` and renders that, instead of embedding
§14 ods. 4 zák. 182/1993 Z.z. Core ships **no** statute text after T5.

### W3 — Extract SK & CZ

Move the SK and CZ rule values + statutory content out of shared code into two
jurisdiction modules implementing `JurisdictionProvider`. Acceptance is **zero
behavioural regression**: existing SK/CZ votings produce byte-identical results and
minutes (a golden-file test over a fixture set guards this). The domain invariant
*"country-specific legal logic always lives inside the country's own voting module"*
(`docs/domain/voting.md`) is finally satisfied.

### W4 — PL & DE reference jurisdictions

Two new jurisdiction modules. Rule values are enumerated in the catalog below and
are **best-effort pending legal research** (not T9-certified). PL/DE content
providers supply their own statutory citations (UWL / WEG) and mandate templates.

### W5 — Framework hardening + i18n

- **Capability-scoped data access.** Replace coarse `db:read`/`db:write` with
  **resource-scoped** capabilities the module declares and the SDK enforces per
  call: a module sees only the data domains it was granted. Taxonomy (illustrative):
  `read:members`, `read:voting`, `read:audit`, `read:messages`, `read:finance`,
  `write:*` counterparts, `hardware:access`. Worked guarantees from challenge #6: a
  **smart-lock** module gets `hardware:access` (+ maybe `read:members`) but **never**
  `read:audit`; an **accounting** module gets `read:units`/`write:finance` but never
  `read:messages`. The grant diff on install shows the *scoped* set, not "db:read".
- **Mandatory signed bundles.** Promote RES-20260428-002's *optional* signing to
  required: a detached signature over the bundle, verified on install against a
  configured trusted-publisher key set; unsigned/untrusted bundle → install refused.
  Checksum stays for integrity; signature adds authenticity.
- **Versioned migrations.** Each module's migrations carry a schema version; core
  records applied versions per module and refuses a downgrade.
- **PL/DE i18n.** Add `pl.json` and `de.json`. This is a **locale rollout** — per
  CLAUDE.md it commits to **full key coverage** of every key present in `sk.json`
  (the source of truth), or files one follow-up ticket per untranslated namespace;
  no bounded "key surfaces" subset. Jurisdiction modules contribute their own
  statutory strings in all five locales.

#### FOUC / locale subsection (per CLAUDE.md cross-cutting rule)

Locale is **server-resolved from the URL prefix** (`/sk/`, `/cz/`, `/pl/`, `/de/`,
`/en/`) via next-intl + middleware — the server paints the correct locale on first
render, so adding PL/DE introduces **no FOUC and no flicker** on RSC navigation.
PL and DE are both **LTR**, so no RTL/bidi work. The only guard-rail: the
language-switcher and `<html lang>` must update from the URL-resolved locale (they
already do), and any new locale must be registered in `src/i18n/routing.ts` so the
middleware matcher includes it — otherwise its routes 404 rather than flicker.

### Jurisdiction catalog (full enumeration — per CLAUDE.md catalog rule)

The rule-pack registry is a reference catalog; it MUST land complete before any
bootstrap reads it. SK/CZ values are grounded in current code; **PL/DE are
best-effort, pending the rule-pack open-draft research and NOT T9-certified**.

| Field | SK (§14a 182/1993) | CZ (§1206/§1210 89/2012) | PL (UWL) ⚠ | DE (WEG §25) ⚠ |
|---|---|---|---|---|
| `abstain` | counts_against | ignored | TBD | TBD |
| `silence` | not_counted | counts_against_after_window | TBD | TBD |
| `perRollamMinDays` | null | 15 | TBD | TBD |
| `writtenBallotWindowDays` | TBD | TBD | TBD | TBD |
| `fallbackQuorum` | 0.5 | 0.4 | TBD | n/a (post-2020 WEMoG: no quorum) ⚠ |
| `majorityBasis` | all_shares | all_shares | all_shares (udział) ⚠ | all_heads default / per Gemeinschaftsordnung ⚠ |
| `majorityThreshold` | simple / two_thirds / unanimous | simple / two_thirds / unanimous | simple (majority of shares) ⚠ | simple of votes cast; circular = unanimous ⚠ |
| `electronicBlocks.meeting` | true | true | TBD | TBD |
| `electronicBlocks.ownersQuarter` | true | false | TBD | TBD |
| `repeatedVoteEscalation` | true | false | TBD | TBD |
| `mandateRequiresNotary` | true | TBD | TBD | TBD |

⚠ = legal accuracy is a research/contributor task; the framework must accept these
as data so corrections are data edits, not code changes. PL/DE statutory citations
live in their content providers, not this table.

## Acceptance Criteria

**Architecture (W1/W2)**
- [ ] `getVotingRules()`'s hard-coded `Record<Country,…>` is replaced by a registry
      resolving `jurisdiction → RulePack` from installed jurisdiction modules.
- [ ] The `RulePack` schema expresses quorum basis+threshold, abstain/silence
      semantics, per-rollam & written-ballot windows, electronic-voting blocks, and
      notarisation flags.
- [ ] `VotingMinutesPDF` contains **no** statute text; it renders the active
      jurisdiction provider's `CitationBlock`. Core ships no statutory citations.
- [ ] The `country` enum is converted to a registry-key text column; a grep proves
      every `"sk"`/`"cz"` string literal across `src/` + `modules/` was updated in
      the same migration PR.

**Extraction & no-regression (W3)**
- [ ] SK and CZ rule values + statutory content live in their own jurisdiction
      modules; no country branch remains in shared voting code.
- [ ] A golden-file test over a fixture set shows existing SK/CZ votings produce
      byte-identical results and minutes pre/post extraction.

**PL & DE (W4)**
- [ ] PL and DE jurisdiction modules install and provide a `RulePack` + content
      provider; a voting can be created and resolved under each.
- [ ] PL/DE rule values are sourced from the registry as data; correcting a value
      is a data edit, not a code change.

**Framework hardening (W5)**
- [ ] A module declares resource-scoped capabilities; an SDK call outside the
      granted scope throws `PermissionDeniedError`. Demonstrated: the `intercom-2n`
      module cannot read voting/audit data; an accounting fixture module cannot read
      messages.
- [ ] The install permission diff shows scoped capabilities, not `db:read`.
- [ ] An unsigned or untrusted-key bundle is refused on install; a validly signed
      bundle installs.
- [ ] Module migrations are versioned; a downgrade is refused.

**i18n (W5)**
- [ ] `pl.json` and `de.json` exist and cover every key in `sk.json`, or a
      per-namespace follow-up backlog ticket exists for any gap (no silent subset).
- [ ] `pl` and `de` are registered in `src/i18n/routing.ts`; their URL-prefixed
      routes render server-side with no flicker; `<html lang>` resolves correctly.
- [ ] Each jurisdiction module ships its statutory strings in all five locales.

## Project Context

- **Rules today:** `modules/voting/src/rules/index.ts` — `Country = "sk"|"cz"`,
  `SK_RULES`/`CZ_RULES`, `getVotingRules()`, `validatePerRollamDuration()`,
  `isElectronicVotingBlocked()`. Consumed by `engine/index.ts` and
  `routes/api/votes|votings` (`root?.country ?? "sk"`).
- **Statutory content today:** `src/components/voting/VotingMinutesPDF.tsx` (core,
  SK-specific) — the refactor target; `DownloadMinutesButton`, `VotingResults`
  nearby.
- **Country source:** `countryEnum` (`src/db/schema.ts:57`, `sk|cz`) on the root
  entity — becomes a registry key.
- **Module framework:** RES-20260428-002 — coarse `Permission` union
  (`db:read|db:write|ui:inject|hardware:access|api:external`), `core_module_grants`
  table, *optional* signing, per-module migrations. T5 hardens these.
- **Voting-as-module:** RES-20260505-001 — voting is already a module
  (`modules/voting`); T5 splits its jurisdiction layer further.
- **CZ rules origin:** BYT-20260413-003.
- **Locales today:** `sk.json`, `cs.json`, `en.json` (verified) — T5 adds `pl`, `de`.
- **Mandate hook:** `RulePack.mandateRequiresNotary` + the provider's mandate
  template feed BYT-20260609-004.
- **CLAUDE.md rules applied:** legally-regulated-content split (W2); full catalog
  before bootstrap (the jurisdiction table); enum→text grep discipline (W1);
  full-coverage locale rollout + FOUC (W5).

## Notes

### Open questions before `in_progress`

- **PL/DE legal values:** the catalog's ⚠ cells need real legal research. The grant
  funds PL/DE as *reference* implementations and commits to publishing the rule-pack
  format as an open draft — accuracy can land as data after the framework. T9 does
  **not** cover PL/DE. Decide how PL/DE values are validated (community legal
  contributors? a small separate review?).
- **Capability taxonomy granularity:** per-domain (`read:voting`) vs per-table vs
  per-record. Per-domain is the MVP sweet spot; per-record is future. Confirm the
  domain list and map every existing SDK accessor to a capability.
- **Signed-bundle trust model:** who are the trusted publishers (the project's key?
  the operator's own key for first-party modules?) and how is the key set
  configured on a self-host. Define before making signing mandatory, or self-host
  installs break.
- **DE quorum model:** post-2020 WEMoG removed the quorum requirement and changed
  majority mechanics — the `fallbackQuorum`/quorum fields must tolerate a
  "no-quorum" jurisdiction cleanly (nullable), which also stresses the schema's
  generality. Good forcing function; confirm the schema handles it.

### Phasing (≈110 h)

1. **Rule-pack schema + registry + enum→key migration** (~25 h) — W1.
2. **JurisdictionProvider + VotingMinutesPDF refactor** (~20 h) — W2.
3. **Extract SK & CZ + golden-file no-regression tests** (~25 h) — W3.
4. **Framework hardening: capabilities + signed bundles + versioned migrations**
   (~25 h) — W5 framework half.
5. **PL & DE modules + pl/de locales** (~15 h) — W4 + W5 i18n.

Placement note: filed in `specs/specs/` (status `spec`). This is the last funded
*code* deliverable without a spec; with it, every T1–T5 task plus the mandate and
GDPR challenges are specced. Promotion to `in_progress` is gated on the capability
taxonomy + signed-bundle trust-model decisions (framework half) and is independent
of the PL/DE legal-value research (which lands as data).
