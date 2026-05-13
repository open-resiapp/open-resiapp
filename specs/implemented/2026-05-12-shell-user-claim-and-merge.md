---
spec_id: BYT-20260512-001
title: "Shell-user claim flow & admin merge for imported owners"
status: implemented
created: 2026-05-12
updated: 2026-05-13
author: byt-app
owner: byt-app
last_verified: 2026-05-13
project_type: node
depends_on: [BYT-20260508-003]
related_handoffs: []
tags: [import, owners, invitations, qr, pairing, shell-users]
feature_branch: ""
changelog_version: "2.1.1"
changelog_date: "2026-05-13"
docs_version: "2.1.1"
docs_communicated: "2026-05-13"
---

## Goal

After the Easy-Import wizard (BYT-20260508-003) seeds a community, the
`users` table is full of **shell users** — rows with `email = NULL`,
`passwordHash = NULL`, `status = 'pending'`, a real name, and live
memberships linking them to their flat with the correct
`owner_unit_share_*`. These rows are inert: nobody can log in as them, and
admins have no UI path to turn them into real accounts.

This spec adds three paths for an imported owner to gain a real, usable
account — without breaking the membership chain that the import + voting
engine depend on:

1. **Admin → email invite (one-click when email is set).** If the shell
   user already has an email (filled either by import or by an earlier
   admin edit), the owner row shows a single **"Send invitation"** button
   — no extra dialog. Click → claim link emailed. If the email is
   missing, the action becomes **"Add email & send invitation"** with a
   small inline input.
2. **Admin → printable claim QR (always available).** Every shell user —
   with or without an email — has a **"Show QR"** action that opens the
   QR + copy-link dialog. Lets admin pair owners offline (notice-board
   QR, hand the printed page over at a schôdza, send via SMS later, etc.).
3. **Admin approves a bulk-QR self-registration → merge.** When a new
   user self-registers through the building's bulk-QR poster, they land
   in the pending-registrations queue with no memberships. The queue
   pre-computes a **name-similarity match** against existing shell users
   in the same community and surfaces the best candidate:
   *"This registration looks like Hricová Petra (byt 1). Merge?"*
   Admin confirms, memberships transfer, shell row is deleted, and the
   bulk-QR registrant becomes the legitimate owner of that flat. If no
   suggestion is good enough, admin can manually pick any shell user from
   a typeahead.

The claim page (`/[locale]/claim/[token]`) is a single shared surface for
#1 and #2.

## Scope

**In scope**

- New `invitations.target_shell_user_id` column (nullable, FK → users.id
  with `ON DELETE CASCADE`). When set, the invitation claim ATTACHES to
  that shell user instead of creating a new user row.
- Admin UI:
  - `/[locale]/dashboard/owners/pending` — list of shell users without
    accounts. Per row:
    - **"Send invitation"** button — visible only when `email IS NOT NULL`
      on the shell user. One-click send.
    - **"Add email & send invitation"** action — visible only when
      `email IS NULL`. Inline input + send in one step.
    - **"Show QR"** button — always visible, opens the QR / copy-link
      dialog regardless of email.
  - `/[locale]/dashboard/owners/pending-registrations` — list of users
    who self-registered via bulk QR but have no memberships yet. Per row:
    - Suggested shell-user match (top 1, with similarity score), with
      "Merge" CTA.
    - "Pick different shell user" fallback → typeahead search.
    - "Dismiss" — keeps the registration as a standalone user (admin can
      revisit later).
- Server actions / API endpoints:
  - `createShellClaim(shellUserId, { email?, mode: 'email'|'qr' })` →
    creates `invitations` row, returns `{ claimUrl, token }`; if
    `mode='email'`, also emails the link to `email`.
  - `claimShellUser(token, { email, password })` → public endpoint used by
    the `/claim/[token]` page; promotes the shell user.
  - `mergeShellIntoUser(shellUserId, targetUserId)` → transactional
    operation that copies/moves memberships from shell to target and
    deletes the shell. Requires admin.
  - `listPendingShellUsers()` and `listClaimableRealUsers(communityId)` —
    backing queries for the admin UI.
- A printable QR component (reuses existing `qrcode` library, already in
  the project).
- i18n strings (Owners namespace) in `sk`, `en`, `cs`.

**Out of scope**

- Bulk-invite: clicking "invite all unpaired owners at once". Useful later
  but a separate spec to keep the merge / token-rotation semantics
  reviewable in isolation.
- SMS / Viber invites. Email + QR cover the realistic operator scenarios;
  SMS is a paid integration with a separate cost model.
- Public "I'm an owner of byt 12, please claim me" self-service: relies on
  identity verification (e.g. rodné číslo from LV) which we explicitly
  excluded for GDPR reasons in BYT-20260508-003. Admin-initiated claim is
  the only path.
