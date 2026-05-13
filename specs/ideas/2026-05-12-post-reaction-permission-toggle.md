---
spec_id: BYT-20260512-007
title: "Per-post toggle for reactions / responses"
status: idea
created: 2026-05-12
updated: 2026-05-12
author: Filip
owner: Filip
last_verified: 2026-05-12
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

- [ ] Post author can toggle "Povoliť reakcie" at create + edit time
- [ ] Toggle persists to DB
- [ ] When off: response API returns 403; UI hides form with i18n notice
- [ ] When off and post has prior responses: those remain visible
- [ ] Admin can still moderate (delete) responses regardless of toggle

## Notes

- Client meeting 2026-05-12: "Reakcie na posty s povolením alebo nie konkretne na post"
- Decide whether toggle is opt-in (default allow) or per-post-type (announcements default off, marketplace default on)
