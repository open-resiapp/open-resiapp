---
spec_id: BYT-20260609-005
title: "Voting transparency log — append-only Merkle chain, anchoring, in-browser verifier"
status: spec
created: 2026-06-09
updated: 2026-06-09
author: byt-app
owner: filipvnencak
last_verified: 2026-06-09
project_type: other
depends_on:
  - BYT-20260518-001   # per-voting audit bundle (leaf/hash conventions, Ed25519 key)
  - BYT-20260609-002   # federation actor (one anchor channel)
related_handoffs: []
tags:
  - voting
  - audit
  - transparency-log
  - cryptography
  - nlnet-grant
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Deliver the three parts of NLnet grant task **T2** that the per-voting audit
bundle (BYT-20260518-001) deliberately left out of scope: (1) an **append-only
Merkle hash chain** over the instance's voting commitments, (2) **periodic
root-anchor publication** to a small set of independent public locations, and (3)
a **minimal in-browser verifier**. Together these raise the guarantee from "this
*one* closed voting wasn't altered" to "the instance's *whole sequence* of votings
is complete and append-only, and any owner can check it without installing
anything."

### Problem statement

The audit bundle proves a single closed voting's ballots weren't altered after
close. It does **not** prove (a) that the *set* of votings is complete — a whole
voting could be quietly deleted or hidden — or (b) give a continuously-growing,
externally-witnessed timeline. And its verifier is Node/CLI only, a barrier for the
50–75-year-old owners who are the point of the project. The grant promises an
append-only chain + external anchoring (closes the completeness/timeline gap) and
an in-browser verifier (removes the install barrier).

## Scope

**In scope**
- An **append-only Merkle transparency log** (RFC 6962 / Certificate-Transparency
  style), instance-wide, reusing the bundle's leaf/hash conventions. One leaf is
  appended when a voting **closes**; the leaf commits to that voting's audit-bundle
  merkle root.
- **Signed Tree Heads (STH):** `{treeSize, rootHash, timestamp, logId}` signed with
  the existing Ed25519 audit key. **Consistency proofs** between any two STHs
  (the append-only proof) and **inclusion proofs** for any voting.
- **Periodic root-anchor publication** of each new STH to a configurable set of
  independent locations: the instance's **fediverse actor** (BYT-20260609-002), a
  public **git repo** (Codeberg/GitHub append), an **email digest** to owners, and
  an optional **RFC-3161 timestamp**. At least one anchor required when the log is
  enabled.
- **In-browser verifier** — a dependency-free web page that, fully client-side
  (WebCrypto SHA-256 + Ed25519), verifies: a downloaded `bundle.zip` (re-derive
  root + check signature), an **inclusion proof** of that bundle's root in a
  published STH, and **consistency** between two STHs.
- **Public read endpoints:** latest STH, inclusion proof for a voting, consistency
  proof between two tree sizes.

**Out of scope**
- Blockchain / on-chain anchoring — the git + fediverse + RFC-3161 locations are the
  "independent public locations"; no ledger.
- Real-time per-ballot logging inside an *open* voting — the log appends on
  **close**, consistent with the closed-voting immutability model (open votings
  still mutate).
- Cross-instance gossip / third-party log auditors — single-instance log; gossip is
  a future spec.
- Replacing the per-voting bundle — the bundle stays; the log references bundle
  roots.
- Migrating historical (pre-log) closed votings into the log — optional backfill
  noted in Notes.

## Approach

### Structure

