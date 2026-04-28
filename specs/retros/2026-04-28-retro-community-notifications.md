---
retro_for: RES-20260417-006
spec_title: "Community email notifications + auto-expiration"
created: 2026-04-28
status: partial
---

## Discrepancies

### 1. Throttle semantics inconsistent within the spec
- **Category:** spec_misunderstood
- **Spec said:** Scope (line 42): "max 1 notifikácia per (author, post) per hodinu". Acceptance (line 124): "max 1 email per 60 min pre rovnakú dvojicu (post, responder)".
- **Implementation did:** Followed Acceptance Criteria — throttle keyed on `(post, recipient, responder)`.
- **Why:** Spec was written across two sittings; Scope was intent ("don't spam author"), Acceptance Criteria refined it to per-responder. The two were never reconciled.

### 2. Throttle storage — three alternatives, no commitment
- **Category:** better_approach
- **Spec said:** "tabuľka `notification_throttle` alebo Redis... alebo inline kontrola v `sent_emails` (ak existuje)".
- **Implementation did:** Created a single `community_notifications_sent` table with a `kind` enum that doubles as throttle (response) and one-shot dedupe (expiry/event reminders).
- **Why:** None of the suggested options existed in the codebase, and a unified table covered both throttle and reminder dedupe with one index pattern — fewer moving parts than three separate stores.

### 3. Reminder dedupe not specified
- **Category:** spec_incomplete
- **Spec said:** Cron sends expiry reminder 3 days before `expiresAt` and event reminder 1 day before `eventDate`. No mention of preventing duplicate sends across daily cron runs.
- **Implementation did:** Added `kind`-based existence check in `community_notifications_sent` before each reminder send; tracking row inserted on dispatch.
- **Why:** The 3-day window means two consecutive cron runs would both qualify the same post if dedupe were absent. The omission would have shipped duplicate emails on day 1.

### 4. Debug endpoint persistence not specified
- **Category:** spec_incomplete
- **Spec said:** "Debug endpoint... posledný beh, counts, errors".
- **Implementation did:** In-memory snapshot via `src/lib/cron-state.ts`; resets on Node restart.
- **Why:** Daily batch + immediate review is enough for now. Persistence across restarts would require a `cron_runs` table — out of scope for this spike, but the spec should have stated the trade-off.

### 5. Next.js route handler export constraint
- **Category:** spec_incomplete
- **Spec said:** Nothing about where to keep the cron-run snapshot.
- **Implementation did:** Initially exported `getLastCronRun` from `route.ts`, hit the App Router rule that forbids non-handler exports, then split state into `src/lib/cron-state.ts`.
- **Why:** Generic Next.js project constraint not in CLAUDE.md or spec — easy to trip on once per project.

### 6. i18n missing for new emails (resolved during retro)
- **Category:** spec_overspecified
- **Spec said:** Acceptance: "Email copy v slovenčine (primárne) + en fallback".
- **Implementation did:** First pass shipped SK-hardcoded HTML matching the existing `sendPasswordReset` pattern; the "en fallback" checkbox was ticked optimistically. User pushed back during retro; emails were refactored to use `next-intl getTranslations({ locale })` with `Email` namespace in `sk.json`/`en.json`/`cs.json` and a `locale?: string` param.
- **Why:** Default to "match existing pattern" was wrong here — existing emails are pre-existing debt, not the standard to copy. Spec should have called out the i18n requirement explicitly instead of relying on a generic acceptance line.

## Findings

### 1. Specs must keep one source of truth for rate-limit / throttle semantics
- **Target:** spec_skill
- **From discrepancy:** #1
- **Recommendation:** `/spec-new` template should not duplicate throttle/quota numbers across Scope and Acceptance Criteria. Either centralize in Approach with a single canonical line, or have Acceptance Criteria reference Scope by ID. Add a self-check at promote time: if numbers appear in two sections, they must match verbatim.
- **Applied:** no

### 2. Specs that list alternatives must commit before in_progress
- **Target:** spec_skill
- **From discrepancy:** #2
- **Recommendation:** When a spec section reads "X or Y or Z", `/spec-promote` to `in_progress` should require the author to pick one and update the spec — or explicitly tag the choice as "Implementer's call" in Notes. No silent ambiguity carried into implementation.
- **Applied:** no

### 3. Notification specs must address idempotency in Approach
- **Target:** spec_skill
- **From discrepancy:** #3
- **Recommendation:** Spec template for any feature that sends emails / pushes / messages from a scheduled job must include a mandatory "Idempotency / dedupe" line in Approach. CLAUDE.md spec rule: scheduled-send features without an explicit dedupe strategy fail review.
- **Applied:** no

### 4. Debug/observability endpoints must declare data lifetime
- **Target:** spec_skill
- **From discrepancy:** #4
- **Recommendation:** When a spec proposes a debug/health endpoint, it must state whether the data is in-memory, on-disk, or in DB — and what happens on process restart. Default if unstated: assume persistent. Surface this as a checklist item in `/spec-new`.
- **Applied:** no

### 5. Stateful exports belong in `lib/`, never in `route.ts`
- **Target:** claude_md
- **From discrepancy:** #5
- **Recommendation:** Add to project CLAUDE.md (Next.js section): "Route handler files (`app/**/route.ts`) may export only HTTP method handlers and Next.js-recognized config (`runtime`, `dynamic`, etc.). Module-level state (in-memory caches, last-run snapshots, singletons) belongs in `src/lib/*` and is imported by the route. Exporting anything else triggers a build-time type error."
- **Applied:** yes (CLAUDE.md → new `### Route handlers` subsection, 2026-04-28)

### 6. New email functions must use next-intl from day one
- **Target:** claude_md
- **From discrepancy:** #6
- **Recommendation:** Add to project CLAUDE.md (i18n rules): "Any new email-sending function in `src/lib/email.ts` must source copy via `getTranslations({ locale })` against the `Email` namespace in `messages/{locale}.json`, and accept an optional `locale?: string` parameter (defaulting to `routing.defaultLocale`). Pre-existing SK-hardcoded emails (`sendPasswordReset`, `sendPairingInvitation`, `sendVoteConfirmation`) are tech debt and may not be used as a template for new code."
- **Applied:** yes (CLAUDE.md → `### i18n`, 2026-04-28)

### 7. Prefer one notification-tracking table with a `kind` enum
- **Target:** claude_md
- **From discrepancy:** #2, #3
- **Recommendation:** Add to project CLAUDE.md (Database section): "When introducing per-(post, recipient) email tracking — throttle, dedupe, suppression — extend a single `*_notifications_sent` table with a `kind` enum rather than creating a purpose-specific table per email type. One index pattern, one mental model."
- **Applied:** yes (CLAUDE.md → `### Database`, 2026-04-28)
