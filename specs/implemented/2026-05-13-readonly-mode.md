---
spec_id: BYT-20260513-004
title: "Read-only mode at trial expiry (`IS_READONLY` middleware + banner)"
status: implemented
created: 2026-05-13
updated: 2026-05-13
author: Filip
owner: Filip
last_verified: 2026-05-13
project_type: node
depends_on: []
related_handoffs: ["2026-05-13-resiapp-cloud-to-byt-app-demo-module-and-identity-import.md"]
tags: [middleware, cloud-onboarding, trial-expiry, security]
feature_branch: ""
changelog_version: "2.1.1"
changelog_date: "2026-05-13"
docs_version: "2.1.1"
docs_communicated: "2026-05-13"
---

## Goal

When a sandbox trial expires, cloud needs to soft-lock the instance for a 7-day grace period: the customer can still log in and review their data, but cannot create / update / delete anything. After the grace period the instance is destroyed.

Implementation: a runtime-readable `IS_READONLY=true` env flag + a middleware guard that blocks non-GET/HEAD methods on `/api/**` except for an explicit auth allowlist + a banner explaining the state to the user.

## Scope

**IN scope:**
- Runtime read of `process.env.IS_READONLY` on every request (no module-load caching)
- Block non-`GET`/non-`HEAD` requests to `/api/**` with HTTP 423 (Locked) and a JSON body `{ error: "read_only", message: "..." }`
- Allowlist for paths that MUST stay writable during read-only:
  - `/api/auth/**` (NextAuth sign-in is POST)
  - `/api/internal/import-identity` (cloud may still need to push fixes, debatable — decide during impl)
  - `/api/health` (no body, GET only anyway)
- UI banner on every dashboard page: i18n key `Readonly.banner` (Slovak default: "Skúšobné obdobie skončilo — aplikácia je v režime iba na čítanie.")
- Server actions: respect read-only too (they bypass the middleware). Centralise via a `assertWritable()` helper called at the top of each mutating action — OR apply at the DB driver level so accidental mutations are impossible
- Reads (GET) work normally; login works; viewing votes / posts / owners works

**OUT of scope:**
- Time-based auto-exit (cloud manages expiry externally; this spec only implements the toggle)
- Granular per-feature read-only (all-or-nothing)
- Visual styling work beyond a banner component reused from existing UI primitives

## Approach

1. Extend `src/middleware.ts` (or wherever the locale + auth middleware composes) with a check:
   ```ts
   if (process.env.IS_READONLY === "true"
       && req.nextUrl.pathname.startsWith("/api/")
       && !isAllowlisted(req.nextUrl.pathname)
       && !["GET", "HEAD"].includes(req.method)) {
     return NextResponse.json({ error: "read_only", ... }, { status: 423 });
   }
   ```
2. Define allowlist as an exported `READONLY_ALLOWLIST` array in `src/lib/middleware/readonly.ts` for testability
3. Server actions: add `assertWritable()` to `src/lib/auth/guards.ts` (or sibling) that throws if `IS_READONLY === "true"`. Call at the top of every mutating server action. Audit existing actions in a follow-up.
4. Banner: add `<ReadonlyBanner />` to the dashboard layout `src/app/[locale]/(dashboard)/layout.tsx`, gated on a server-component check of `process.env.IS_READONLY === "true"`
5. i18n: add `Readonly.banner` keys to `sk.json` + `en.json` + `cs.json`

## Acceptance Criteria

- [ ] With `IS_READONLY=true`: any POST/PUT/PATCH/DELETE to `/api/**` returns 423
- [ ] With `IS_READONLY=true`: sign-in still works (POST `/api/auth/**`)
- [ ] With `IS_READONLY=true`: GET endpoints behave normally (dashboard, voting list, etc. all load)
- [ ] With `IS_READONLY=true`: banner appears on every dashboard page
- [ ] Server actions that mutate data refuse to run (throw or no-op with toast)
- [ ] Without the env flag: zero behavior change (verified by existing test suite)
- [ ] Flipping `IS_READONLY` after instance is already running (via task restart) takes effect on first request

## Notes

- Related handoff: `2026-05-13-resiapp-cloud-to-byt-app-demo-module-and-identity-import.md`
- 423 (Locked) is more semantically correct than 403 (Forbidden) — surfaces "this is a state, not a permission" to clients
- Server-action coverage is the tricky part: middleware doesn't see them. Plan to land in two phases: (1) middleware + banner, (2) audit + protect all server actions. Cloud can ship phase 1 first and rely on UI hiding mutate buttons in the meantime
- Open question: should the banner include a "Promote to production" CTA linking back to the cloud platform? Likely yes — but URL depends on cloud routing and may need a new env var
