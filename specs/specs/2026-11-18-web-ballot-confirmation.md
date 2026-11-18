---
spec_id: BYT-20261118-009
title: "Web ballot confirmation — one shared e-mail confirmation path for web and MCP, ballot signature, receipt"
status: spec
created: 2026-11-18
updated: 2026-11-18
author: byt-app
owner: filipvnencak
last_verified: 2026-11-18
project_type: other
depends_on:
  - BYT-20261117-001   # MCP server — §6 ballot confirmation (pending ballots, /voting/confirm/<token>)
  - BYT-20261117-002   # UX simplification — Phase 6 confirmed e-vote (passkey + e-mail gate)
  - BYT-20260609-008   # multi-item ballot (one confirmation commits every item)
related_handoffs: []
tags:
  - voting
  - legal
  - email
  - security
  - schema-change
feature_branch: "feat/web-ballot-confirmation"
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

An electronic ballot cast on the web and one proposed through an AI app (MCP)
are confirmed by **the same e-mail confirmation path**: one pending-ballot
table, one single-use 30-minute link, one confirm page that requires the
owner to be signed in, one writer of `mod_voting_ballots`, one receipt
e-mail. Every confirmed electronic ballot carries a defined `signature`.
Nothing unconfirmed is ever counted.

### Problem statement

The "Found gaps" note in BYT-20261117-001 says the web cast writes a final
ballot on session alone, `sendVoteConfirmation` is dead code and
`ballots.signature` is never written. Checked against the code on
2026-11-18, that note is **partly out of date**: BYT-20261117-002 Phase 6
already added a confirmation gate (`POST /api/ballots` without a proof
returns `CONFIRMATION_REQUIRED`), a passkey path that stores the WebAuthn
proof in `signature`, and an i18n receipt (`sendVoteConfirmation` in
`modules/voting/src/email/vote-confirmation.ts`; the copy in
`src/lib/email.ts` is gone). These gaps are still open:

| # | Gap | Where |
|---|---|---|
| G1 | **Two e-mail confirmation paths.** Web: stateless signed token, page `/vote-confirm?t=`. MCP: `mod_voting_pending_ballots` row, page `/voting/confirm/<token>`. They follow different rules for single use, supersede, cancel, retention and login. | `routes/api/ballots/confirm.server.ts` (`emailConfirmation`, `castConfirmed` e-mail branch) vs `pending-ballots.ts` |
| G2 | The web e-mail link **does not require login** ("the link may be opened on another device"). Whoever opens the link casts the ballot. This goes against BYT-20261117-001 Decided 3 (the token binds the ballot, the session binds the person) and against the schema comment on `confirmationKind` ("confirmed while signed in"). The withdraw link has the same problem. | `castConfirmed`, `withdrawConfirmed` |
| G3 | The shared confirm page `/voting/confirm/<token>` only works when the **MCP module is enabled**. | `voting/confirm/[token]/page.tsx`, `actions.ts` |
| G4 | E-mail-confirmed ballots store `signature = NULL` on both paths. | `confirm.server.ts:473`, `pending-ballots.ts:407` |
| G5 | An MCP-confirmed ballot **gets no receipt** (§14a ods. 5). Only the web `finish()` sends one. | `pending-ballots.ts confirmPendingBallot` |
| G6 | Pending-ballot rows (the audit trail of an e-mail confirmation) are deleted 90 days after creation, even while the voting is still open or within the court-challenge window. | `sweepPendingBallots` |
| G7 | The confirm page copy says "you prepared this ballot through an AI app" for every row. | `VotingConfirm.intro` |

## Scope

**In scope**
- Web e-mail cast goes through `mod_voting_pending_ballots` (`source='web'`)
  and `/[locale]/voting/confirm/<token>`, exactly like MCP §6.
- The inline first-vote passkey activation travels on the pending row.
- `ballots.signature` defined for both confirmation kinds and written on
  every confirmed electronic ballot.
- Receipt e-mail sent for every confirmed electronic ballot (web and MCP).
- Login required on every e-mail link that changes a ballot (cast and withdraw).
- Retention of pending rows tied to the voting's end, not to row age only.
- i18n sk/en/cs for every changed string.

**Out of scope**
- Passkey confirmation mechanics (Phase 6). The passkey path is already an
  active confirmation in a short single-use window. It stays as it is; it
  shares the writer (`recordConfirmedBallot`) and the receipt.
- Paper ballots, kiosk on-site voting (BYT-20260609-007), vote counter entry,
  mandates. See §9.
