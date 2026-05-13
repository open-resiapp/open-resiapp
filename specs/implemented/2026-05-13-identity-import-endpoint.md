---
spec_id: BYT-20260513-003
title: "Identity-import endpoint for sandbox → production go-live"
status: implemented
created: 2026-05-13
updated: 2026-05-13
author: Filip
owner: Filip
last_verified: 2026-05-13
project_type: node
depends_on: []
related_handoffs: ["2026-05-13-resiapp-cloud-to-byt-app-demo-module-and-identity-import.md"]
tags: [identity, provisioning, cloud-onboarding, api, security]
feature_branch: ""
changelog_version: "2.1.1"
changelog_date: "2026-05-13"
docs_version: ""
docs_communicated: ""
---

## Goal

When a customer promotes their sandbox to production, the cloud platform spins up a fresh byt-app instance (no demo data, no demo module) and needs to transfer the customer's existing accounts + minimal org config so they don't have to re-create users or reset passwords. Provide a single-shot internal endpoint that accepts this payload and writes it atomically.

## Scope

**IN scope (v1):**
- `POST /api/internal/import-identity` (or `/api/admin/import-identity`)
- Auth: per-instance shared secret injected by cloud at provision time via env (`PLATFORM_IMPORT_TOKEN`); NOT a globally shared secret
- Single-shot: endpoint returns 409 if `users` table is non-empty (so a stolen token cannot overwrite an already-live instance)
- Payload v1:
  - `users[]` — email, name, role, bcrypt `passwordHash` (verbatim, no rehash)
  - `org_settings` — community name, address, ICO, country, voting method, governance model (mapped to `entities` + `housing_root_data`)
- Transactional: all writes succeed or none persist
- Returns counts on success

**OUT of scope (v1):**
- `branding` — defer to v2 once BYT-20260512-008 (white-label logo) lands and defines a branding table
- `custom_domain` — handled cloud-side at Caddy layer, byt-app does not need to know
- `smtp_config` — handled cloud-side via env injection, byt-app reads from env
- Business data (units, owners, votes, posts) — deliberately not transferred; cloud says the sandbox business data is discarded
- Updates / re-imports — only the initial empty-instance case
- Sync / streaming — single HTTP POST is enough

## Approach

1. Define request schema with Zod in `src/lib/validation/identity-import.ts`
2. Handler in `src/app/api/internal/import-identity/route.ts`:
   - Validate header `Authorization: Bearer <PLATFORM_IMPORT_TOKEN>` against `process.env.PLATFORM_IMPORT_TOKEN` (constant-time compare)
   - Reject if `process.env.PLATFORM_IMPORT_TOKEN` is unset (defense against misconfigured self-hosted instances)
   - Open transaction:
     - Check `users` table count === 0; abort with 409 otherwise
     - Insert community entity + `housing_root_data` row from `org_settings`
     - Insert each `users[]` row with bcrypt hash passthrough
   - Commit; return `{ inserted: { users: N, communityId } }`
3. Add the env var to `.env.example` with comment

## Acceptance Criteria

- [ ] Endpoint exists at `/api/internal/import-identity`
- [ ] Missing or wrong token → 401
- [ ] Token correct but `users` table non-empty → 409 with body explaining single-shot policy
- [ ] Token correct + empty table + valid payload → 200, users + community inserted in one transaction
- [ ] User can immediately log in with their original password (bcrypt hash preserved)
- [ ] Partial write impossible: a malformed user mid-payload rolls back the whole import
- [ ] Unset `PLATFORM_IMPORT_TOKEN` → endpoint returns 503 (self-hosted instances are not import targets)

## Notes

- Related handoff: `2026-05-13-resiapp-cloud-to-byt-app-demo-module-and-identity-import.md`
- Cloud originally proposed a shared platform token; counter-proposal accepted by user 2026-05-13: per-instance secret, injected at provision
- Single-shot guarantee is the second line of defence; per-instance secret is the first
- Business data migration (sandbox → production carrying real owners + units etc.) goes through the export/import flow (BYT-20260513-002), NOT through this endpoint
