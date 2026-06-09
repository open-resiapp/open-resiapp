---
spec_id: BYT-20260609-004
title: "Notarised mandate workflow (representation in legal voting)"
status: spec
created: 2026-06-09
updated: 2026-06-09
author: byt-app
owner: filipvnencak
last_verified: 2026-06-09
project_type: other
depends_on:
  - BYT-20260511-001   # multi-owner / per-share vote resolution
  - BYT-20260518-001   # voting audit bundle (mandate evidence folds into the merkle tree)
related_handoffs: []
tags:
  - voting
  - mandate
  - notary
  - legal-compliance
  - nlnet-grant
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Implement the **notarised mandate** workflow that lets one apartment owner
authorise another person to cast their share's vote, in a form that is legally
defensible under §14a zák. 182/1993 Z.z. (SK) and §1206/§1210 zák. 89/2012 Sb.
(CZ) and acceptable as evidence to banks / ŠFRB. This is the NLnet grant's
technical challenge **#5** ("bridging digital votes and notarised paper
mandates"), referenced by the legal-opinion (T9) and audit-log (T2) deliverables.

The mandate is **never a forgeable digital proxy**. It exists only as a
deterministic, QR-encoded paper document that the owner signs with a **notarised
signature in person**, which is then re-bound to a specific (voting, owner,
representative) before the representative's vote is recorded — and folded into the
tamper-evident audit bundle.

### Problem statement — reconciling a conflict

The grant proposal commits to this feature. The codebase was in a contradictory
state: `docs/domain/voting.md` declared "mandates do not exist… not coming back,"
the audit-bundle spec said mandates were "removed from the voting model," yet the
voting module schema **still contains `mod_voting_mandates`** (from-owner,
to-owner, `paperDocumentConfirmed`, `verifiedByAdminId`, verification fields). The
domain doc was reconciled on 2026-06-09 to distinguish two mechanisms that were
wrongly collapsed:

- **Forgeable digital delegation** — a purely in-app "vote for X" proxy. Stays
  **forbidden**; its absence is a deliberate legal feature.
- **Co-owners of one unit** — handled by the existing **per-share input model**,
  not by a mandate.
- **One owner authorising a different person** — the **notarised paper mandate**
  this spec defines. Legally defensible precisely because it is non-forgeable
  (in-person notarised), not because it is digital.

This spec turns the half-present `mod_voting_mandates` table into the full,
audit-grade workflow the grant promised.

## Scope

**In scope**
- Generation of a **deterministic, QR-encoded mandate document** (PDF) for a
  specific (voting, owner-of-a-unit, representative).
- The **binding workflow**: emit → owner signs on paper → notary notarises in
  person → scan/upload → admin/counter verifies via QR → mandate becomes `active`.
- A **representative casts the mandated share's vote**; the vote row records the
  representative as caster and links the authorising mandate.
- **Revocation** by the granting owner before the mandated vote is recorded
  (the undo path; CLAUDE.md per-user-mutable-record rule).
