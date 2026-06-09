---
spec_id: RES-20260609-001
title: "Guided onboarding wizard + dismissable dashboard banner; move Import under Settings"
status: spec
created: 2026-06-09
updated: 2026-06-09
author: Filip
owner: Filip
last_verified: 2026-06-09
project_type: node
depends_on: []
related_handoffs: []
tags: [onboarding, dashboard, import, navigation, admin]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

The Import feature is a dedicated sidebar item (`Sidebar.tsx` navItems, `manageSettings`-gated) even though bootstrapping community data is a once-per-lifetime action. A permanent top-level nav slot for a one-time task is clutter, and there is no guided first-run experience — a new chairman lands on an empty dashboard with no direction.

Replace the standalone Import nav item with a **dismissable dashboard onboarding banner** that nudges the admin/chairman toward a **guided `/onboarding` wizard**, and relocate Import (for the occasional re-import / append case) under Settings. The banner must be non-intrusive: closing it (X) keeps it gone, and it auto-vanishes once the community is set up. Onboarding state is **derived from data** + dismissal stored in **localStorage** — no schema migration.

## Scope

**IN scope:**
- New `OnboardingBanner` component mounted in `src/app/[locale]/(dashboard)/layout.tsx`, admin-only (`manageSettings`).
- Banner shows only when: user has `manageSettings` **AND** community not yet set up **AND** not dismissed. Close (X) = permanent dismiss via localStorage.
- New `/onboarding` guided wizard route under `(dashboard)` that sequences existing setup surfaces and derives the current/next step from data (resumable, no stored state).
- Remove the `import` entry from `Sidebar.tsx` navItems.
- Add an Import entry **and** a "Setup guide / resume onboarding" link to the Settings page. Import route stays `/admin/import` (no move, no redirect).
- Extend `GET /api/building` with a units/owners count (or a `setupComplete` signal) used as the empty-signal by both banner and wizard.
- New i18n keys in `messages/sk.json` (default) + `messages/en.json`.

**OUT of scope:**
- No DB migration — no new tables/columns. Completion derived from data; dismissal in localStorage.
- Not rebuilding the import wizard internals — the onboarding "import" step links into the existing import flow.
- No change to owner / non-admin UX beyond the banner not rendering for them.
- Email / push notification system untouched.
- Cross-device dismissal durability (see Notes for the DB-flag upgrade path).

## Approach

Written from this project's perspective only.

**Banner (`OnboardingBanner.tsx`).** Model on two existing patterns:
- `src/components/InstallPrompt.tsx` — localStorage dismissal with try/catch for private-mode safety. Use a permanent dismiss key (not the 30-day snooze) since the user wants it gone for good once closed.
- `src/components/admin/ShareSumInvariantBanner.tsx` — data-driven banner that renders nothing when there's no condition, already mounted in the dashboard layout.

Mount in `src/app/[locale]/(dashboard)/layout.tsx` (~line 71, above `ShareSumInvariantBanner`). Render gating order: `manageSettings` permission → community-not-set-up (from `/api/building`) → not dismissed (localStorage).

**Empty-signal.** Extend `GET /api/building` (`src/app/api/building/route.ts`) to return a units (and owners) count, or a derived `setupComplete` boolean plus per-step flags. Both the banner ("show?") and the wizard ("which step is done?") consume this single signal — one source of truth.

**Wizard (`/onboarding`).** New route under `(dashboard)`, gated to `manageSettings` (redirect / no-access for owners). Renders an ordered step list, each step a link to its existing surface with a done-checkmark driven by that step's data condition:
1. Community details (name/address/IČO/country/voting method) — import wizard's Community panel
2. Import owners & units → existing `/admin/import`
3. Invite / pair owners
4. Enable modules (voting, etc.)
5. First post / done

Step "done" is **derived** (community has name? units > 0? any paired owner? modules enabled? any post?), so the wizard is resumable for free with no persisted progress.