- Moving the withdraw link onto the pending table (see Open question 5). Only
  its login requirement changes here.
- Externally verifiable signatures for e-mail ballots (transparency log /
  anchoring spec BYT-20260609-005 owns this).

## Approach

### 1. One confirmation path

```
web OwnerBallot ─ POST /api/ballots/email-confirmation ─┐
                                                        ├─ validateCast(electronic)          (cast.server.ts)
MCP request_ballot_confirmation ─ confirm view click ───┘   createPendingBallot({source})      (pending-ballots.ts)
                                                            sendVoteConfirmationLink / sendBallotConfirmation
                                                                         │ e-mail, 30 min, single use
                                                                         ▼
                                   GET /[locale]/voting/confirm/<token>  (login as the same owner)
                                   POST decidePendingBallot(confirm|cancel)
                                                                         ▼
                                   confirmPendingBallot → validateBallotCast (re-run)
                                                        → recordConfirmedBallot (only writer, locks)
                                                        → signature, receipt
web passkey ─ POST /api/ballots {confirmation: passkey} ─────────────────┘ (same writer + receipt)
```

- `createPendingBallot(v, { source: 'web' | 'mcp', clientId, pendingActionId,
  locale, activatePasskey? })` is the only place that issues an e-mail
  confirmation for a cast. The web route maps its `McpError` codes to the
  existing `CastErrorCode`s (`rate_limited` → `RATE_LIMITED`,
  `conflict.state_changed` → `BALLOT_CONFLICT`).
- `confirmPendingBallot` is the only place that turns an e-mail
  confirmation into a ballot, for both sources.
- The stateless `vote-email` token is **no longer minted**. `castConfirmed`
  rejects `confirmation.method='email'` (`CONFIRMATION_EXPIRED`), and
  `/vote-confirm` shows a `vote-email` token as expired. A link already sent
  before the deploy stops working (it would have expired within 30 minutes
  anyway). The owner starts over.
- The web e-mail template stays `sendVoteConfirmationLink` (no AI-app
  wording) and the MCP one stays `sendBallotConfirmation` (names the AI
  app). Both now state the short ballot hash and that sign-in is required,
  and both link to the same page.

### 2. Confirm page (shared)

- `/[locale]/voting/confirm/<token>` is gated by the **voting** module only.
  A row with `source='mcp'` is still shown only while the MCP module is
  enabled. Stricter: turning MCP off stops AI-originated requests (Open
  question 3).
- Login required. The page redirects to `/login?callbackUrl=…`. A token that
  belongs to another owner shows no content.
- The intro text depends on `source`: `introWeb` for the web and `intro`
  (AI app) for MCP.
- A `GET` never records anything (mail scanners prefetch). Only the explicit
  POST from the page does.
- After a confirm with passkey activation the page says so (`passkeyActivated`).

### 3. Writing and single use

These are unchanged from §6 and Phase 6. The token is claimed atomically
(`UPDATE … WHERE token_hash AND owner AND status='pending' AND expires_at >
now() RETURNING`). Eligibility is checked again against current state, and
the hash must equal the e-mailed one. `recordConfirmedBallot` runs under
the voting row `FOR SHARE` and the ballot row `FOR UPDATE`, enforces the
deadline, never overwrites a paper ballot, and refuses if the ballot was
recorded, changed or withdrawn after the request was created (`pb` =
current ballot state, `iat` = row `createdAt`).

### 4. Passkey activation on the pending row

The inline first-vote flow (register passkey → e-mail link activates it and
casts) keeps working. `activate_passkey_id` (FK `webauthn_credentials.id`,
`onDelete: set null`) and `activate_passkey_credential_id` are stored on the
pending row. On confirm, `activatePendingPasskey(owner, id, credentialId)`
runs first, the same way Phase 6 did it, even if the ballot itself then
fails as stale. MCP rows never set these columns.

### 5. `ballots.signature` — definition

| `confirmation_kind` | `signature` | Verifiable by |
|---|---|---|
| `passkey` | Unchanged: JSON `{credentialId, publicKey, authenticatorData, clientDataJSON, signature}`. The WebAuthn assertion is over a challenge bound to (voter, voting, unit, ballotHash, pb). | Anyone, with the public key. **External** proof. |
| `email` | `hmac-sha256:v1:<hex>` = HMAC-SHA256(K, `v1\|email\|<votingId>\|<unitId>\|<ownerId>\|<ballotHash>\|<confirmedAt epoch ms>\|<pendingBallotId>`), K = HMAC-SHA256(AUTH_SECRET, `open-housing/ballot-signature/v1/email`) | The server only. **Internal** tamper detection. |
| paper / legacy | `NULL` | — (paper: the photo of the signed ballot is the evidence) |