- Editing an already-claimed user's memberships from inside the claim
  flow. Once claimed, the user manages their account as a normal active
  user; memberships are operator-only via the entity-tree UI.
- Mobile-app deep links. Web claim URL only; the link works in any browser.

## Approach

### 1. Schema change

```sql
ALTER TABLE invitations
  ADD COLUMN target_shell_user_id uuid
    REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX invitations_target_shell_idx
  ON invitations (target_shell_user_id)
  WHERE target_shell_user_id IS NOT NULL;
```

Non-nullable would break existing invitation rows. The partial index keeps
lookups for "any open invite for shell user X" cheap without bloating the
btree with regular invites.

### 2. Token semantics

Same opaque 32-byte token format used by existing `invitations`. Length 64
hex chars. Expires in 14 days by default (longer than bulk QR's 24h
because per-owner invites are mailed/printed and may not be acted on
immediately).

### 3. Claim flow (`/[locale]/claim/[token]`)

Single page, no auth required.

```
GET  /api/claim/[token]   → { shellName, communityName, expiresAt } | 404
POST /api/claim/[token]   { email, password } → { ok: true } | { error }
```

`POST` flow inside one DB transaction:
1. Resolve invitation row by token. Reject if `status != 'pending'` or
   `expiresAt < now`.
2. Load the shell user. Reject if no `target_shell_user_id` (this code
   path is shell-specific; regular invites use a separate endpoint).
3. Check the supplied email is not already taken by another active user.
4. Update the shell user in place:
   - `email = supplied email`
   - `passwordHash = bcrypt(supplied password)`
   - `status = 'active'`
   - `emailVerifiedAt = now()` (admin-initiated invite, no separate
     verification step — the admin is the one who confirmed the identity
     by typing the email).
5. Mark `invitations.status = 'used'`, `usedByUserId = shell.id`.
6. Audit log entry: `membership.update_role` is overkill, prefer a generic
   `entity.create`-style entry? Actually we don't change memberships here.
   Add a new action enum value `user.claim_shell` (migration follow-up).

On success, redirect to `/login` with the email pre-filled.

### 4. Email invite flow (Mode A)

Server action `createShellClaim(shellId, { email, mode: 'email' })`:
1. Generate token, insert `invitations` row with `target_shell_user_id =
    shellId`, `expiresAt = now + 14d`.
2. Render the claim URL: `${PUBLIC_URL}/${locale}/claim/${token}`.
3. Send email via `src/lib/email.ts`. Per the project rule, the function
   uses `getTranslations({ locale, namespace: "Email" })` against
   `messages/{locale}.json`. New email template
   `claimShellInvitation(recipientEmail, recipientName, communityName,
   claimUrl, expiryDays)`.
4. Return `{ claimUrl, token }` so the admin UI can show a "copy link"
   fallback even after the email is sent.

### 5. QR invite flow (Mode C)

Server action `createShellClaim(shellId, { mode: 'qr' })`:
1. Same as Mode A but skips the email send.
2. Returns `{ claimUrl, token }`.
3. Admin UI renders the QR code client-side using the existing `qrcode`
   library (`import("qrcode")`) — same pattern as the voting zápisnica
   download button. A "Print" button opens a print dialog with just the QR
   + owner name visible.

### 6a. Name-similarity matching (for the registration-approval queue)

When a bulk-QR registration lands in the pending queue, the admin needs a
suggestion of which shell user it probably belongs to. Real-world inputs
look like:

| Shell user (from LV)              | Bulk-QR registrant       |
|-----------------------------------|--------------------------|
| `Hricová Petra`                   | `Petra Hricova`          |
| `Mgr. r. Truchanová Hanzeliová Marcela` | `Marcela Hanzeliová` |
| `Dlugoš Martin r. Dlugoš`         | `Martin Dlugoš`          |
| `MUDr. Chudý Martin`              | `Martin Chudy`           |

Same person; different spelling, order, diacritics, titles, and birth-name
qualifiers. We need a tolerant comparison.

**Algorithm:**
1. **Normalise**: lowercase → strip diacritics (NFKD + remove combining
   marks) → drop titles (`Mgr.`, `Ing.`, `Bc.`, `MUDr.`, `JUDr.`, `RNDr.`,
   `Dipl.- Kfm.`, etc.) → drop "r. <maiden>" segments → split on
   non-letter chars → drop short tokens (< 2 chars).
2. **Token set** for both names. Compare with Jaccard similarity
   (`|A ∩ B| / |A ∪ B|`) — order-independent, handles re-arranged
   "Surname Given" vs "Given Surname".
3. **Score threshold**: `>= 0.5` → "likely match" → suggested. `>= 0.8`
   → "very likely". The UI surfaces the score so the admin sees how
   confident the suggestion is.
