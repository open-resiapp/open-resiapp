---
spec_id: BYT-20260609-009
title: "Kiosk mode — on-site shared-device assembly voting"
status: spec
created: 2026-06-09
updated: 2026-06-09
author: byt-app
owner: filipvnencak
last_verified: 2026-06-09
project_type: other
depends_on:
  - RES-20260505-001   # voting module
  - BYT-20260609-008   # multi-item ballot (kiosk casts the whole ballot)
  - BYT-20260511-001   # per-share resolution
  - RES-20260428-003   # passkey (chairman passkey-gated on-demand PIN issuance)
related_handoffs: []
tags:
  - voting
  - kiosk
  - on-site
  - accessibility
  - seniors
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Let an owners' assembly vote on a **single shared device** (tablet/laptop in
"kiosk mode") run by the vote counter: each owner steps up, identifies with a
**PIN**, votes on every agenda item with **three big buttons (ZA / PROTI / ZDRŽAL
SA)**, confirms once, the screen resets for the next owner. This is the on-site
counterpart to remote voting and the answer to the project's core challenge —
*owners aged 50–75, often without a usable phone, registering and voting in person
at the meeting*. It is the one clearly-better feature the closed competitor (SVB)
ships that we lack; this spec closes that gap, openly.

### Problem statement

Today an owner who is physically at the schôdza but has no smartphone / email
access can only vote on **paper** (which then needs a photo and manual recording).
There is no supervised, paperless, in-person electronic path. Seniors are exactly
the cohort that struggles with the remote passkey/email flows, yet they are the
ones who show up in person. Kiosk mode turns the meeting itself into the easiest
way to vote.

## Scope

**In scope**
- A **kiosk-operator assignment**: chairman/admin marks a user **account** as the
  kiosk operator for a voting for a **time window**; that account's login boots
  straight into the **locked kiosk-only UI** and nothing else. The operator can
  **self-cancel** (exit kiosk), and chairman/admin **see the live state** (in
  kiosk / exited). Outside the window the account is normal.
- A **prezenčná listina (attendance list)**: counter checks photo ID against the
  owner registry and the owner signs (sheet or on-glass) — the legal identity
  anchor; the kiosk ballot binds to this entry.
