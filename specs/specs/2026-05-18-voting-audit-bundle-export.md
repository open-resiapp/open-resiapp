---
spec_id: BYT-20260518-001
title: "Exportable voting audit bundle"
status: spec
created: 2026-05-18
updated: 2026-05-18
author: byt-app
owner: byt-app
last_verified: 2026-05-18
project_type: other
depends_on:
  - BYT-20260511-001
related_handoffs: []
tags:
  - voting
  - audit
  - cryptography
  - legal-compliance
  - transparency
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Allow a closed voting to be exported as a self-contained, cryptographically signed audit bundle that a notary, court, or independent reviewer (e.g. NLnet grant evaluator) can verify without any access to our database or codebase. The bundle proves: (a) which ballots were cast, (b) that no ballot was altered or removed after closing, (c) that the published result matches the formula applied to those ballots, and (d) that the bundle originated from this deployment. This is the transparency argument civic-tech grants require and the legal-defensibility argument under §14 zák. 182/1993 Z.z. that closed-source SVB / Resitech competitors cannot match.

## Scope

**In scope**
- ZIP bundle export from a closed voting's detail page (admin-only action).
- Bundle contents: `manifest.json`, `votes.json`, `result.json`, `merkle-root.txt`, `signature.sig`, `verify.md`. (No `mandates.json` — mandates are removed from the voting model per `docs/domain/voting.md`; delegation is replaced by the per-share input model.)
- Merkle tree over per-vote hashes (extends existing SHA-256 in `modules/voting/src/engine/index.ts:406-416`).
- Server-side asymmetric signature (Ed25519 preferred over RSA: smaller, faster, no padding ambiguity) of `manifest.json` + merkle root.
- Dedicated signing keypair, separate from `NEXTAUTH_SECRET`. Key rotation strategy with key id (`kid`) embedded in manifest.
- Published public key endpoint (`/.well-known/voting-audit-pubkey`) with historical `kid` lookup.
- Standalone verifier CLI (Node, zero runtime deps beyond Node crypto) consuming `bundle.zip + public-key.pem` → exit code 0 / non-zero with human-readable report.
- Bundle is byte-stable: same voting + same code + same key → identical bytes (deterministic ordering, no timestamps inside hashed payloads beyond ballot `recordedAt`).
- Slovak + English `verify.md` instructions inside bundle.

**Out of scope**
- Blockchain / public ledger anchoring (timestamp service can be added later as separate spec).
- Real-time verification during voting (only post-close audit).
- Verifier as web UI (CLI only for v1; web verifier is follow-up).
- Voter receipt / end-to-end verifiable voting (E2E-V) — separate cryptographic problem.
- Re-signing historical votings to migrate them onto the new hash scheme.

## Approach

### Bundle structure

A single ZIP archive named `voting-{votingId}-{downloadEventId}.zip` contains:

- `manifest.json` — bundle metadata. Includes: `schemaVersion`, `bundleId`, `votingId`, `votingTitle`, `votingScope` (entityId path), `votingModule` (e.g. `voting-sk@1.4.2`), `quorumType`, `votingMethod`, `country`, `openedAt`, `closedAt`, `generatedAt`, `kid` (signing-key id), `merkleRoot` (hex), `verifierSha256` (hex), `verifierRequires` (`"node>=18"`), `piiClass` (`"restricted"`), `distributionPolicy`, `downloadEventId`, `revocationListUrl`, `publicKeyUrl`, `revocationListKeyFingerprint`, `entityAuditLogRefs` (admin actions on this voting between open and close). The `manifest.json` is JCS-canonicalized before signing.
- `votes.json` — the array of vote leaves in canonical sort order `(recordedAt ASC, voteId tiebreak)`. Each leaf is the pinned schema: `{votingId, unitId, ownerId, share: {num, den}, choice, recordedAt, voteType, confirmationKind, paperPhotoSha256}`.
- `result.json` — engine output in rational form (see "Result rationalization" below). Carries: `za`, `proti`, `zdrzalSa`, `total`, `zaPercent`, `protiPercent`, `zdrzalSaPercent` (all `{num, den}`), `passed`, `quorumReached`, `quorumType`, `totalPossibleWeight: {num, den}`, `unitBreakdowns[]` (per-unit resolution with shares and rationale).
- `merkle-root.txt` — the hex-encoded merkle root for human inspection. Authoritative copy lives inside `manifest.json`; this file is a convenience.
- `signature.sig` — raw 64-byte Ed25519 signature over JCS-canonicalized `manifest.json`, hex-encoded.
- `verify.mjs` — the bundled verifier (see "Verifier" below). Byte-identical across all bundles of the same `schemaVersion`.
- `verify.md` — Slovak-primary verification instructions (see "verify.md" below).