Why this form:
- An e-mail click gives us no key held by the owner, so no signature from
  the owner is possible. What we can prove is that *this server's confirm
  path* wrote the row for *this* (voting, unit, owner, content, time,
  confirmation request). The HMAC makes a later DB-level edit of any bound
  field, or a ballot row inserted outside the confirm path, detectable when
  the value is recomputed.
- `ballotHash` alone covers only the item choices. It does not cover the
  voting, unit or owner, so those are bound explicitly. `pendingBallotId`
  ties the ballot to the stored click record (token hash, `usedAt`), and
  `confirmedAt` ties it to the moment of confirmation.
- `docs/domain/voting.md` allows secret-salted digests **only** for internal
  tamper detection, never in an externally verifiable artefact. So this
  value is labelled internal and must not be presented as proof to a third
  party (audit bundle: exclude it or label it "internal integrity code").
- The key is derived from the existing auth secret (no new env var, same as
  `signed-token.server.ts`), and the domain-separation label differs from
  every token key. `v1` in the value allows rotation (Open question 4).
- The writer computes it inside the write transaction, from the final
  `recordedAt`, because `recordConfirmedBallot` chooses the timestamp. It
  accepts `signature: string | ((recordedAt) => string)`.
- `verifyEmailBallotSignature()` is exported for a later integrity check.
  The admin UI does not call it in this spec.

### 6. E-mails (i18n, legal)

- Link e-mails: every string goes through `getTranslations({ locale,
  namespace })`, and every function takes `locale?` (CLAUDE.md email rule).
  New keys `Email.vote.linkHash` and `Email.vote.linkLoginNote`.
  `Email.ballotConfirm.loginNote` already exists.
- **Receipt** (`sendVoteConfirmation`, revived in Phase 6) is sent for every
  confirmed electronic ballot from one helper, `sendBallotReceipt`. That
  covers web e-mail, web passkey and MCP. It is best effort and never blocks
  or fails the recorded vote. For SK it cites §14a ods. 5.
- Every e-mail body and the confirm page are **statutory content**. Legal
  sign-off (SK and CZ) is needed before release.

### 7. Expiry and resend

- The link is valid for 30 minutes and can be used once (`PENDING_BALLOT_TTL_MS`
  = `EMAIL_CONFIRMATION_TTL_MS`).
- There is **no resend** (`voting.md` Counterparts). A new request for the
  same (voting, unit, owner) supersedes the previous live one, so only the
  newest link works. An expired link is dead and the owner starts over.
- Limits: at most 3 e-mails per (voting, owner) per hour, counted across web
  and MCP together. The web route keeps its own 5 per 15 minutes per IP.
- Expiry is evaluated when a row is read. There is no background job, which
  keeps this safe across replicas.

### 8. Change of vote and withdrawal (undo path)

- **Change before the deadline:** the owner casts again (web or MCP). The
  new confirmation replaces the electronic ballot in place (same row, new
  hash, new `confirmedAt` and new `signature`). The previous pending row
  keeps its hash and `ballotId` as the trace.
- **Cancel a pending request:** "Zrušiť — neodovzdať hlas" on the confirm
  page sets the row to `cancelled`. Nothing is cast.
- **Withdraw a recorded ballot:** this is still the Phase 6 withdraw flow
  (passkey, or an e-mail link to `/vote-confirm`), **now with login
  required**. The page redirects to login, and `DELETE` checks that the
  session user is the token's voter.
- A paper ballot cannot be changed or withdrawn by its owner
  (`PAPER_BALLOT_LOCKED`).

### 9. Deadline — unconfirmed ballots never count

- A pending ballot lives only in `mod_voting_pending_ballots`. No results,
  participation, turnout, quorum, external-API or audit-bundle query reads
  that table. **An unconfirmed ballot is never counted**, before the
  deadline or after it.
- A confirm after `endsAt` or after close fails: `lockActiveVoting` raises
  `VOTING_ENDED` or `VOTING_NOT_ACTIVE`, the page shows `voting_not_active`
  and the row becomes `failed`. A link sent at 23:50 for a 24:00 deadline
  that is clicked at 00:05 does **not** count. The e-mail and the page
  state the expiry time, and the voting's end time is on the page.