- **Per-owner PIN** as a *convenience selector* (single-use, **either pre-printed
  in batch or issued on-demand by the chairman's passkey**) that loads the owner's
  eligible units/shares — explicitly **not** the identity proof.
- **Counter attestation** per ballot (`recordedById` = counter) + an optional
  **on-glass signature** captured and hashed into the audit bundle.
- A **chairman control panel** (own device): issue PINs **gated by the chairman's
  passkey**, plus a **live board of outstanding (not-yet-used) PINs** over a push
  channel (SSE recommended; WebSocket optional) — display-only, no PIN secrets.
- The **multi-item ballot** (BYT-20260609-008) rendered for kiosk: all items, three
  large ZA/PROTI/ZDRŽAL SA buttons, the bulk-set helper, a **review screen**, then
  **one confirm**. Multi-unit owners vote all their units in the one session.
- **Identity-confirm step**: after PIN, the screen shows the owner's name + unit(s)
  so the owner and the counter both confirm "this is me" before voting.
- **Locked-down kiosk UI**: voting-only, no navigation away, no other owners' data,
  **auto-reset to the PIN screen** after each ballot and on idle timeout; exiting
  kiosk mode is done only by the **assigned operator** (self-cancel, with re-confirm)
  — an owner at the device cannot leave the voting UI.
- A distinct **`kiosk` confirmation kind** on the ballot, `recordedById` = the
  counter, and a `kioskSessionId` link for audit traceability.
- Accessibility-first UI (large targets, high contrast) — a key surface for the
  WCAG work (BYT-20260609-003).

**Out of scope**
- **Offline kiosk** — MVP requires connectivity; offline-then-sync raises integrity
  questions, deferred (Notes).
- Replacing remote voting (email/passkey) or the paper+photo path — kiosk **adds** a
  third on-site channel.
- Per-owner biometric/passkey **on the shared kiosk** (a shared device can't own
  each owner's passkey) — the voter uses a PIN there. (The **chairman** does use
  their passkey, but on their own control device, to issue PINs.)
- Printed per-owner confirmation slips — possible fast-follow, not MVP.
- Self-registration at the kiosk — owners must already be eligible members; the
  bulk-registration QR flow (BYT-20260501-…) covers onboarding.

## Approach

### Identification & legal evidence — the PIN is NOT the identity

A PIN on a **shared** device can never prove identity — it is transferable,
guessable, shoulder-surfable. So the PIN is demoted to a **convenience selector**
(it only loads the right owner's ballot quickly) and carries **no** evidentiary
weight. Legal identity reproduces the chain that already makes a **paper** ballot
bulletproof — a wet signature plus a witness — captured digitally:

1. **Prezenčná listina (attendance list) — the identity anchor.** On arrival the
   counter/chair checks the owner's **photo ID** against the owner registry and the
   owner **signs** (wet signature on a sheet, or on the device glass). SK/CZ law
   already requires an attendance list for a schôdza; this signed, ID-checked entry
   is the proof of *who was present*.
2. **Counter attestation per ballot — the witness of record.** The counter (the
   statutory overovateľ / scrutineer) records each kiosk ballot bound to that
   owner's attendance entry; `recordedById` = the counter — exactly the basis of a
   recorded paper vote.
3. **On-glass signature per ballot (recommended).** The owner signs the screen
   confirming their item choices; the signature image + the canonical ballot
   content + timestamp are captured and **hashed into the audit bundle** — the
   electronic analogue of a signed written ballot, binding *this owner* to *these
   choices*.
4. **Immutable & independently verifiable.** Attendance-signature hash + attestation
   + ballot fold into the tamper-evident audit bundle (BYT-20260518-001 /
   BYT-20260609-005) and the zápisnica, so "owner X cast these choices, identified
   by counter Y, signed at time T" is reproducible by a third party.

| Channel | Identity proof | Non-repudiation |
|---|---|---|
| Email link | mailbox possession | weak |
| Passkey (T1) | hardware-bound credential | strong, cryptographic |
| **Kiosk** | **signed, ID-checked attendance + counter witness + on-glass signature** | **paper-equivalent, evidenced** (not PIN secrecy) |
| Paper + photo | wet signature on photographed ballot | paper |

Kiosk is **as defensible as paper** because it reproduces paper's evidence (wet
signature + witness), not because the PIN is secret. Final statutory sufficiency
under §14a (SK) / §1206 (CZ) — including whether an on-glass signature is required
or the ID-checked attendance entry suffices — is confirmed by the **T9 legal
opinions** before reliance (Notes).

### Kiosk session lifecycle

```
chairman/admin assigns an operator ACCOUNT to voting V for a window [from,to]
  -> kiosk_sessions row (operatorUserId, status=active)
operator logs in within the window -> app boots into the LOCKED kiosk-only UI,
  nothing else reachable. (Outside the window / cancelled -> normal app.)
check-in (prezenčná listina): the officer at the device checks owner photo ID vs
  registry; owner signs on-glass (attendance). The owner's single-use PIN is EITHER
  pre-printed (batch) OR the chairman issues it now via PASSKEY (on-demand).
  -> voting_attendance row + voting_pins row (status=issued)
loop per owner:
  PIN screen  -> owner enters PIN (selector only, not identity)
  identity confirm -> shows owner name + unit(s); owner + officer confirm match
  ballot -> all items, big ZA/PROTI/ZDRŽAL buttons, bulk-set, review
  on-glass signature -> owner signs their choices (recommended)
  confirm -> one signed ballot bound to the attendance entry
             (confirmationKind=kiosk, recordedById=officer, attendanceId set,
              kioskSessionId set, onGlassSignatureSha256 captured), PIN consumed
  auto-reset to PIN screen (also on idle timeout)
operator self-cancels (re-confirm) -> status=cancelled, app returns to normal;
  chairman/admin see the change live. (chairman/admin can also cancel or extend.)
```

The kiosk UI is a **locked, voting-only** surface: it never shows other owners'
data, has no nav chrome, and can be exited only by the **assigned operator account**
(self-cancel, with re-confirm) — not by an owner at the device. Idle timeout returns
to the PIN screen so a walked-away device doesn't expose a loaded ballot.

### Kiosk-operator assignment & locked sign-in

The kiosk operator is a **user account**, not a device: chairman/admin assigns the
account to a voting for a window `[windowFrom, windowTo]`. Enforcement is at
sign-in — the locale layout / middleware checks for an `active` `kiosk_sessions` row
for the current user where `now ∈ window`; if present it renders the **KioskShell**
(locked, kiosk-only routes) instead of the normal dashboard, and blocks every other
route. Outside the window, cancelled, or expired → the account is fully normal.

The operator can **self-cancel** at any time (a re-confirm step prevents an owner
tapping it out); chairman/admin can also cancel or extend. Every transition (assign,
enter kiosk on login, self-cancel, admin-cancel, expire) is pushed to the
chairman/admin **live board** over the same channel as the pending-PINs board, so
"my account is no longer in kiosk mode" is visible immediately.

**Who may be an operator (legal):** the attestation/witness (`recordedById`) must be
an **authorized officer** (counter / overovateľ / board member). Assign kiosk-operator
status to such an officer — assigning it to an arbitrary owner would break the
witness basis of the identity model. Flagged for T9.

### PIN issuance & the chairman's live control panel

The chairman runs a control panel on their **own authenticated device** (separate
from the shared kiosk):
- **Issue (on-demand mode):** search the owner for this voting → tap *Vydať PIN* →
  **passkey prompt** → a single-use PIN is generated and shown to read out / hand
  over, attributed to the chairman (`issuedById`, `issuedAt`). (In **batch mode**
  PINs are pre-generated and printed instead — the panel just tracks them.)
- **Live pending board:** a real-time list of **outstanding PINs** — `issued` but
  not yet `consumed`/`cancelled` — so the chairman sees exactly who can still vote.
  When the owner finishes at the kiosk the PIN flips to `consumed` and **drops off
  the board live**; the chairman can also **cancel** a PIN (owner left / declined).
  Works for both issuance modes.
- **Real-time channel:** the board updates over a push channel. **SSE is the
  recommended fit** — updates are one-way server→client (PIN issued / consumed /
  cancelled) and SSE runs inside a normal Next.js route handler with **no custom
  server**. A **WebSocket** (as requested) is viable too but needs a custom Node
  server or a separate WS process in the App Router (no native WS in route
  handlers); choose WS only if a bidirectional need later justifies it. Either way
  the channel is **display-only**: it carries owner + status, **never PIN secrets**,
  so a leaked stream can't be used to vote.

The kiosk device and the chairman panel are distinct surfaces: the kiosk takes the
PIN and records the vote; the panel issues/tracks PINs.

### PIN model & shared-device threat model

- **A compromised/guessed PIN does not by itself produce a valid vote.** Identity
  rests on the signed, ID-checked attendance entry + the counter's attestation (+
  the on-glass signature), none of which exist for an impostor. The PIN only routes
  to a ballot; the legal record is the attendance + attestation chain.