### Hash scheme

Single public-data hash per vote — no secret-salted variant. The existing `votes.auditHash` column is backfilled to the new scheme in the same migration that lands the export feature.

Leaf hash for the merkle tree: `SHA256(0x00 || JCS(vote-leaf-schema))`. The `0x00` byte prefix is RFC 6962 domain separation between leaves and internal nodes.

### Merkle tree

Binary merkle tree following RFC 6962 (Certificate Transparency log format).

- Leaves sorted by `(recordedAt ASC, voteId ASC tiebreak)`.
- Leaf hash: `SHA256(0x00 || JCS(leaf))`.
- Internal hash: `SHA256(0x01 || left_hash || right_hash)`.
- Odd-count level: trailing node promoted unmodified to the next level (RFC 6962 convention, not Bitcoin's duplicate-last-leaf).
- Empty tree (zero votes): root = `SHA256("")` per RFC 6962 §2.1; the bundle is still produced and signed (a voting with zero votes is a legitimate outcome, not a missing artefact).
- Inclusion proofs supported: a voter receiving `{leaf_index, leaf_data, sibling_path}` can independently recompute the root and verify their single vote without the rest of the bundle.

### Canonical JSON

RFC 8785 (JSON Canonicalization Scheme, JCS) for every hashed or signed payload.

- Library on server: `canonicalize` npm package (≤15KB, no transitive deps).
- Library in verifier: same `canonicalize` for in-bundle `verify.mjs`; reference Python verifier uses `rfc8785`; reference Go verifier uses `github.com/gowebpki/jcs`.
- Banned invariant: no float fields anywhere in any hashed payload. Share fractions are integer rationals `{num, den}`; timestamps are ISO 8601 strings with millisecond precision and explicit `Z` suffix; IDs are UUID strings.

### Signing and key management

Ed25519 via Node `crypto.sign` / `crypto.verify` (no external dependencies).

- Bundle-signing keys are quarterly: `kid` = `YYYY-QN` (e.g. `2026-Q2`). Private key in env var `VOTING_AUDIT_SIGNING_KEY_PRIVATE_{KID}`, PEM format, read at startup only.
- Public key served at `/.well-known/voting-audit-pubkey/{kid}.pem`. All historical `kid`s remain published indefinitely so old bundles stay verifiable.
- A **separate revocation-list signing key** (long-lived, ideally hardware-backed) signs the revocation list. Distinct from any bundle-signing key.
- What is signed: JCS-canonicalized `manifest.json`. The signature thus covers (transitively) every other file in the bundle, because their hashes are inside `manifest.json` (`merkleRoot`, `verifierSha256`, `resultHash`).
- Key material is never logged, never returned by any HTTP endpoint, never written to the DB.
- Future hardening flagged but out of v1: AWS KMS / Hashicorp Vault / hardware token.

### Revocation

A signed revocation list at `/.well-known/voting-audit-revoked-kids.json`:

```json
{
  "generatedAt": "ISO 8601",
  "revoked": [{"kid": "2026-Q1", "revokedAt": "ISO 8601", "reason": "..."}],
  "signature": "hex",
  "signedBy": "revocation-list-key-fingerprint"
}
```

- Verifier fetches this list and refuses to pass any bundle whose `kid` appears in it.
- `--offline` flag: verifier requires `--revocation-list path/to/list.json`, signed by the fingerprint recorded in the bundle's `manifest.json`.
- v1 nuclear policy: revocation invalidates **all** bundles by that `kid`, regardless of date. Quarterly rotation bounds the blast radius.
- v2 follow-up spec: RFC 3161 trusted-timestamp counter-signature on every bundle, enabling surgical "pre-revocation bundles remain valid" behaviour.

### Result rationalization

The existing engine (`modules/voting/src/engine/index.ts`) returns `VotingResults` with `number` (float) fields for aggregate weights and percentages. Floats break determinism. We add a `rationalize(results, votes)` adapter that:

1. Re-aggregates `unitBreakdowns[].unitWeight` (already `Rational` per the engine's internal types) into integer rationals.
2. Returns a `RationalVotingResults` shape used only for `result.json` serialization.
3. Verifier mirrors this aggregation in `verify.mjs` and compares fraction-by-fraction (no float comparison anywhere).

The engine itself is not modified. The adapter is a single new function plus a new shared type, kept under `modules/voting/src/engine/`.

### Export trigger and access control

- Trigger: button on the voting detail page, visible only when `status = closed`.
- Authorized callers: admin who manages the voting; an active member of the voting whose membership has path overlap with the voting's scope; or a server-side script invoked under documented court order (audit-logged like any other download).
- Every successful export writes a row to a new `voting_bundle_downloads` table: `{id (UUID), bundleId, votingId, downloadedBy, downloadedAt, ipAddress, reason: text | null, schemaVersion}`. The row `id` is the `downloadEventId` embedded in the bundle filename and `manifest.json` — a leaked bundle traces back to its exact download row.
- Unauthorized callers receive HTTP 403 with no leak of voting existence (use the existing per-entrance visibility filter, so a non-member sees 404 not 403).
- Generation is synchronous for v1 (bundles for typical HOA voting counts are <1 MB; sub-second to produce). Async background job is a follow-up only if real-world data shows it's needed.

### Verifier (`verify.mjs`)

Single ES module shipped inside every bundle. Zero runtime dependencies beyond Node ≥18 builtins (`crypto`, `fs`, `zlib`, `node:url`). Reviewable in one sitting.

Verification ordering (this order is load-bearing — `verify.md` documents it):

1. **Obtain public key out-of-band.** Verifier requires `--pubkey path/to/key.pem`. Never trusts a key shipped inside the bundle.
2. **Verify signature** on JCS-canonicalized `manifest.json` using the out-of-band key. If invalid → exit 1.
3. **Check `kid` against revocation list.** Default fetches `manifest.revocationListUrl`; `--offline` reads from `--revocation-list`. Revocation-list signature is verified against `manifest.revocationListKeyFingerprint`. If revoked → exit 1.
4. **Hash `verify.mjs` itself** and compare to `manifest.verifierSha256`. Mismatch → exit 1. This catches in-bundle verifier tampering.
5. **Recompute merkle root** from `votes.json`, compare to `manifest.merkleRoot`. Mismatch → exit 1.
6. **Recompute result** by running the rationalized engine logic over `votes.json`, compare to `result.json`. Mismatch → exit 1.
7. **All passed** → exit 0 with a human-readable summary (Slovak primary, English appendix).

The `verify.mjs` source is byte-identical across all bundles of the same `schemaVersion`. Reviewers can `diff` the bundled file against the public reference at `https://github.com/openresiapp/audit-verify/blob/v{schema}/verify.mjs`.

No npm package shipped in v1. No standalone OS binaries.

### `verify.md`

Slovak-primary, English appendix. Sections in order:

1. One-paragraph executive summary citing §14 zák. 182/1993 Z.z.
2. **What this bundle proves** — integrity, authenticity, result self-consistency (each defined in plain Slovak).
3. **What this bundle does NOT prove** — legality of voting process, server-side identity-capture flow honesty, correctness of the voting rules themselves vs. statute, absence of operator/key-holder collusion.
4. How to verify — literal `node verify.mjs --pubkey ...` command.
5. Where to obtain the public key out-of-band — publisher site, NLnet grant report URL, court registry (TBD).
6. Sample successful verification output (with `✓` markers).
7. Sample failed verification output (with `✗` markers and per-step diagnosis).
8. Revocation: how the verifier checks, what `--offline` means, what revocation invalidates.
9. Audit of the verifier itself: SHA-256 of bundled `verify.mjs` + GitHub reference URL.
10. Glossary (Slovak): merkle koreň, Ed25519 podpis, kanonická JSON (RFC 8785).
11. English appendix: full translation of sections 1–10.

## Acceptance Criteria

- [ ] A closed voting with 1 unit / 1 owner produces a valid bundle that passes the verifier with exit code 0.
- [ ] A closed voting with 50 units, mixed share fractions (`1/1`, `1/2`, `1/3`, `2/3`, `1/4`, `3/4`), and at least one tied unit (resolves to `abstain`) produces a valid bundle that passes the verifier.
- [ ] A closed voting with **zero** cast votes produces a valid bundle that passes the verifier (empty merkle tree per RFC 6962 §2.1).
- [ ] Re-exporting the same closed voting on different machines (macOS Node 22, Linux Node 20) produces byte-identical bundles, except for `manifest.generatedAt`, `manifest.downloadEventId`, and `signature.sig` (signature determinism is preserved by Ed25519 but the manifest content changes per export).
- [ ] Two exports of the same voting produce **identical `merkleRoot`** and **identical `votes.json` byte-for-byte** (the deterministic core of the bundle).
- [ ] Tampering with any single byte of any file in an exported bundle causes the verifier to exit non-zero with a diagnostic that names which check failed (`signature`, `revocation`, `verifier-sha`, `merkle-root`, or `result-mismatch`).
- [ ] A bundle signed with `kid=X` where `X` is on the revocation list fails verification with `error: kid revoked` regardless of any other content.
- [ ] A bundle whose `verify.mjs` SHA-256 disagrees with `manifest.verifierSha256` fails verification at step 4.
- [ ] A bundle whose `votes.json` is re-sorted by a different order (e.g. by `ownerId` instead of `recordedAt`) fails verification at step 5 (merkle mismatch).
- [ ] `result.json` contains zero JSON `number` values for any weight or percentage — all weights are `{num, den}` integer-rational objects. A linter or test enforces this.
- [ ] The bundle file name is `voting-{votingId}-{downloadEventId}.zip` and `manifest.downloadEventId` matches the filename's `downloadEventId`.
- [ ] Every successful export writes one row to `voting_bundle_downloads`. Failed exports (auth failure, voting not closed) write no row.
- [ ] An unauthorized caller (no path overlap with voting's scope, not admin) receives HTTP 404 (not 403, to avoid leaking voting existence).
- [ ] Voter Mrs. Novák, given her vote row plus the merkle inclusion proof plus the signed `manifest.json`, can independently verify her vote is in the bundle without holding the rest of the bundle. (Manual test using an inclusion-proof helper script; full UI to extract proofs is a follow-up.)
- [ ] Public key endpoint `/.well-known/voting-audit-pubkey/{kid}.pem` returns the matching public key for every `kid` ever used to sign a bundle. Removing or rotating an old `kid` from this endpoint is an incident.
- [ ] Revocation-list endpoint `/.well-known/voting-audit-revoked-kids.json` exists, is signed, and contains the documented schema even when no keys are revoked (empty `revoked: []`).
- [ ] `verify.md` is bilingual (Slovak primary, English appendix), cites §14 zák. 182/1993 Z.z. on the first page, and includes both sample-PASS and sample-FAIL output.
- [ ] `verify.mjs` runs to completion on Node 18, 20, 22 with zero npm install steps, only Node builtins. CI matrix enforces this.
- [ ] `verify.mjs` byte-equality across two bundles of the same `schemaVersion` is asserted by an integration test.
- [ ] No string `NEXTAUTH_SECRET` appears anywhere in the codebase paths that produce bundle data. A grep test in CI enforces this.

## Project Context

**Existing primitives in this repo:**
- `modules/voting/src/engine/index.ts:406-416` — `generateAuditHash()` SHA-256 over `votingId+ownerId+flatId+choice+timestamp+NEXTAUTH_SECRET`. Will be replaced/wrapped — current hash mixes a server secret into the per-vote digest, which prevents independent verification (verifier would need the secret). New scheme must hash only public ballot data; authenticity comes from the bundle signature, not from a secret-salted hash.
- `modules/voting/src/db/schema.ts:79-111` — `votes.auditHash` column. Likely needs a second column (or computed at export time) for the public-data hash.
- `src/components/voting/DownloadMinutesPDF.tsx:250,476` — current PDF surfaces the hash as a display field only. Bundle export is the new authoritative artefact; PDF minutes can embed the merkle root + signature fingerprint as a printable summary.
- `entity_audit_log` — operator-side mutation log; orthogonal to vote-level audit but should be referenced in `manifest.json` for chain-of-custody (admin actions that touched the voting between open and close).

**Legal anchor:**
§14 zák. 182/1993 Z.z. requires HOA voting minutes to be verifiable by any owner. Today this is paper-only and trust-based. A signed JSON bundle is a stronger, independently-checkable form of the same statutory duty.

**Cryptography constraints:**
- Ed25519 via Node `crypto.sign` / `crypto.verify` — no extra dependencies, deterministic signatures, widely supported by third-party verifiers (Python `cryptography`, Go `ed25519`, OpenSSL ≥1.1.1).
- Signing key stored as PEM in env var (`VOTING_AUDIT_SIGNING_KEY`), never logged, never returned by any endpoint. Public key is the only thing served.
- Key rotation: each key has `kid` (e.g. `2026-05`), embedded in manifest; published public key endpoint returns the matching public key for any historical `kid`.

## Notes

### Decisions log (resolved during /grill-me on 2026-05-18)

All nine originally-open design questions are decided. Resolutions are folded into Approach + Acceptance Criteria above. Summary kept here for traceability:

1. **Hash scheme** — single public-data hash; secret-salted variant dropped. `votes.auditHash` is backfilled to the new scheme in the same migration. Rationale: the secret-salted hash was security theatre — anyone with DB write access could rewrite both the row and its hash, since the secret lives in the same app environment. Real DB-tamper protection comes from closed-voting immutability + the externally-anchored bundle signature, not from in-row hashes.

2. **Merkle tree shape** — RFC 6962 binary merkle (Certificate Transparency log format), leaf prefix `0x00`, internal prefix `0x01`, sorted `(recordedAt ASC, voteId tiebreak)`. Inclusion proofs supported so a single voter can prove their vote is in the bundle without disclosing other ballots.

3. **Canonical JSON** — RFC 8785 JCS. Banned invariant: no float fields anywhere in any hashed payload (share fractions are `{num, den}`).

4. **Mandates / proxies** — removed from the voting model entirely. No `mandates.json` in the bundle. Per `docs/domain/voting.md`: under the per-share input model, a missing co-owner's share is simply uncast and the unit-level resolution rule handles it. Absence of a forgeable delegation artefact is itself a legal feature.

5. **PII in bundle** — single full-PII bundle, restricted access. Every download writes a row to `voting_bundle_downloads`; the row's UUID is embedded in the filename and in `manifest.json` so leaks trace to origin. `manifest.piiClass = "restricted"` declared up front. Phase 2 spec (deferred): pseudonymized public variant for NLnet reviewers and researchers, with a cross-commitment binding it to the canonical bundle.

6. **Multi-owner resolution dependency** — BYT-20260511-001 is frozen and sufficient. The engine already takes per-(voter, unit) rows (`VoteWithOwnership[]`), so the algorithm matches the per-share input model from `docs/domain/voting.md` even though the DB recording layer hasn't yet widened its `(votingId, entityId)` uniqueness. The audit bundle consumes engine output, not recording-layer shape, so the schema-widening work is a separate spec that doesn't block this one. Floats in the engine's final aggregation are fixed by the `rationalize()` adapter described in Approach.

7. **Verifier distribution** — single in-bundle `verify.mjs`. No npm package, no standalone binaries. Public key obtained out-of-band. SHA-256 of `verify.mjs` is anchored in `manifest.json` and verified against a published GitHub reference; this closes the "what if the bundled verifier lies" loophole.

8. **Integrity vs. authenticity in `verify.md`** — affirmative claims (integrity, authenticity, result self-consistency) stated first, explicit non-claims (legality of process, server-side identity flow honesty, statutory correctness, collusion resistance) stated next. Slovak primary, English appendix. Both PASS and FAIL sample outputs included so a notary can distinguish a discriminating verifier from an always-pass one.

9. **Historical key compromise** — revocation list at `/.well-known/voting-audit-revoked-kids.json`, signed by a separate revocation-list-signing key (long-lived, ideally hardware-backed) distinct from any bundle-signing key. Quarterly `kid` rotation. v1 nuclear policy: revocation invalidates all bundles by that `kid`. v2 follow-up: RFC 3161 TSA counter-signature for surgical "pre-revocation bundles remain valid" semantics.

### Follow-up specs flagged (not part of v1)

- **Pseudonymized public bundle variant** — for non-voter reviewers (NLnet, researchers, adjacent-building owners curious about quorum trends). Cross-commitment binds it to the canonical full-PII bundle.
- **RFC 3161 trusted-timestamp counter-signature** — adds a third-party time anchor so revocation can be narrowed to "bundles signed after the revocation date." Requires choice of TSA (FreeTSA, DigiCert, etc.) and an external dependency.
- **Public append-only log of signed merkle roots** — Certificate-Transparency-style proof that a bundle existed on a given date without trusting our own infrastructure. Highest civic-tech grant value.
- **Schema-widening migration** for the per-share input model: `votes` table from `UNIQUE(votingId, entityId)` to `UNIQUE(votingId, entityId, ownerId)`, with `shareAtVoteTime` recorded per row. Separate spec; the audit bundle works against either schema because the engine output shape is the same.
- **Inclusion-proof extraction UI** — a voter clicks "Get my inclusion proof for this voting" and downloads a 224-byte proof bundle. Useful but not required for v1 (verifier already supports inclusion-proof verification; the UI to extract one is the missing piece).
- **KMS-backed signing key custody** — AWS KMS / Hashicorp Vault / hardware token for `VOTING_AUDIT_SIGNING_KEY_PRIVATE_*` material. v1 uses env-var PEM, which is acceptable for a deployment of this scale but is the obvious next hardening step.
