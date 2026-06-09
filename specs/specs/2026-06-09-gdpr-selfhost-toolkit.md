---
spec_id: BYT-20260609-006
title: "GDPR self-host toolkit — consent export & privacy-policy generator"
status: spec
created: 2026-06-09
updated: 2026-06-09
author: byt-app
owner: filipvnencak
last_verified: 2026-06-09
project_type: other
depends_on:
  - RES-20260428-002   # module system (installed modules declare data they touch)
related_handoffs: []
tags:
  - gdpr
  - privacy
  - consent
  - compliance
  - self-hosted
  - nlnet-grant
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Make a **self-hosted** open-resiapp instance GDPR-defensible **without a central
operator** — the grant's technical challenge **#7**. There is no vendor DPO to file
DPIA paperwork on a building's behalf, so the platform must hand a volunteer SVB
administrator the artifacts a regulator inquiry needs. Two concrete deliverables on
top of the consent infrastructure that already exists: (1) a **per-data-subject
consent-history CSV export** suitable for a ÚOOÚ (SK) / ÚOOÚ (CZ) inquiry, and
(2) a **privacy-policy generator** driven from instance configuration, so the
served policy actually describes what *this* deployment does.

### Problem statement

`consent_records` already stores versioned, append-only consent events
(`data_processing` / `communication`, `granted` / `withdrawn`, `policyVersion`,
`ipAddress`, `userAgent`, `createdAt`). What's missing:
- No way to **export** a subject's consent history as evidence.
- The `/privacy-policy` page is **static** — it does not reflect the instance's
  controller identity, country, installed modules, recipients, or retention, so it
  cannot honestly describe the processing a regulator would ask about.
- `consent_records.userId` is `onDelete: cascade` — deleting an account **destroys
  the consent proof**, which fights the GDPR *accountability* obligation (you may
  need to show consent was validly obtained/withdrawn even after erasure).

## Scope

**In scope**
- **Per-subject consent-history CSV export** — admin action + the subject's own
  self-service export. Columns: `consentType, action, policyVersion, ipAddress,
  userAgent, createdAt`, with an identity header. RFC-4180, UTF-8 BOM (Excel),
  deterministic order (`createdAt ASC`).
- **Instance-wide consent register export** (all subjects), admin-only, for
  accountability.
- **Privacy-policy generator** — assemble a versioned, dated policy from instance
  configuration: controller identity (the bytovka legal name + admin contact),
  country, data categories collected, purposes + legal basis, **installed modules'
  declared data use** (capability model), recipients (e.g. federation, if enabled),
  retention horizons, data-subject rights, and the **country's supervisory
  authority** (SK ÚOOÚ / CZ ÚOOÚ). Served at `/privacy-policy`; downloadable.
- **Versioned policy storage** so any `consent_records.policyVersion` resolves to
  the exact policy text shown at consent time.
- **Consent-retention reconciliation** — change the consent audit so it **survives
  subject deletion** (accountability), per the decision in Notes.
- Jurisdiction-specific policy templates (legally-regulated content → not naively
  parametrized across SK/CZ; CLAUDE.md UI-patterns rule).
- i18n of all new strings (`sk.json` / `cs.json` / `en.json`).

**Out of scope**
- **Full DSAR export** (all personal data across every table for a subject) — a
  larger, separate spec; this one covers consent + policy. Noted as fast-follow.
- **Erasure / right-to-be-forgotten workflow** across all data — separate spec;
  here only the consent-retention reconciliation is in scope.
- **ROPA (records of processing) beyond the consent register** — fast-follow.
- Legal review of the generated policy text — the generator produces a defensible
  draft; a lawyer/DPO confirms (this is GDPR, separate from the voting-specific T9
  legal opinions).

## Approach

### Consent export

Query `consent_records` by `userId`, stream CSV (RFC 4180, UTF-8 BOM, deterministic
`createdAt ASC`). Surfaced two ways:
- **Admin:** an export action on the owner detail view (and a register-wide export).
- **Self-service:** the subject exports their own history from their profile.
Reuse `src/lib/consent.ts`; no inline queries in routes (CLAUDE.md).

### Privacy-policy generator

A template assembled from an explicit **instance configuration**, not hand-written
prose:

- **Config inputs (new settings):** controller legal name, registered address,
  admin contact email; (existing) `country`; (existing) installed-module registry;
  retention settings.
- **Module data-use declarations:** each installed module declares the personal
  data it accesses (the capability model from RES-20260428-002 — e.g. a smart-lock
  module touches access logs, an accounting module touches payment identifiers).
  The generator enumerates installed modules and folds their declarations into the
  "categories of data / recipients" sections. *(If the module manifest does not yet
  carry a data-use field, that field is a follow-up against RES-20260428-002 —
  flagged in Notes.)*