- PINs are **single-use**, one per (voting, owner), stored **hashed**, with **two
  issuance modes** the operator picks per voting:
  - **Pre-generated (batch):** minted at voting/kiosk setup and **printed** on the
    prezenčná listina, handed out at check-in.
  - **On-demand (live):** the chairman issues a PIN per owner face-to-face, **gated
    by the chairman's passkey** (T1), attributed to them (`issuedById`).
  Either way the PIN is handed over only after the ID check and never carries legal
  weight.
- A PIN is **invalidated** on a successful ballot (`status=consumed`) or when the
  owner declines / the chairman revokes it (`status=cancelled`); only an `issued`
  PIN can vote. A cancelled PIN can be re-issued.
- **Brute-force mitigation:** short lockout after N failed attempts per PIN; in-person
  context + supervision is the primary control. PIN entry is rate-limited.
- **Shoulder-surfing / vote-as-another:** the identity-confirm screen (name + unit)
  forces a visible match; single-use PINs prevent re-voting; the officer supervises.
- **Device walk-away:** idle auto-reset + no persisted ballot state between owners.
- A consumed PIN cannot start a second ballot for that owner in the voting.

### Schema additions (`mod_voting_*`)

```ts
kiosk_sessions {                                  // an account placed in kiosk mode for a window
  id             uuid pk defaultRandom
  votingId       uuid -> votings.id  on delete cascade  notNull
  operatorUserId uuid -> users.id    on delete cascade  notNull   // account put into kiosk mode
  assignedById   uuid -> users.id    on delete set null           // chairman/admin who assigned
  windowFrom     timestamp notNull
  windowTo       timestamp notNull
  deviceLabel    varchar(120)
  status         varchar(16) notNull default 'active'  // active | cancelled | expired
  cancelledAt    timestamp
  cancelledById  uuid -> users.id    on delete set null            // self (operator) or chairman/admin
  createdAt      timestamp defaultNow notNull
}

voting_pins {
  id           uuid pk defaultRandom
  votingId     uuid -> votings.id  on delete cascade  notNull
  ownerId      uuid -> users.id    on delete cascade  notNull
  pinHash      varchar(255) notNull
  issuedById   uuid -> users.id    on delete set null            // chairman (on-demand, passkey); null/setup-admin for batch
  issuanceMode varchar(16) notNull default 'batch'   // batch | on_demand
  status       varchar(16) notNull default 'issued'  // issued | consumed | cancelled
  issuedAt     timestamp defaultNow notNull
  consumedAt   timestamp                              // set when the ballot is recorded
  cancelledAt  timestamp                              // owner declined / chairman revoked
  attempts     integer notNull default 0
  lockedUntil  timestamp
  unique (votingId, ownerId)
}

voting_attendance {                                   // prezenčná listina — the identity anchor
  id              uuid pk defaultRandom
  votingId        uuid -> votings.id  on delete cascade  notNull
  ownerId         uuid -> users.id    on delete restrict notNull
  identifiedById  uuid -> users.id    on delete set null            // counter/chair who checked ID
  idCheckMethod   varchar(32) notNull                  // 'photo_id' | 'known_in_person' | ...
  signatureStorageKey varchar(1024)                    // wet-signature scan or on-glass image
  signatureSha256 varchar(64)                          // hashed into the audit bundle
  checkedInAt     timestamp defaultNow notNull
  unique (votingId, ownerId)
}
```