4. Tie-breaker when multiple shell users tie: pick the one whose
   memberships haven't yet been claimed (i.e. shell still has `email IS
   NULL`).

Helper lives in `src/lib/name-match.ts`. Pure function, easy to unit-test
against a fixture of LV č. 3182 names.

### 6b. Assign existing account (Mode B — merge)

Server action `mergeShellIntoUser(shellId, targetUserId)`:
1. Load shell user. Assert `status = 'pending'`, `email IS NULL`, AND has
   at least one active membership.
2. Load target user. Assert `status = 'active'` (or `pending` with email),
   AND `id != shellId`.
3. In a single transaction:
   - Copy each shell membership to target: `INSERT INTO memberships (…)
     SELECT … FROM memberships WHERE user_id = shellId` with `userId`
     overwritten to `targetId`. On `(user_id, entity_id)` unique conflict
     (target already has a membership at that unit), keep the target's
     row and skip — log this in audit.
   - Re-point any `votes`, `mandates`, `posts.authorId`, `documents.uploadedById`,
     etc. that reference shell user. Schema-level FK list:
     - `votes.ownerId`, `votes.recordedById`, `votes.disputedByUserId`
     - `mandates.fromUserId`, `mandates.toUserId`
     - `posts.authorId`, `documents.uploadedById`
     - `entityAuditLog.actorUserId`
     - `consentRecords.userId`
     - `boardMembers.userId` (if any)
     - `pushSubscriptions.userId`
     - Anything else: list at implementation time by grepping for
       `references(() => users.id` in `schema.ts`.
   - Delete the shell user row.
4. Audit entry: `user.merge_shell` (new enum value) recording shellId →
   targetId.

A schema-level CASCADE is NOT enough — for `set null` FKs we'd lose votes
(the audit hash chain would still verify but the vote would lose its
owner). So we explicitly UPDATE before DELETE.

### 7. Admin UI

Page: `/[locale]/dashboard/owners/pending` (new), accessible to
`manageUsers`-permission roles (admin).

Layout:
- Table of pending shell users (status='pending', no passwordHash):
  - Name | Unit | Share | Last action | [Actions: Invite • QR • Assign]
- Filter / search by name or unit number.
- Top counter: "X vlastníkov bez prístupového účtu."

Per-row action menu:
- **Pozvať e-mailom** — opens a small dialog: input email, "Send invite"
  button. On success: toast + link to copy as fallback.
- **Vygenerovať QR** — opens a print-ready dialog with the QR, owner name,
  unit number, expiry date, and a "Print" button.
- **Priradiť existujúci účet** — opens a dialog with a typeahead search
  over real (non-shell) users in the same community. Confirm step shows
  exactly what will move (memberships, vote count, etc.) before commit.

Also surface a single-owner version of the same actions on
`/dashboard/owners/[id]` (the owner detail page) when the user is a
shell user.

### 8. Bulk-QR registration interaction

The existing bulk-QR registration flow creates new pending users with no
memberships. After this spec lands, the admin's standard workflow becomes:

1. Owner self-registers via bulk QR — appears as pending user with no
   memberships.
2. Admin opens `/dashboard/owners/pending`, finds the matching shell
   user, clicks "Priradiť existujúci účet", picks the bulk-QR registrant
   from the typeahead.
3. Memberships transfer; the bulk-QR registrant gains access to their
   flat.

We do NOT auto-match by name even when it looks obvious — admin
confirmation is required to avoid identity mix-ups (two Štolc Ondrejs of
different ages, common surnames in small towns, etc.).

## Acceptance Criteria

- [ ] Migration adds `invitations.target_shell_user_id` + the partial index;
      existing invitation rows are unaffected and continue to work.
- [ ] `createShellClaim(shellId, { email, mode: 'email' })` creates an
      invitation, emails the owner, and returns the claim URL.
- [ ] `createShellClaim(shellId, { mode: 'qr' })` creates an invitation and
      returns the claim URL without emailing.
- [ ] Visiting `/[locale]/claim/[token]` shows the owner's name and the
      community name. Submitting valid email + password promotes the shell
      to active, marks the invitation `used`, and redirects to login with
      email pre-filled.
- [ ] Re-using a token returns a clear "this invitation has already been
      used or has expired" error and never grants access.
- [ ] `mergeShellIntoUser(shellId, targetId)` transfers all memberships,
      re-points all FK references in the table list, deletes the shell, and
      records an audit entry. Verified by integration test that has a
      shell user with one membership + one vote; after merge, the vote
      belongs to the target user.
- [ ] If target user already has a membership at one of the shell's units,
      the merge keeps target's existing row, logs a "skipped" line in
      audit, and proceeds with the rest.
- [ ] Admin UI lists all pending shell users for the community. Filtering
      by unit number returns the expected subset.
- [ ] **Conditional rendering of the "Send invitation" action**: shell
      users with `email IS NOT NULL` see a single-click "Send invitation"
      button; shell users with `email IS NULL` see the inline
      "Add email & send invitation" form. Verified with two fixture rows.
- [ ] **"Show QR" is always visible** regardless of email presence. The
      QR dialog renders the QR, owner name, unit, expiry date, and a
      "Copy link" button; "Print" opens a print-only view with just the
      QR + identifying text.
- [ ] Pending-registrations queue surfaces bulk-QR registrants with no
      memberships. Each row shows the top suggested shell-user match (if
      any) with its similarity score and a one-click "Merge" CTA.
- [ ] Name-similarity helper: against an LV č. 3182 fixture, the
      candidates listed in the §6a table all produce score `>= 0.8` for
      their intended shell user and `< 0.5` for any unrelated owner in
      the same community.
- [ ] All admin UI copy localised under `Owners.pending`, `Owners.claim`,
      and `Owners.pendingRegistrations` namespaces in `sk.json`, `en.json`,
      `cs.json`.

## Project Context

**Touched files**
- `src/db/schema.ts` — add `invitations.targetShellUserId`.
- `drizzle/00XX_invitation_target_shell.sql` — migration.
- `src/lib/invitations.ts` (new) — `createShellClaim`, token helpers.
- `src/lib/shell-merge.ts` (new) — `mergeShellIntoUser` transactional
  helper, FK re-point list maintained as a constant array at the top of
  the file.
- `src/lib/name-match.ts` (new) — pure name-normalisation + Jaccard
  similarity helper for the pending-registrations queue.
- `src/app/api/claim/[token]/route.ts` (new) — GET + POST.
- `src/app/[locale]/claim/[token]/page.tsx` (new) — public claim form.
- `src/app/[locale]/(dashboard)/owners/pending/page.tsx` (new) — admin
  pending shell-user list with conditional invite + always-on QR.
- `src/app/[locale]/(dashboard)/owners/pending-registrations/page.tsx`
  (new) — admin queue of bulk-QR registrants awaiting merge.
- `src/app/[locale]/(dashboard)/owners/[id]/page.tsx` — surface
  shell-claim actions when the viewed user is a shell.
- `src/lib/email.ts` — `sendClaimShellInvitation(...)` function. Sources
  strings from `messages/{locale}.json` `Email.claimShell` namespace per
  project rule.
- `messages/{sk,en,cs}.json` — new `Owners.pending`, `Owners.claim`,
  `Email.claimShell` keys.

**Reuse**
- `qrcode` (already a dependency) for QR rendering on the admin side.
- `bcrypt` for password hashing on claim.
- Existing token rotation pattern from `registrationTokens` for
  invalidating leaked tokens (operator can rotate all open invites).

## Notes

- **Why one shared `/claim/[token]` page for email + QR.** A second
  separate route would duplicate validation and translations. The token
  itself is opaque — the page doesn't care how the owner arrived at it.
- **Why merge instead of "claim by registering normally then admin
  links".** A merge with deletion of the shell preserves the membership
  rows under a stable userId — no need to maintain dual-identity rows or
  reconcile vote ownership later. The shell exists only as a placeholder
  for the import's membership weights.
- **Audit-hash preservation under merge.** `votes.auditHash` includes
  `ownerId` (the shell's UUID) in its hash input. After merge, the row's
  `ownerId` changes to the target user's UUID, so the stored hash will no
  longer verify. Either (a) re-hash on merge and store a `merged_from_id`
  reference for the chain, or (b) leave the original hash and accept the
  break. Decision deferred to implementation; lean toward (a) with a
  fresh hash + a `merged_from_user_id` column on votes that preserves the
  original shell UUID for the audit trail. Capture as an Open Question.
- **Open question — claim email send-from address and visual
  template.** The existing `src/lib/email.ts` handlers use the project's
  configured SMTP / Resend. The claim email needs a clean template (HOA
  branding optional). Defer to implementation; reuse the QR-registration
  verify email template as a starting point.
- **Open question — what happens if a shell user has already been
  claimed and someone tries to merge another account into them.** Reject
  with a clear "this user has already been claimed" error. Merge only
  works on shell rows (`email IS NULL` + `passwordHash IS NULL`).
- **Open question — should the QR dialog also show a copy-to-clipboard
  text version of the URL?** Yes for v1 (sometimes admin prefers SMS).
  Add a "Copy link" button next to the QR.
- **Bulk invite follow-up.** Once this lands and operators confirm the
  per-owner flow works, the next spec is a "send all unpaired owners an
  invite at once" action — same backend, batched UI.