The log is an RFC 6962 binary Merkle tree (same leaf prefix `0x00` / internal
`0x01` / SHA-256 as the bundle, per BYT-20260518-001 design decision #2). A leaf is:

```
leafHash = SHA-256(0x00 || JCS({ votingId, bundleRoot, closedAt, seq }))
```

`bundleRoot` is the per-voting merkle root the bundle already produces — so the log
commits to the *same* root an owner can independently recompute from a bundle. The
log never stores ballots; it stores commitments.

### Append on close

When a voting transitions to `closed` and its bundle root is computed:
1. Insert `voting_log_entries(seq, votingId, bundleRoot, leafHash, closedAt)`.
2. Recompute the tree head; insert a new `voting_log_sths` row, **signed** with the
   Ed25519 audit key (`kid` shared with the bundle so the trust root is one key).
3. Enqueue anchor publications for the new STH (one row per configured location).

Append is the only mutation: entries are never updated or deleted (enforced — no
UPDATE/DELETE path; a closed voting is already immutable per `docs/domain/voting.md`).

### Data model (`voting_log_*`, every `references` has `onDelete`)

```ts
voting_log_entries {
  seq        bigserial pk            // append order = leaf index
  votingId   uuid unique  references votings on delete restrict
  bundleRoot varchar(64) notNull     // hex, the per-voting merkle root
  leafHash   varchar(64) notNull
  closedAt   timestamp notNull
  appendedAt timestamp defaultNow notNull
}
voting_log_sths {
  id         uuid pk defaultRandom
  treeSize   bigint notNull          // = entry count at signing
  rootHash   varchar(64) notNull
  signedAt   timestamp notNull
  signature  text notNull            // Ed25519 over JCS(STH)
  kid        varchar(64) notNull
  unique (treeSize)
}
voting_log_anchors {
  id          uuid pk defaultRandom
  sthId       uuid references voting_log_sths on delete cascade  notNull
  location    varchar(32) notNull    // 'fediverse' | 'git' | 'email' | 'rfc3161'
  state       varchar(16) notNull default 'pending'  // pending|published|failed
  ref         text                   // URL / post id / commit sha / TSA token
  attempts    integer notNull default 0
  nextRetryAt timestamp defaultNow notNull
  publishedAt timestamp
  unique (sthId, location)
}
```

### Anchoring worker

Reuses the established cron pattern (`/api/cron/community` precedent, `CRON_SECRET`
+ `x-cron-secret`): `/api/cron/voting-log-anchor` drains pending
`voting_log_anchors`, publishes each to its location, DB-backed retry/backoff.
- **fediverse:** post the STH as a signed note from the community actor
  (BYT-20260609-002). Owners following the building see each checkpoint.
- **git:** append the STH JSON to a configured public repo via its API.
- **email:** include the latest STH `(treeSize, rootHash)` in the owner digest.
- **rfc3161:** request a timestamp token over `rootHash` from a configured TSA.

### Public endpoints (`app/api/voting-log/**`, outside `[locale]`)

| Path | Returns |
|---|---|
| `GET /api/voting-log/sth` | latest signed tree head |
| `GET /api/voting-log/proof/inclusion?votingId=` | inclusion proof + STH |
| `GET /api/voting-log/proof/consistency?from=&to=` | consistency proof between two sizes |

### In-browser verifier

A static, dependency-free page (shipped in-repo and publishable to
`docs.open-resi.app/verify`; optionally mounted at `/verify` in-app). Pure
client-side WebCrypto:
1. User drops a `bundle.zip` → recompute its merkle root, verify its Ed25519
   signature against the published public key.
2. Fetch (or paste) the STH → verify the bundle root's **inclusion proof**.
3. Optionally verify **consistency** between two STHs (e.g. one anchored to git
   last month vs the current one) — proving nothing was rewritten in between.
It mirrors the bundle's `verify.mjs` logic; SHA-256 + Ed25519 are both in WebCrypto,
so no dependencies. Works offline with a pasted STH.

## Acceptance Criteria

- [ ] Closing a voting appends exactly one leaf and produces a new STH with
      `treeSize = previous + 1`, signed by the Ed25519 audit key.
- [ ] A consistency proof between any two STHs verifies; a fabricated proof that
      implies a removed/changed leaf fails.
- [ ] An inclusion proof shows a voting's `bundleRoot` is in the log at a given STH;
      a tampered bundle root fails inclusion.
- [ ] Each new STH is queued to all configured anchor locations and retried on
      failure; enabling the log with zero anchors configured logs a clear warning.
- [ ] When federation is enabled, each STH is published as a signed note from the
      community actor.
- [ ] The in-browser verifier validates a bundle's signature + merkle root and an
      inclusion proof against a published STH **entirely client-side** (WebCrypto,
      no install); a tampered bundle fails visibly.
- [ ] Entries are append-only — no code path updates or deletes
      `voting_log_entries`.
- [ ] The log STH and the bundle share one Ed25519 trust root (`kid`), or a
      dedicated log key is documented (decision in Notes).

## Project Context

- **Per-voting bundle:** BYT-20260518-001 — RFC 6962 merkle, Ed25519 signature,
  `verify.mjs`. This spec adds the *instance-wide* log on top; leaf = bundle root.
- **Per-ballot commitment:** `modules/voting/src/engine/index.ts:415`
  (`createHash('sha256')`) — unchanged; the log sits above it.
- **Immutability:** `docs/domain/voting.md` — closed votings are immutable, so the
  log's append-only invariant is consistent with the existing model.
- **Cron precedent:** `/api/cron/community` + `CRON_SECRET`; anchoring mirrors it.
- **Fediverse anchor:** BYT-20260609-002 community actor is one publication channel
  (the grant's "independent public locations").

## Notes

- **Dedicated log key vs shared:** sharing the bundle's Ed25519 key keeps one trust
  root (simpler for owners); a dedicated log key isolates compromise blast radius.
  Lean shared for MVP; document.
- **Anchor set:** which locations are mandatory vs optional per instance; the
  "small set of independent locations" the grant cites. Confirm defaults.
- **Backfill:** whether to import pre-log closed votings into the log at first
  enable (one-time, ordered by `closedAt`) or start the log empty. Lean backfill so
  the log covers full history.
- **Verifier hosting:** in-app `/verify` vs static page on `docs.open-resi.app` vs
  both. Static + offline-capable is the strongest "anyone can verify" story.
- **Gossip / multi-instance auditing:** out of scope; the strongest transparency
  property (split-view detection) needs external witnesses — future spec.

Placement note: filed in `specs/specs/` (status `spec`) as the T2 follow-up the
audit-bundle spec explicitly deferred. Closes the grant's T2 to its full promised
scope (chain + anchoring + in-browser verifier).