`ballots` (BYT-20260609-008) gains:
- `confirmationKind` includes a new value **`kiosk`**;
- `kioskSessionId  uuid -> kiosk_sessions.id   on delete set null` (nullable);
- `attendanceId    uuid -> voting_attendance.id on delete restrict` (the identity
  anchor the ballot is bound to — required for a kiosk ballot);
- `onGlassSignatureSha256  varchar(64)` (the per-ballot signature, hashed into the
  audit bundle).

A kiosk ballot is `voteType = electronic`, `confirmationKind = kiosk`,
`recordedById = officer` (the supervising authorized officer), with `kioskSessionId`
set; it folds into the audit bundle
like any ballot (the bundle leaf already carries `voteType` + `confirmationKind`).
Enum value adds use the hand-written migration pattern (CLAUDE.md).

### Accessibility (ties BYT-20260609-003)

The kiosk ballot is a flagship senior-facing surface: three large, high-contrast,
explicit ZA/PROTI/ZDRŽAL buttons (per the CLAUDE.md multi-state rule — no implicit
toggle), large touch targets (≥44px, and a WCAG-2.2 target-size candidate), visible
focus, and a simple linear flow. It must pass the T4 audit; list it as a covered
surface there.

## Acceptance Criteria

- [ ] A chairman/admin can assign an operator **account** to a voting for a time
      window; within the window that account's login boots into the locked
      kiosk-only UI and nothing else, and outside it the account is normal.
- [ ] The operator can self-cancel kiosk mode (with a re-confirm step); the
      assign / enter / self-cancel / admin-cancel / expire transitions appear on the
      chairman/admin live board in real time.
- [ ] An owner cannot be voted for without a `voting_attendance` entry first: the
      counter checks photo ID and the owner signs (on-glass), creating the entry.
- [ ] An owner enters their per-voting PIN (selector only), sees an identity-confirm
      screen (name + unit(s)), and is shown the multi-item ballot for all eligible
      units.
- [ ] The ballot uses three large ZA/PROTI/ZDRŽAL SA buttons + bulk-set + a review
      screen, and a single confirm records one ballot per unit with
      `confirmationKind=kiosk`, `recordedById=counter`, `attendanceId` set (bound to
      the identity anchor), `kioskSessionId` set, and an `onGlassSignatureSha256`.
