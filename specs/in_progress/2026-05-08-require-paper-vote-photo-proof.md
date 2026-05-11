---
spec_id: BYT-20260508-004
title: "Require photo proof when recording paper vote on behalf of owner"
status: in_progress
created: 2026-05-08
updated: 2026-05-11
author: byt-app
owner: byt-app
last_verified: 2026-05-08
project_type: node
depends_on: []
related_handoffs: []
tags: [voting, paper-vote, audit, bug-fix, compliance]
feature_branch: feature/require-paper-vote-photo
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Paper votes (`voteType="paper"`) recorded on behalf of another owner via `PaperVoteModal` must carry a photo of the signed paper ballot. Today, server, DB, and client all accept submissions without a photo — verified manually 2026-05-08, admin recorded a paper vote without uploading a photo and the vote was stored. This breaks the audit trail required by the Slovak electronic-voting law (and the Czech rules layered on top), where a paper ballot recorded electronically must be reproducible from stored evidence.

## Scope

**In scope:**
- Server-side validation in `POST /api/votes` (insert path AND existing-vote update path) rejecting paper votes without `paperPhotoUrl`.
- DB CHECK constraint enforcing `vote_type != 'paper' OR paper_photo_url IS NOT NULL` (defence in depth — UI/server bugs cannot bypass).
- Client guard in `PaperVoteModal`: submit button disabled until `photoFile` selected; submit function bails early if missing.
- Localized error message in all three locales currently shipped: `sk`, `en`, `cs` (verified against `messages/`).
- Drizzle migration adding the constraint.

**Out of scope:**
- Photo content validation (OCR, image-quality checks, signature recognition).
- Backfilling `paperPhotoUrl` on already-stored paper votes that lack a photo. They remain as-is; the CHECK constraint must be written so it does not retroactively break existing rows (see Approach).
- Mandate-based proxy voting (`mod_voting_mandates` table) — different flow, different evidence model (`paperDocumentConfirmed`).
- Photo size / MIME / virus scanning at upload time — `/api/uploads` is unchanged.

## Approach

### 1. Server validation (`modules/voting/src/routes/api/votes/index.ts`)

Add immediately after the body destructure (around line 201) and before the permission check:

```ts
const isPaperVote = voteType === "paper";
if (isPaperVote && !paperPhotoUrl) {
  return NextResponse.json(
    { error: "PAPER_PHOTO_REQUIRED" }, // resolved client-side via i18n
    { status: 400 }
  );
}
```

The same check covers the update branch (line ~340) because we early-return before reaching insert OR update. No second check needed.

The error payload returns a stable code (`PAPER_PHOTO_REQUIRED`) rather than a Slovak literal — the route already returns Slovak literals elsewhere (tech debt), but new errors should be machine-readable so the client renders them via `useTranslations`.

### 2. DB CHECK constraint (`modules/voting/src/db/schema.ts` + migration)

Drizzle table definition gets a `CHECK` clause:

```ts
{
  votingEntityIdx: uniqueIndex(...),
  paperPhotoRequired: check(
    "mod_voting_votes_paper_photo_required",
    sql`vote_type != 'paper' OR paper_photo_url IS NOT NULL`
  ),
}
```

Generated migration must add the constraint with `NOT VALID` first and then `VALIDATE` it conditionally:

```sql
ALTER TABLE mod_voting_votes
  ADD CONSTRAINT mod_voting_votes_paper_photo_required
  CHECK (vote_type != 'paper' OR paper_photo_url IS NOT NULL) NOT VALID;
```

Skip the `VALIDATE` step in the migration. New writes are checked; pre-existing NULL rows survive. This avoids a noisy migration failure on installs with legacy paper votes recorded before this fix.

### 3. Client guard (`src/components/voting/PaperVoteModal.tsx`)

- Line 110 submit guard: `if (!selectedOwner || !selectedChoice || !selectedFlat || !photoFile) return;`
- Line 299 disabled prop: append `|| !photoFile`.
- Photo `<input>` (line 264) gets `required` attribute as a third layer (browser-native).
- Error response handler (line 152) must map `PAPER_PHOTO_REQUIRED` → `t("photoRequired")`.

### 4. i18n keys

Add to `PaperVote` namespace in `messages/sk.json`, `messages/en.json`, `messages/cs.json`:

- `photoRequired` — error shown when server returns `PAPER_PHOTO_REQUIRED` or client guard fires
- Update existing `photoLabel` to indicate required (asterisk or "(povinné)")

## Acceptance Criteria

- [ ] `POST /api/votes` with `voteType="paper"` and missing or empty `paperPhotoUrl` returns HTTP 400 with `{ error: "PAPER_PHOTO_REQUIRED" }`.
- [ ] Same request on the update branch (changing the choice of an existing paper vote without supplying a new photo) is also rejected with 400.
- [ ] Direct DB insert of a row with `vote_type='paper'` and `paper_photo_url IS NULL` fails with the CHECK constraint.
- [ ] Direct DB update setting `paper_photo_url = NULL` on a paper vote fails with the CHECK constraint.
- [ ] `PaperVoteModal` submit button stays disabled until a photo file is picked.
- [ ] Submitting via the modal without a photo (e.g. via devtools removing the disabled attr) shows the localized `photoRequired` error.
- [ ] All three locale files (`sk`, `en`, `cs`) contain `PaperVote.photoRequired`.
- [ ] Existing electronic votes (`vote_type='electronic'`) are unaffected — can be inserted/updated with or without `paper_photo_url`.
- [ ] Migration runs cleanly on a DB that contains legacy paper votes with `paper_photo_url IS NULL` — those rows are not deleted, the constraint is added as `NOT VALID`.

## Project Context

**Affected files:**

| File | Role |
|------|------|
| `modules/voting/src/routes/api/votes/index.ts` | POST handler — add validation |
| `modules/voting/src/db/schema.ts` | Add CHECK on `votes` table |
| `drizzle/migrations/{NNNN}_paper_vote_photo_required.sql` | New migration |
| `src/components/voting/PaperVoteModal.tsx` | Submit guard + disabled-state |
| `messages/sk.json` | `PaperVote.photoRequired` (sk) |
| `messages/en.json` | `PaperVote.photoRequired` (en) |
| `messages/cs.json` | `PaperVote.photoRequired` (cs) |

**Permission already enforced:** `recordPaperVote` (votes/index.ts:214). This spec does not change who can record paper votes — only what evidence they must attach.

**Audit hash unchanged:** `generateAuditHash(votingId, voterId, flatId, choice, now)` does not include the photo URL. Out of scope to change — the audit hash is a non-repudiation token, the photo is the human-readable evidence.

## Notes

- Decision 2026-05-08: legacy paper votes lacking a photo are NOT backfilled or deleted by this spec. If/when board signs off on a cleanup pass, file as a separate spec referencing this one.
- Stable error code (`PAPER_PHOTO_REQUIRED`) is a deliberate departure from the surrounding pattern of Slovak literal errors. Existing literals are tech debt; this is the new convention going forward. Do not refactor surrounding errors as part of this spike — out of scope.
- Open question: should the photo also be required on the update branch when the choice is unchanged? Current code returns 200 idempotently if `existing.choice === choice` (line 330) — the photo never gets attached in that path. Acceptable: idempotent re-submit of an already-recorded vote should not need the photo again. The CHECK constraint guarantees the original insert had one.