- **Recipients:** if federation (BYT-20260609-002) is enabled, the policy states
  that public notices/events are published to the fediverse; otherwise it does not.
- **Supervisory authority + rights:** rendered per `country` — SK: *Úrad na ochranu
  osobných údajov SR*; CZ: *Úřad pro ochranu osobních údajů*. Separate
  jurisdiction templates; no single template emits both authorities.
- **Output & versioning:** render to HTML served at `/privacy-policy` (replacing the
  static page) + a downloadable copy. Each regeneration bumps `policyVersion` and
  stores the rendered text + a config snapshot, so historical consents stay
  resolvable.

### Data model

```ts
// Historical, immutable rendered policies. Resolves consent_records.policyVersion.
privacy_policy_versions {
  version       varchar(20) pk          // matches consent_records.policyVersion
  country       country notNull
  contentHtml   text notNull            // or storageKey via src/lib/storage.ts
  configSnapshot jsonb notNull          // inputs the policy was generated from
  generatedAt   timestamp defaultNow notNull
}
```

**Consent-retention reconciliation (decision):** change
`consent_records.userId` from `onDelete: cascade` to **`set null`**, and add a
`subjectRef` (a stable pseudonymous identifier minted per subject) so the consent
*event history* survives account erasure while the link to live personal data is
severed. This satisfies accountability (prove consent state at a time) without
retaining the deleted account's PII. (Alternative — force a consent export before
erase and keep cascade — is weaker; see Notes.) Schema change uses the hand-written
migration pattern (CLAUDE.md) since it alters an FK `onDelete` + backfills
`subjectRef`.

## Acceptance Criteria

- [ ] An admin can export any subject's full consent history as CSV; a subject can
      self-export their own from their profile.
- [ ] The CSV is RFC-4180, UTF-8 BOM, deterministic (`createdAt ASC`), with the
      specified columns + identity header, and opens cleanly in Excel.
- [ ] An admin can export the instance-wide consent register.
- [ ] Regenerating the privacy policy from instance config produces a versioned,
      dated policy reflecting controller identity, the country's supervisory
      authority, installed modules' declared data use, recipients (incl. federation
      when enabled), and retention — served at `/privacy-policy`.
- [ ] A `consent_records.policyVersion` resolves to the exact stored policy text in
      `privacy_policy_versions`.
- [ ] SK instances cite the Slovak supervisory authority + refs; CZ instances cite
      the Czech one; no single template emits both.
- [ ] Consent event history **survives subject account deletion** (per the
      reconciliation), while the deleted account's live PII is removed.
- [ ] New UI strings exist in `sk.json`, `cs.json`, `en.json`.

## Project Context

- **Existing consent infra:** `consent_records` (`src/db/schema.ts:744`),
  `consentTypeEnum` (`data_processing|communication`, `:94`), `consentActionEnum`
  (`granted|withdrawn`, `:99`), `src/lib/consent.ts`, `/api/consents`,
  `/privacy-policy` page (currently static). This spec builds on them.
- **Cascade flag:** `consent_records.userId` is `onDelete: cascade` today — the
  reconciliation target.
- **Module data-use:** ties to the RES-20260428-002 capability model; the generator
  reads each installed module's declared data access (manifest field may need
  adding — Notes).
- **Federation recipient:** BYT-20260609-002 — when enabled, the policy must
  disclose fediverse publication of public content.
- **Country:** `countryEnum` (`sk|cz`) drives the jurisdiction template.
- **Legally-regulated content:** per CLAUDE.md, jurisdiction templates are not
  naively parametrized.

## Notes

- **Reconciliation choice:** `set null` + `subjectRef` (retain consent proof,
  sever PII) is recommended over "force export then cascade-delete". Confirm with
  GDPR counsel — retaining consent records after erasure must rest on a clear legal
  basis (legal obligation / legitimate interest in accountability).
- **Module manifest data-use field:** if RES-20260428-002 manifests don't yet carry
  a `dataUse` declaration, add it there (a module-system change), not here. The
  generator degrades gracefully (lists the module without a declaration) until it
  lands.
- **Follow-ups:** full DSAR personal-data export, erasure workflow, and a ROPA-lite
  are separate specs; this one is consent-export + policy-generator + the retention
  fix only.
- **GDPR legal review** is distinct from the voting-specific T9 opinions; budget/own
  it separately if a formal review of the generated policy is wanted.

Placement note: filed in `specs/specs/` (status `spec`). Implements the consent-
export + privacy-policy-generator parts of grant background challenge #7 on top of
the consent records that already exist; the full DSAR/erasure surface is explicitly
deferred to follow-up specs.