- [ ] A kiosk ballot **without** a bound `attendanceId` is rejected; a guessed/leaked
      PIN alone (no attendance entry, no attestation) cannot produce a valid ballot.
- [ ] The attendance signature hash and the per-ballot on-glass signature hash are
      folded into the audit bundle and reproducible by the verifier.
- [ ] A PIN is single-use: after a ballot is recorded it cannot start another for
      that owner; N failed attempts lock the PIN for a cooldown.
- [ ] Both issuance modes work: **pre-printed batch** PINs, and **on-demand** PINs
      issued by the chairman — the latter **requires the chairman's passkey** and is
      attributed to them (`issuedById`, `issuanceMode='on_demand'`).
- [ ] A PIN is invalidated on a successful ballot (`consumed`) or on owner/chairman
      cancel (`cancelled`); only an `issued` PIN can vote; a cancelled PIN can be
      re-issued.
- [ ] The chairman's pending-PINs board updates in **real time** (push channel) as
      PINs are issued, consumed, or cancelled, and carries owner + status only —
      **never PIN secrets**.
- [ ] The screen auto-resets to PIN entry after each ballot and after idle timeout;
      no loaded ballot persists between owners.
- [ ] The kiosk UI shows no other owners' data and can be exited only by the
      assigned operator (self-cancel, re-confirm) — not by an owner at the device.
- [ ] A kiosk ballot appears in the audit bundle indistinguishably-validly from
      other ballots (its `confirmationKind` recorded), and counts in per-item
      resolution under the per-share model.
- [ ] The kiosk ballot surface passes the WCAG 2.1 AA audit (BYT-20260609-003).
- [ ] New UI strings exist in `sk.json`, `cs.json`, `en.json`.

## Project Context

- **Ballot model:** `ballots` + `ballot_item_votes` (BYT-20260609-008) — kiosk casts
  exactly this; it adds `confirmationKind=kiosk` + `kioskSessionId`.
- **Counter:** `votings.voteCounterId` (`modules/voting/src/db/schema.ts:72`) — the
  natural kiosk operator; reuse, don't invent a role.
- **Choices:** `voteChoiceEnum` = `za|proti|zdrzal_sa` (`:23`) — the three buttons.
- **Identification tiers:** complements email (existing), passkey (RES-20260428-003),
  paper+photo (BYT-20260508-…). Kiosk = counter-supervised, paper-equivalent trust.
- **Accessibility:** flagship surface for BYT-20260609-003 (seniors, big targets).
- **Onboarding:** eligibility/registration via the bulk-registration QR flow, not the
  kiosk.

## Notes

### Decisions to confirm before `in_progress`
- **Live channel — SSE vs WebSocket:** the pending-PINs board is one-way
  server→client, so **SSE** (works in a plain Next.js route handler, no custom
  server) is recommended; the requested **WebSocket** needs a custom Node server or
  a separate WS process in the App Router. Pick WS only if a bidirectional need
  emerges. Either way the stream is display-only (owner + status, no PIN secrets).
- **§14a/§1206 sufficiency of counter-supervised PIN identification** — gated on the
  T9 legal opinions (same opinions that cover the rest of the voting workflow). If a
  jurisdiction needs more, kiosk may require a co-signed counter attestation per
  ballot.
- **PIN format & distribution** — 6-digit vs longer; printed on the attendance sheet
  vs handed at the door. Balance senior usability against brute-force; in-person
  supervision is the main control.
- **Multi-unit owners** — confirm the session walks the owner through each of their
  units' ballots in one sitting, or one combined ballot spanning units.

### Deferred
- **Offline kiosk** (poor connectivity at meetings) — integrity of offline-then-sync
  voting is non-trivial; MVP requires connectivity. Strong follow-up candidate.
- **Printed confirmation slip** per owner after voting — fast-follow.

Placement note: filed in `specs/specs/` (status `spec`). A focused addition on top of
the multi-item ballot; its main external dependency is the T9 confirmation that
counter-supervised PIN identification satisfies the statutory identification
requirement. Best built right after BYT-20260609-008 (it renders that ballot).