- **No-chaining** guarantee (a representative cannot sub-delegate; §14a).
- **Audit-bundle integration** — `mandates.json` leaf folded into the merkle tree
  (defined in BYT-20260518-001 design decision #4).
- **Jurisdiction-specific document templates** — SK template citing §14a, CZ
  template citing §1206/§1210; the feature is gated to the jurisdictions and
  votable HOA entity kinds that own the statute.
- Extension of `mod_voting_mandates` + a `mandateId` link on `mod_voting_votes`.
- i18n of all new UI strings (`sk.json` / `cs.json` / `en.json`).

**Out of scope**
- **Standing / general mandates** (one mandate covering many future votings).
  MVP is per-voting only — matches the table's `(votingId, fromEntityId)`
  uniqueness. (Open question for legal review.)
- **Digital-only notarisation / e-notary / qualified e-signature** as a substitute
  for the in-person notarised paper. The paper artefact is the legal anchor in v1.
- Mandates for non-HOA entity kinds (garage/garden cooperatives) — they lack §14a;
  legally-regulated content must not be naively parametrized across kinds
  (CLAUDE.md UI-patterns rule).
- Automated OCR of the scanned notarised paper — the QR carries the binding data;
  the scan is evidence, not parsed.
- Re-validating an already-cast mandated vote after a late revocation (legal
  question deferred to T9; MVP forbids revocation once the vote is recorded).

## Approach

### The mandate document & deterministic QR payload

The system generates a PDF naming the granting owner, the unit, the representative,
the voting, and a QR code. The QR encodes a **canonical (RFC 8785 JCS) payload with
no server secret** — same external-verifiability rule as the audit bundle:

```json
{ "v": 1, "votingId": "UUID", "fromUnitId": "UUID",
  "fromOwnerId": "UUID", "toOwnerId": "UUID", "issuedAt": "2026-06-09T10:00:00Z" }
```

`mandateDocumentSha256 = sha256(JCS(payload))`. The QR contains the payload (so the
counter can re-bind deterministically without manual entry) plus the hash. Because
the payload is secret-free and canonical, the hash is independently reproducible by
a verifier — it is the leaf that goes into the audit bundle's merkle tree.

The PDF body is **legally-regulated content** and is rendered from a
**jurisdiction-specific template** (SK cites §14a zák. 182/1993 Z.z.; CZ cites
§1206/§1210 zák. 89/2012 Sb.). It is NOT a single parametrized template across
countries/kinds — the statutory citation differs and only applies where the law
applies (CLAUDE.md: legally-regulated content must not be naively parametrized).

### Lifecycle (state machine)

```
issued    — document generated, QR emitted; paperDocumentConfirmed=false
  | owner signs on paper, notary notarises in person, scan uploaded
active    — admin/counter scans QR -> payload matches (voting,owner,rep);
            records notaryName, notarisedAt, documentStorageKey,
            paperDocumentConfirmed=true, verifiedByAdminId, verificationDate;
            audit: voting.mandate_verify
  | representative casts the unit's vote (mandateId linked)
used      — a vote referencing this mandate exists
  ── OR ──
revoked   — granting owner revokes BEFORE any mandated vote is recorded;
            revokedAt + revokedReason set; audit: voting.mandate_revoke
expired   — voting closed without the mandate being used
```

Revocation is allowed only in `issued`/`active` (before a linked vote exists);
`used` is terminal for the mandate. The owner — not the representative — controls
revocation.

### No chaining (structural, not just a check)

A mandate **only ever authorises the granting owner's own share**. There is no
field by which received authority is re-transferred, so "A mandates B, B mandates
C" is structurally impossible: B casting under A's mandate is a `votes.mandateId`
link, not a transferable artefact B can re-grant. A defensive guard additionally
rejects issuing a mandate whose `fromOwnerId` is currently a `toOwnerId` on an
active mandate **for the same share** (belt-and-braces against UI mistakes).

### Schema changes

Extend `mod_voting_mandates` (existing columns kept; new columns added):

```ts
status            mod_voting_mandate_status notNull default 'issued'
                  // 'issued' | 'active' | 'used' | 'revoked' | 'expired'
mandateDocumentSha256  varchar(64)   // hex of JCS(payload); the audit leaf
documentStorageKey     varchar(1024) // generated PDF + scanned notarised copy
                                     // (via src/lib/storage.ts, like documents)
notaryName             varchar(255)
notarisedAt            timestamp
country                mod_voting_... // jurisdiction that owns the template (sk|cz)
revokedAt              timestamp
revokedReason          text
// existing: paperDocumentConfirmed, verifiedByAdminId, verificationDate,
// verificationNote, isActive (kept; isActive derivable from status — migrate)
```

Add to `mod_voting_votes`:

```ts
mandateId  uuid -> mod_voting_mandates.id  on delete restrict   // nullable
```

A mandated vote keeps `ownerId` = the **share-holding owner** (invariant: vote
belongs to the unit, owner is the share holder) and sets `recordedById` = the
representative + `mandateId` = the authorising mandate. New enum
`mod_voting_mandate_status`; new `entity_audit_action` values
`voting.mandate_issue`, `voting.mandate_verify`, `voting.mandate_revoke`. Enum adds
use the **hand-written migration pattern** (CLAUDE.md; `0034_kind_to_text_fk.sql`).

### Audit-bundle integration

Folded into BYT-20260518-001 (design decision #4, updated 2026-06-09): when a
voting has any mandate, the bundle includes `mandates.json` with a public-data leaf
per mandate `{votingId, fromUnitId, fromOwnerId, toOwnerId, mandateDocumentSha256,
notarisedAt, verifiedByAdminId, recordedAt}`, hashed into the same merkle tree. A
verifier can then confirm which mandated votes were authorised and that the mandate
evidence was not altered post-close.

### UI surfaces

- **Issue mandate:** on a `draft`/`active` voting, an owner (or admin on their
  behalf) selects "Splnomocniť zástupcu" → pick representative → download the
  generated PDF.
- **Verify mandate:** admin/vote-counter scans the QR on the returned notarised
  paper (or enters the code), uploads the scan, confirms parties → mandate goes
  `active`.
- **Cast mandated vote:** the representative casts the unit's vote; UI shows it is
  cast under a verified mandate.
- **Revoke:** the granting owner revokes before the mandated vote is recorded.
- **Permissions:** issuing = the granting owner or admin; verifying = admin /
  vote-counter; revoking = the granting owner. Reuse the voting permission model
  (`docs/domain/voting.md` creators are admin/owner/chairman; counters verify).

## Acceptance Criteria

- [ ] An owner can generate a mandate PDF for a (voting, their unit, a named
      representative); the PDF carries a QR whose payload is canonical (JCS) and
      contains **no server secret**, and `mandateDocumentSha256` is reproducible
      from the payload alone.
- [ ] The mandate document uses the **SK template** (cites §14a) for SK votings and
      the **CZ template** (cites §1206/§1210) for CZ votings; no single
      cross-jurisdiction template emits both statutes.
- [ ] Scanning the QR re-binds the notarised paper to exactly the original
      (voting, owner, representative); a payload that does not match an `issued`
      mandate is rejected.
- [ ] Verifying records `notaryName`, `notarisedAt`, `documentStorageKey`,
      `verifiedByAdminId`, sets status `active`, and writes
      `voting.mandate_verify` to `entity_audit_log`.
- [ ] A representative can cast the mandated share's vote; the vote row has
      `ownerId` = share-holder, `recordedById` = representative,
      `mandateId` = the mandate; the engine resolves the share to the
      representative's choice under the per-share model.
- [ ] The granting owner can revoke a mandate while no linked vote exists; after a
      mandated vote is recorded, revocation is rejected. Revocation writes
      `voting.mandate_revoke`.
- [ ] Issuing a mandate that would chain (re-delegate received authority) is
      rejected; the model exposes no field to transfer received authority.
- [ ] A closed voting with mandates exports a bundle containing `mandates.json`
      whose leaves are in the merkle tree; the BYT-20260518-001 verifier validates
      it and a tampered mandate leaf fails verification.
- [ ] The feature is unavailable for non-HOA (garage/garden) entity kinds and for
      jurisdictions without a mandate template.
- [ ] New UI strings exist in `sk.json`, `cs.json`, `en.json`.

## Project Context

- **Existing table:** `mod_voting_mandates` (`modules/voting/src/db/schema.ts:120`)
  — already has `votingId`, `fromOwnerId`, `fromEntityId` (the unit), `toOwnerId`,
  `paperDocumentConfirmed`, `verifiedByAdminId`, `verificationDate`,
  `verificationNote`, `isActive`, unique `(votingId, fromEntityId)`. This spec
  extends it; it does not invent it.
- **Votes table:** `mod_voting_votes` (`:86`) — `ownerId`, `entityId`, `choice`,
  `voteType` (electronic|paper), `recordedById`, `paperPhotoUrl`, `auditHash`,
  `(votingId, entityId)` unique. Gains a nullable `mandateId`.
- **Per-share resolution:** BYT-20260511-001 — unchanged; mandated votes flow
  through the same `VoteWithOwnership[]` engine input as any other share vote.
- **Audit bundle:** BYT-20260518-001 — mandate evidence reconciled in design
  decision #4 (updated 2026-06-09).
- **Domain doc:** `docs/domain/voting.md` (updated 2026-06-09) — mandate invariant,
  counterpart, and edge cases now describe this workflow.
- **Storage:** generated PDF + scanned notarised copy via `src/lib/storage.ts`
  (local disk / S3), same pattern as the document library.
- **Legally-regulated content rule:** per CLAUDE.md UI-patterns, the mandate
  document templates are jurisdiction-owned, not naively parametrized.

## Notes

### Decision sequencing & dependency on T9

The exact statutory mechanics (whether a per-voting mandate suffices vs a standing
power of attorney; the precise notarisation form; whether a late revocation
invalidates an already-cast vote) are **confirmed by the T9 independent legal
opinions** the grant funds. This spec encodes the defensible default
(per-voting, in-person notarised paper, revocation only before the vote); T9 may
tighten or widen it. Do not promote to `in_progress` ahead of, or in contradiction
to, the T9 findings on these specific points.

### Open questions

- **Standing mandates** (one authorisation across multiple votings) — common in
  practice but raises re-binding and revocation complexity; deferred pending T9.
- **Electronic mandated vote vs paper:** a verified mandate could let the
  representative vote electronically (passkey, T1) or be recorded as a paper vote at
  the meeting. MVP supports recording the mandated vote through the normal vote path
  with `mandateId` set; the physical channel stays `voteType`.
- **`isActive` vs `status`:** the new `status` enum supersedes the `isActive`
  boolean; migration maps `isActive=true → 'active'`. Confirm no current code reads
  `isActive` before dropping it (grep `isActive` across `modules/voting` per the
  CLAUDE.md enum/column-rename rule).

Placement note: filed in `specs/specs/` (status `spec`). This spec resolves the
mandate conflict flagged in the grant-coverage review by (a) reconciling
`docs/domain/voting.md`, (b) reconciling the audit-bundle spec, and (c) defining the
workflow on top of the existing `mod_voting_mandates` table. Promotion to
`in_progress` is gated on the T9 legal opinions for the statutory-mechanics
questions above.
