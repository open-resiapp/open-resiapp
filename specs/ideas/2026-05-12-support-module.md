---
spec_id: BYT-20260512-005
title: "In-app support / help desk"
status: idea
created: 2026-05-12
updated: 2026-05-12
author: Filip
owner: Filip
last_verified: 2026-05-12
project_type: node
depends_on: []
related_handoffs: []
tags: [support, help-desk, client-feedback]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Provide an in-app channel for HOA users to contact support (the operating company or platform team). Today there is no surfaced way to ask for help; client meeting flagged this as a gap.

## Scope

**IN scope:**
- Decide: ticket form (DB-backed) vs. mailto link vs. external help-desk integration
- UI entry point (header, footer, settings page?)
- Routing: who receives the message (admin of community? platform support? both?)
- Notification on new ticket

**OUT of scope:**
- Full ticketing workflow (assignment, SLA, internal notes) unless trivially small
- Knowledge base / FAQ (separate spec)

## Approach

TBD.

## Acceptance Criteria

- [ ] Logged-in user can reach a "Need help?" surface from any dashboard page
- [ ] Submission lands somewhere reliable (DB row + email notification, minimum)
- [ ] Submitter receives confirmation (email or in-app toast)

## Notes

- Client meeting 2026-05-12: "Support"
- Open question: is this byt-app feature (per-instance support) or open-resiapp-cloud feature (cross-tenant support)? Probably both layers; start with in-app entry that routes to platform email