**Settings.** Add an Import card/link (route unchanged) + a "Setup guide" link to `/onboarding`, so dismissing the banner never strands the chairman.

**FOUC / flicker (per CLAUDE.md cross-cutting rule).** The banner is client-rendered and gated on a client fetch + localStorage, which are server-invisible. To avoid a flash of an unwanted banner on populated/dismissed communities: the banner **starts hidden and only reveals once all three conditions are confirmed true** (permission known, `/api/building` resolved as not-set-up, localStorage read as not-dismissed). Default-hidden → reveal-if-needed means the worst case is a slightly late *appearance*, never a flash of the *wrong* state. Document the localStorage per-device limitation and the DB-flag upgrade path in Notes.

## Acceptance Criteria

- [ ] `import` no longer appears in the sidebar (removed from `Sidebar.tsx` navItems).
- [ ] Import is reachable from the Settings page; route `/admin/import` still works (no broken bookmark).
- [ ] Settings page has a "Setup guide / resume onboarding" link to `/onboarding`.
- [ ] Dashboard banner renders **only** when: user has `manageSettings` AND community has no units AND not dismissed.
- [ ] Banner close (X) dismisses permanently — persists across reloads (localStorage), does not reappear in the same browser.
- [ ] Banner does **not** flash for already-set-up or dismissed communities (starts hidden, reveals only when confirmed needed).
- [ ] Banner CTA opens `/onboarding`.
- [ ] `/onboarding` shows ordered steps; each step is marked done when its data condition is met (derived, not stored).
- [ ] `/onboarding` is resumable — a reload reflects the current real state from data.
- [ ] A non-admin (owner) never sees the banner; visiting `/onboarding` directly is gated (redirect / no-access).
- [ ] `GET /api/building` returns the units/owners count (or `setupComplete` signal) consumed by banner + wizard.
- [ ] All new strings live in `messages/sk.json` + `messages/en.json` (no hardcoded UI text).
- [ ] No DB migration is introduced by this spec.

## Project Context

Next.js App Router + next-intl. Key touchpoints:
- Banner mount: `src/app/[locale]/(dashboard)/layout.tsx` (~line 71)
- Patterns to copy: `src/components/InstallPrompt.tsx` (localStorage dismiss), `src/components/admin/ShareSumInvariantBanner.tsx` (data-driven + layout mount)
- Nav: `src/components/layout/Sidebar.tsx` (remove `import` navItem, currently ~line 27)
- Empty-signal: `src/app/api/building/route.ts`
- Import route (unchanged): `src/app/[locale]/(dashboard)/admin/import/page.tsx`
- Settings page: `src/app/[locale]/(dashboard)/settings/` (add Import + setup-guide links)
- Permissions: `hasPermission(role, "manageSettings")` from `src/lib/permissions.ts`
- i18n: `messages/sk.json` (default), `messages/en.json` — likely `Sidebar`, `Settings`, new `Onboarding` namespaces

## Notes

- **Prefix drift:** the spec corpus mixes `RES` and `BYT` prefixes (e.g. `BYT-20260512-007`); `RES` chosen for this spec per the user. Worth converging on one prefix project-wide later.
- **Dismissal storage:** localStorage chosen (no migration, matches `InstallPrompt`). Trade-off — per-device only, clears with browser data. Upgrade path if cross-device durability is wanted: a per-user/community DB flag (small migration), with the banner painted server-side to also kill the flicker entirely.
- **Gating role:** `manageSettings` (matches the removed Import item). Revisit if chairman/predseda is a distinct role that should be narrower than all `manageSettings` holders.
- **"Setup complete" definition:** decide which steps gate banner-vanish. Minimal = units exist. Open question: does invite-owners (or any other step) count toward completion, or is the banner purely units-driven while the wizard tracks the rest?
- **Per-step done conditions** need concrete data signals enumerated at implementation time (community name set? units > 0? ≥1 paired owner? ≥1 module enabled? ≥1 post?).