- Reopening a voting does not revive any pending row.

### 10. Audit

- `mod_voting_pending_ballots` is the record of each e-mail confirmation:
  who, which ballot hash, created, used/expired/cancelled/superseded/failed,
  source, AI client, and the resulting `ballotId`. Choices are cleared once
  the row leaves `pending`, because the ballot itself holds them.
- Retention: a row is deleted only when it is older than 90 days **and**
  its voting ended more than 90 days ago (G6). The stricter choice covers
  the court-challenge window. See Open question 2.
- MCP-originated decisions also write `mcp_audit_log` (`web:confirm_ballot`
  / `web:cancel_ballot`), unchanged. Web-originated decisions do not, since
  the pending row is their audit record.
- `ballots.confirmation_kind`, `confirmed_at` and `signature` record how and
  when the ballot was confirmed. Paper replacing electronic keeps its
  `ballot_superseded` voting event.
- No new `mod_voting_event_kind` values. Per-ballot events would flood the
  board's voting history (Open question 6).

### 11. Kiosk / vote counter / paper

These are **out of scope and unchanged**. A paper ballot is confirmed by
the photograph of the signed ballot, entered by the board or by this
voting's vote counter. It never goes through the pending table. If a
pending web or MCP request exists for a unit when a paper ballot is
recorded, the later confirm fails (`PAPER_BALLOT_LOCKED` →
`conflict.state_changed`), because paper beats electronic (§14a ods. 7).
Kiosk on-site voting follows its own spec, BYT-20260609-007.

### 12. Schema and DB impact

| Change | Kind |
|---|---|
| `mod_voting_pending_ballots.activate_passkey_id uuid NULL → webauthn_credentials(id) ON DELETE SET NULL` | additive column + FK |
| `mod_voting_pending_ballots.activate_passkey_credential_id text NULL` | additive column |
| `source` TypeScript type `'mcp' \| 'web'` (column is already `varchar(16)`) | none |

- Generated with `pnpm db:generate` (drizzle-kit). There is no hand-written
  SQL and no backfill. `ALTER TABLE ADD COLUMN` (nullable, no default) holds
  only a brief lock, on a small table.
- No runtime DDL, no background job and no per-node state. The sweep runs
  inside a request and has a bound (`LIMIT 200`).

## Acceptance Criteria

Shared path
- [ ] The web "Poslať potvrdzovací e-mail" request writes **no**
      `mod_voting_ballots` row. It writes one `mod_voting_pending_ballots` row
      with `source='web'` and sends one e-mail whose link is
      `/<locale>/voting/confirm/<token>`.
- [ ] Only `confirmPendingBallot` (e-mail) and the passkey `castConfirmed`
      reach `recordConfirmedBallot`. A grep for writers of `ballots` finds
      only those two plus the paper and board paths.
- [ ] `POST /api/ballots` with `confirmation.method='email'` returns
      `CONFIRMATION_EXPIRED` and writes nothing, and no `vote-email` token is
      minted anywhere.
- [ ] With the MCP module **disabled**, the web e-mail confirmation works
      end to end. A `source='mcp'` row then shows "invalid" and cannot be
      confirmed.
- [ ] The MCP `request_ballot_confirmation` flow still works the same as
      before (§6 ACs of BYT-20261117-001 still hold).

Login and binding
- [ ] Opening a confirm link without a session redirects to login and
      returns to the page afterwards. Nothing is recorded by the GET.
- [ ] Signed in as another user: the page shows no ballot content, and
      confirm returns `forbidden`.
- [ ] A withdraw link (`/vote-confirm?t=`) opened without a session
      redirects to login. `DELETE` with an e-mail token returns `FORBIDDEN`
      when the session user is not the token's voter.

Expiry, supersede, cancel
- [ ] A link clicked after 30 minutes shows "expired", casts nothing, and
      the row is `expired`.
- [ ] A second request for the same (voting, unit, owner) makes the first
      link show "superseded". Only the newest link confirms.
- [ ] A second confirm click on a used link returns `action_expired`.
- [ ] "Zrušiť" sets `cancelled` and casts nothing.
- [ ] A fourth e-mail within one hour for the same (voting, owner) is
      refused (`RATE_LIMITED` on the web, `rate_limited` on MCP).

Deadline
- [ ] A pending ballot is never counted in results, participation, turnout
      or quorum before or after `endsAt`. Check by casting with one owner
      and leaving another pending, then comparing the counts.
- [ ] Confirming after `endsAt` (or after close) records nothing and shows
      `voting_not_active`.

