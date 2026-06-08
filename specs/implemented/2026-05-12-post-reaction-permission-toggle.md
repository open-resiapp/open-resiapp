---
spec_id: BYT-20260512-007
title: "Per-post toggle for reactions / responses"
status: implemented
created: 2026-05-12
updated: 2026-06-08
author: Filip
owner: Filip
last_verified: 2026-06-08
project_type: node
depends_on: []
related_handoffs: []
tags: [community, posts, permissions, client-feedback]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Community posts currently allow responses globally. Some authors want to publish announcements where comments / reactions are disabled on that specific post (e.g. "AGM scheduled for 2026-06-01" — informational, no discussion).

Add a per-post boolean controlling whether responses are accepted.

## Scope

**IN scope:**
- Schema: add `responses_allowed boolean NOT NULL DEFAULT true` to community posts table
- Post create / edit form: toggle to allow/disallow responses
- API: reject `POST /api/community/posts/[id]/respond` with 403 when toggle is off
- UI: hide response form + show "Komentáre vypnuté" notice when toggle is off
- Existing responses remain visible (no retroactive deletion)

**OUT of scope:**
- Per-user permission overrides (admin can always respond regardless of toggle? → decide during impl)
- Time-bound disable (auto-reopen after N days)

## Approach

TBD — follow patterns in `modules/community/` (see community-foundation spec).

## Acceptance Criteria

- [x] Post author can toggle "Povoliť reakcie" at create + edit time
- [x] Toggle persists to DB
- [x] When off: response API returns 403; UI hides form with i18n notice
- [x] When off and post has prior responses: those remain visible
- [x] Admin can still moderate (delete) responses regardless of toggle

## Notes

- Client meeting 2026-05-12: "Reakcie na posty s povolením alebo nie konkretne na post"
- Decide whether toggle is opt-in (default allow) or per-post-type (announcements default off, marketplace default on)

### 2026-06-08 — implemented
Decisions taken during impl:
- **Default = allow** (`responses_allowed boolean NOT NULL DEFAULT true`). Not per-post-type — single global default keeps the model simple and is backward-compatible (every existing post stays open).
- **Edit affordance**: the app has no post-body edit form (PATCH previously only accepted `status:resolved`). Rather than build one, extended `PATCH /api/community/posts/[id]` to also accept `{ responsesAllowed: boolean }` (author/admin) and added an inline "Povoliť/Vypnúť reakcie" toggle button to `PostCard`'s manage row. This doubles as the "lock an existing thread" power, which is the real value.
- **Admin does NOT bypass the toggle to respond.** The toggle is the author's intent; admins can still flip it back on, and can always delete responses. The `respond` POST returns 403 for everyone (incl. admin) when off.

Touched:
- `src/db/schema.ts` — `responsesAllowed` column → migration `drizzle/0037_volatile_wong.sql`.
- `src/app/api/community/posts/route.ts` — create reads `responsesAllowed`; list GET returns it.
- `src/app/api/community/posts/[id]/route.ts` — single GET returns it; PATCH accepts the toggle.
- `src/app/api/community/posts/[id]/respond/route.ts` — 403 when off.
- `src/components/community/PostForm.tsx` — create-time checkbox.
- `src/components/community/PostCard.tsx` — manage-row toggle button.
- `komunita/{pomoc,burza,udalosti}/page.tsx` — gate respond button + "Reakcie sú vypnuté" notice + toggle handler.
- `komunita/{pomoc,burza,udalosti}/{novy,nova}/page.tsx` — value-type threading.
- `messages/{sk,en}.json` — `Community.form.responsesAllowed`, `Community.responsesDisabled`, `Community.enableResponses`, `Community.disableResponses`.
