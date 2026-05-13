---
spec_id: BYT-20260512-008
title: "Custom logo per instance (white-label)"
status: idea
created: 2026-05-12
updated: 2026-05-12
author: Filip
owner: Filip
last_verified: 2026-05-12
project_type: node
depends_on: []
related_handoffs: []
tags: [white-label, branding, theming, client-feedback]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Allow each HOA instance to upload its own logo, replacing the default ResiApp/byt-app logo across the dashboard, login, and email headers. First step toward instance-level white-labeling.

## Scope

**IN scope:**
- Settings page: upload logo (PNG/SVG, max ~500 KB, recommended ratio documented)
- Storage: file-system uploads category `branding` with admin-only upload permission
- Render: header, login page, password reset email header — read from instance branding row, fall back to default
- Remove logo (revert to default)

**OUT of scope:**
- Custom colors / full theming (separate spec)
- Per-building (vs per-instance) logos
- Favicon override (deferred — separate change)

## Approach

TBD — single-row "instance_branding" table or settings KV. Decide during impl.

## Acceptance Criteria

- [ ] Admin can upload a logo from settings
- [ ] Header + login show uploaded logo within one request (no cache flicker)
- [ ] Default logo restored after delete
- [ ] Permission gate: only admin can upload/delete
- [ ] Email header (password reset + invitation) shows the uploaded logo

## Notes

- Client meeting 2026-05-12: "Logo pre own appku"
- Open question: SVG accepted? Risk of inline-svg XSS — sanitize or restrict to PNG/JPEG
- Default fallback path must be deterministic so an unbranded instance still looks polished