Change of vote
- [ ] Re-casting before the deadline replaces the electronic ballot (one
      row per (voting, unit, owner)), and the new `ballotHash`,
      `confirmedAt` and `signature` differ from the old ones.
- [ ] An owner cannot replace or withdraw a paper ballot.

Signature and receipt
- [ ] Every e-mail-confirmed ballot has `signature` starting with
      `hmac-sha256:v1:`, and `verifyEmailBallotSignature` returns true for it.
      Changing `ballot_hash`, `owner_id` or `confirmed_at` in the DB makes it
      return false.
- [ ] Every passkey-confirmed ballot keeps the WebAuthn proof JSON in `signature`.
- [ ] A receipt e-mail (every item, choice, time, full hash, method; SK §14a
      ods. 5 line) arrives after web e-mail, web passkey **and** MCP confirmation.
- [ ] The inline first-vote flow activates the new passkey through the same link.

Audit and retention
- [ ] Each pending row ends in exactly one of `confirmed` (with `ballot_id`),
      `cancelled`, `superseded`, `expired` or `failed` (with `failure_code`),
      and `items` is empty once it is no longer `pending`.
- [ ] The sweep never deletes a row whose voting ended less than 90 days ago.

i18n and legal
- [ ] Every new or changed string is in `sk.json`, `en.json` and `cs.json`.
      E-mails use `getTranslations({ locale, namespace })`.
- [ ] **Legal-copy sign-off** (SK + CZ) on the link e-mails, the receipt
      and the confirm page is recorded before release. Plumbing that works
      is not enough.

## Open questions for Filip

1. **Login on the e-mail link.** BYT-20261117-002 chose "no session, open
   on any device", while BYT-20261117-001 Decided 3 chose "login required".
   This spec takes the stricter rule (login) for web too, because §14a
   needs the vote tied to a verified voter. An owner who opens the e-mail
   on a phone where they are not signed in must now sign in first. Is that
   acceptable for 65+ owners, or should a passkey/e-mail sign-in shortcut
   be added?
2. **Retention of confirmation records.** This spec keeps pending rows
   until 90 days after the voting's end. What period does a court challenge
   (SK §14b ods. 7 style or CZ §1208/§1209) actually need, and should the
   records be kept for the lifetime of the voting record instead?
3. **MCP disabled.** Should a pending AI-originated ballot become
   unconfirmable when the admin turns MCP off? The spec says yes (stricter).
4. **Secret rotation.** `signature` for e-mail ballots depends on
   AUTH_SECRET. If it is rotated, old values no longer verify. Do we need a
   key id and keyring (`v2`), or is "internal only, rotation invalidates
   integrity codes" acceptable?
5. **Withdraw via the pending table.** Withdraw links stay stateless
   (signed token plus revocation marker), now with login. Should withdrawal
   also become a pending row (one model for both), with a `kind` column?
6. **Per-ballot audit events.** Should cast, change and withdraw write
   `mod_voting_voting_events` rows, which would need an enum migration and
   a history filter in the UI? Today a passkey re-cast leaves no trace of
   the previous electronic ballot, and a withdrawal leaves only the
   revocation marker.
7. **Late click.** Is it legally fine that a request made before the
   deadline but confirmed after it does not count? The spec says it does
   not count (stricter). Statute: the vote counts when it is delivered or
   recorded.
8. **Unmarked items** on an e-mail-confirmed ballot: the confirm page shows
   them as "nevyznačené" (silence rule). Does legal want an explicit
   warning, the way MCP preview has one?

## Project Context

- Writer and locks: `modules/voting/src/routes/api/ballots/cast.server.ts`
  (`recordConfirmedBallot`, `lockActiveVoting`).
- Web gate: `modules/voting/src/routes/api/ballots/confirm.server.ts`.
- Shared pending flow: `modules/voting/src/pending-ballots.ts`, page
  `src/app/[locale]/(dashboard)/voting/confirm/[token]/`.
- E-mails: `modules/voting/src/email/vote-confirmation.ts` (web link,
  receipt, withdraw), `src/lib/email.ts sendBallotConfirmation` (MCP link).
- Owner UI: `modules/voting/src/routes/dashboard/id/OwnerBallot.tsx`. The
  response shape `{ sentTo, expiresAt }` is unchanged.

## Notes

### Rollout
- Deploy order: migration (two nullable columns), then the app. There is no
  data backfill. Links sent during the 30 minutes before the deploy stop
  working.
