---
spec_id: BYT-20260609-003
title: "Accessibility — WCAG 2.1 AA audit & remediation"
status: spec
created: 2026-06-09
updated: 2026-06-09
author: byt-app
owner: filipvnencak
last_verified: 2026-06-09
project_type: other
depends_on:
  - RES-20260417-001   # community surfaces
  - RES-20260506-002   # dark-mode toggle (theme pre-paint precedent, contrast tokens)
related_handoffs: []
tags:
  - accessibility
  - wcag
  - a11y
  - cross-cutting
  - nlnet-grant
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Bring the **entire** open-resiapp web app to **WCAG 2.1 level AA** conformance and
keep it there with an automated gate. This is NLnet grant task **T4** (60 h):
audit + remediation of keyboard navigation, screen-reader semantics, colour
contrast, and focus management. The user base skews 50–75, often on a borrowed
phone, frequently registering in person at an owners' meeting — accessibility is
not polish here, it is whether a senior can cast a binding vote at all. The grant's
"including seniors" challenge is the product requirement this spec discharges.

### Problem statement

The app has good foundations (16px base font, `color-scheme` set on `<html>`, a
deliberate mono palette) but no accessibility programme: no skip link, no
app-wide focus-visible styling, no `prefers-reduced-motion` handling, no
screen-reader audit, and no automated a11y check in lint or CI. The mono palette
remap (`globals.css`) introduced status colours (`green-500 #4f8568`,
`red-500 #b03838`) and muted greys (`gray-400 #a8a8a8`, `gray-500 #7a7a7a`) whose
text contrast is unverified and, for the lighter greys, almost certainly below the
4.5:1 AA threshold for normal text. Without a gate, every new feature re-introduces
regressions.

## Scope

Per CLAUDE.md's cross-cutting rule, this spec is **not** bounded to a "key
surfaces" list. It commits to **full-app coverage**: every route in the inventory
below, every shared component, and every transient surface (modals, toasts,
dropdowns, form-error states) is audited. Any surface not fully remediated inside
the 60 h spike gets an **explicit follow-up ticket — one per surface** — that ships
alongside this spec, so there is no silent long tail of "still inaccessible" routes.

**In scope**
- WCAG 2.1 **A + AA** success criteria across the whole app (the SC list in
  Approach is the working checklist).
- The full route inventory (Project Context) — all `(auth)` and `(dashboard)`
  routes, including dynamic `[id]`/`[token]` states.
- Shared component library (`src/components/**`, incl. establishing accessible
  primitives in the currently-empty `src/components/ui/`).
- Transient/interactive surfaces: dialogs, toasts/notifications, dropdowns,
  language switcher, theme toggle, tab sets, the per-state choice buttons
  (RSVP / vote / status filters) called out in CLAUDE.md UI patterns.
- Colour-contrast audit + remediation of the mono palette tokens.
- Keyboard operability, visible focus, focus management/trapping in overlays.
- Screen-reader semantics (landmarks, headings, labels, `aria-*`, live regions).
- `prefers-reduced-motion` support.
- An **automated a11y gate** (lint rule + axe route sweep) wired so regressions
  fail before merge.
- i18n: any new a11y strings (skip link, aria-labels that are visible text, error
  summaries) in `sk.json` / `cs.json` / `en.json`.

**Out of scope**
- WCAG 2.1 **AAA** criteria.
- WCAG 2.2 new SC (target-size 2.5.8, focus-not-obscured 2.4.11/2.4.12, etc.) —
  noted as a fast-follow; we deliberately target 2.1 AA to match the grant text.
- Native mobile app (none exists).
- Generated-PDF accessibility (voting `zápisnica`, audit bundle) — tagged-PDF/PDF-UA
  is a separate effort; flagged in Notes.
- Email-template accessibility — separate, low-risk surface.
- Automated *remediation* (tools audit; humans fix).

## Approach

### Conformance target & working SC checklist

WCAG 2.1 A + AA. The criteria that historically carry the defects in a React/Next
form-heavy app, used as the per-surface checklist:

- **Perceivable:** 1.1.1 non-text alt; 1.3.1 info & relationships (semantic
  structure, labels, table headers); 1.3.5 input purpose (`autocomplete`);
  1.4.3 contrast (text 4.5:1, large 3:1); 1.4.4 resize text to 200%; 1.4.10 reflow
  (320 CSS px, no 2-D scroll); 1.4.11 non-text contrast (UI/state 3:1);
  1.4.12 text spacing; 1.4.13 content on hover/focus.
- **Operable:** 2.1.1 keyboard; 2.1.2 no keyboard trap; 2.4.1 bypass blocks (skip
  link); 2.4.2 page titled; 2.4.3 focus order; 2.4.6 headings & labels;
  2.4.7 focus visible; 2.5.3 label in name.
- **Understandable:** 3.1.1/3.1.2 language of page/parts (`lang`/`hreflang` — already
  via next-intl, verify on dynamic content); 3.2.x predictable; 3.3.1 error
  identification; 3.3.2 labels/instructions; 3.3.3 error suggestion; 3.3.4 error
  prevention (legal/financial — relevant to voting & registration).
- **Robust:** 4.1.2 name/role/value (custom widgets); 4.1.3 status messages (live
  regions for toasts/async results).

### Audit methodology — full inventory, three passes

1. **Automated sweep (every route + key states).** A route-driven scan over the
   *entire* inventory (logged-in admin + owner fixtures, plus auth routes
   unauthenticated). Catches contrast, missing labels/alt, ARIA misuse, landmark
   gaps. Tooling decision in "Tooling & gate" below.
2. **Manual keyboard pass.** Tab/Shift-Tab/Enter/Space/Esc/arrow through every
   route and every interactive surface: no trap, logical order, visible focus,
   overlays trap+restore focus, all mouse-only actions reachable.
3. **Manual screen-reader pass.** VoiceOver (Safari/macOS + iOS — the senior
   borrowed-phone case) and NVDA (Firefox). Verify landmarks, heading outline,
   form label association, error announcement, dynamic status announcement, and
   that vote/RSVP per-state buttons announce their state.

Findings are logged per (surface × SC) into a tracking sheet; each becomes either
an in-spike fix or a per-surface backlog ticket.

### Remediation workstreams

- **Structure & landmarks:** one `<main>` per page, `<nav>`, `<header>`, correct
  heading hierarchy (single h1, no skipped levels), `<ul>`/`<table>` semantics for
  lists/tables (owners, voting results, documents).
- **Skip link & bypass:** a visually-hidden, focus-revealed "Preskočiť na obsah"
  skip link in the dashboard + auth layouts targeting `#main` (2.4.1).
- **Keyboard & focus:** app-wide `:focus-visible` outline in `globals.css` (works
  in both themes, ≥3:1 against adjacent colours per 1.4.11); focus trap + restore
  for dialogs/sheets; `Esc` closes overlays; roving-tabindex or arrow handling for
  tab sets and the per-state button groups.
- **Forms & errors:** every control has a programmatically-associated label;
  required/invalid via `aria-required`/`aria-invalid`; inline errors linked via
  `aria-describedby`; an error **summary** region at submit with focus moved to it;
  `autocomplete` on identity/contact fields (1.3.5); registration & voting honour
  3.3.4 (review/confirm step — verify the existing confirm flows expose this to AT).
- **Custom widgets (4.1.2):** language switcher, theme toggle, dropdowns, modals,
  notification toasts get correct `role`/`aria-expanded`/`aria-modal`/labelled
  names; toasts + async results use `aria-live` (4.1.3).
- **Images & icons:** decorative icons `aria-hidden`; meaningful icons/controls get
  an accessible name; document/file thumbnails get alt.
- **Reuse over bespoke:** establish accessible primitives in `src/components/ui/`
  (Button, IconButton, Dialog, Field/Label/ErrorText, VisuallyHidden, LiveRegion)
  and refactor surfaces onto them, rather than patching ARIA inline per component
  — matches CLAUDE.md's "reuse shared components" rule and prevents per-feature
  drift.

### Colour contrast & the mono palette

Audit every foreground/background token pairing in **both** light and dark themes
against AA (4.5:1 text, 3:1 large text & UI/state per 1.4.11). Known suspects to
verify and remediate (estimates — confirm with a contrast tool, do not trust):

| Token | Approx on white | Risk |
|---|---|---|
| `gray-400 #a8a8a8` | ~2.6:1 | **Fails** as text — restrict to decorative/borders, or darken |
| `gray-500 #7a7a7a` | ~4.0:1 | **Fails** normal text 4.5:1 — common `text-gray-500` usage is a hotspot |
| `green-500 #4f8568` | ~4.0:1 | Borderline for "schválené" status text — verify/darken |
| `red-500 #b03838` | ~5.0:1 | Likely OK as text; verify on dark bg |

Remediation may darken a token (it is a CSS variable — one edit propagates to all
utility usages, per the `globals.css` `@theme` design) and/or replace muted-grey
*text* with a compliant token while keeping greys for borders/decoration. Status
must never be conveyed by colour alone (1.4.1) — pair with icon/text (the vote/RSVP
buttons already use explicit labels per CLAUDE.md, verify).

### FOUC / pre-paint subsection (per CLAUDE.md cross-cutting rule)

Accessibility prefs split into two classes, and the flicker risk differs:

- **(c) Pre-paint resolution — OS-level prefs (`prefers-reduced-motion`,
  `prefers-contrast`, `forced-colors`):** these are pure **CSS media queries**, so
  the browser resolves them *natively before first paint* — no JS, no persistence
  channel, **no FOUC by construction**. We add a global
  `@media (prefers-reduced-motion: reduce)` block in `globals.css` that neutralises
  transitions/animations, and respect `forced-colors`/Windows High Contrast by not
  hard-coding colours that defeat it. This is the opposite of the dark-mode case,
  which needed an inline script precisely because theme is a *user toggle* the CSS
  media query can't know.
- **(a) Persistence channel / (c) for any in-app a11y toggle:** if this spike adds
  any user-controlled a11y setting (e.g. an in-app "reduce motion" override or a
  font-scale control), it MUST follow the established theme pattern — a
  **server-readable cookie** read in the server layout so the resolved class is
  painted on first render, **not** localStorage (server-invisible, flickers on
  every RSC nav). MVP intends to honour OS prefs only (no in-app toggle), so this is
  a guard-rail, not new work — recorded so it isn't violated later.
- **(b) Canvas painting:** the `<html>` element is already painted in `globals.css`
  (`html`/`html.dark` background + `color-scheme`); the focus-visible and
  reduced-motion rules must apply at the same layer so no transition flashes on the
  canvas during RSC navigation.
- **(d) Flash-free verification:** exercise RSC navigation (client-side route
  changes across several dashboard routes) with reduced-motion on and with a
  screen reader running, confirming no animation flash and no focus loss on
  navigation.

### Tooling & automated gate

- **Lint:** enable `eslint-plugin-jsx-a11y` in **recommended/strict** mode
  (`eslint-config-next` bundles only a subset) — static JSX a11y errors fail lint.
- **Route sweep:** an axe-core scan over the **full route inventory** in CI using
  **Playwright + `@axe-core/playwright`** (decided 2026-06-09). Rationale: the app
  has **no test runner**, and Playwright is the only option that handles the auth
  fixtures (admin + owner via `storageState`), the transient states the AC requires
  scanning (dialog open, toast shown, form in error — navigate → interact →
  `analyze()`), and WebKit/iOS-Safari (the senior borrowed-phone case). It is also
  the runner the T3 interop runbook and future e2e need anyway — one tool, three
  jobs. `pa11y-ci` was rejected: Chromium-only, awkward auth, can't reach
  interactive states.
- **Gate semantics:** new/changed routes must pass the axe sweep with zero
  violations of the targeted SC; the suite enumerates the inventory so an unscanned
  new route is itself a failure (no silent coverage gaps).

## Acceptance Criteria

**Coverage & process**
- [ ] Every route in the Project Context inventory has been through all three audit
      passes (automated + keyboard + screen-reader), evidence logged per (surface ×
      SC).
- [ ] Every audited surface is either remediated in-spike OR has a filed follow-up
      ticket; the backlog has one ticket per unremediated surface (no bundled
      "misc a11y" ticket).

**Keyboard & focus**
- [ ] Every interactive element is reachable and operable by keyboard alone; no
      keyboard traps (2.1.1/2.1.2).
- [ ] A visible `:focus-visible` indicator exists app-wide in both light and dark
      themes, ≥3:1 against adjacent colours (2.4.7/1.4.11).
- [ ] Dialogs/overlays trap focus, close on `Esc`, and restore focus to the trigger
      on close.
- [ ] A focus-revealed skip link bypasses the nav to `#main` (2.4.1), translated in
      all locales.

**Screen reader & semantics**
- [ ] Each page has one `<main>`, correct landmarks, a single h1, and no skipped
      heading levels (1.3.1/2.4.6).
- [ ] All form controls have associated labels; invalid fields expose
      `aria-invalid` + linked error text; submit moves focus to an error summary
      (1.3.1/3.3.1/3.3.2/3.3.3).
- [ ] Toasts/async results announce via `aria-live` (4.1.3); custom widgets expose
      correct name/role/value (4.1.2), verified in VoiceOver + NVDA.
- [ ] Vote/RSVP/status per-state buttons announce their current state to AT.

**Contrast & visual**
- [ ] All text meets 4.5:1 (large text/UI 3:1) in both themes; the suspect mono
      tokens are verified and remediated or restricted to non-text use.
- [ ] No information is conveyed by colour alone (1.4.1).
- [ ] Layout reflows at 320 CSS px with no horizontal scroll and remains usable at
      200% zoom (1.4.4/1.4.10).

**Motion & pre-paint**
- [ ] With `prefers-reduced-motion: reduce`, non-essential transitions/animations
      are removed via CSS, applied pre-paint with **no FOUC** and verified across an
      RSC navigation (mirrors the FOUC subsection).
- [ ] No regression to the dark-mode theme pre-paint behaviour.

**Gate**
- [ ] `eslint-plugin-jsx-a11y` runs in strict mode and the build fails on its
      errors.
- [ ] An axe route sweep covers the entire inventory in CI and fails on targeted-SC
      violations; an unscanned new route fails the suite.
- [ ] New a11y strings exist in `sk.json`, `cs.json`, `en.json`.

## Test plan

- **Static:** `eslint-plugin-jsx-a11y` strict across `src/`.
- **Automated route sweep:** axe over all 30 routes (admin + owner fixtures + auth
  unauthenticated) and key transient states (a dialog open, a toast shown, a form in
  error).
- **Manual keyboard:** scripted tab-through per route + overlay matrix.
- **Manual AT:** VoiceOver (macOS Safari + iOS) and NVDA (Firefox) on a
  representative path set: login → dashboard → cast a vote → RSVP an event →
  register via token. iOS VoiceOver explicitly covers the senior borrowed-phone
  scenario.
- **Contrast:** token-pairing matrix checked with a contrast tool in both themes.
- **Reflow/zoom:** 320px width and 200% zoom on the same path set.

## Implementation phases (≈60 h)

1. **Tooling & baseline** (~10 h): enable jsx-a11y strict, stand up the axe route
   sweep over the full inventory, capture the baseline violation set.
2. **Global primitives** (~12 h): focus-visible + reduced-motion in `globals.css`,
   skip link, `src/components/ui/` accessible primitives (Button, Dialog, Field,
   LiveRegion, VisuallyHidden).
3. **Contrast remediation** (~8 h): audit + fix mono palette tokens, both themes.
4. **Surface remediation** (~22 h): refactor routes/components onto primitives;
   fix landmarks, forms/errors, custom widgets; clear the automated + manual
   findings. File a per-surface ticket for anything not closed here.
5. **AT verification, gate wiring & docs** (~8 h): VoiceOver/NVDA pass, make the CI
   gate blocking, write the accessibility statement / contributor a11y note (feeds
   T6 docs).

## Project Context

### Route inventory (full — coverage target)

`(auth)`: `login`, `register/[token]`, `register/qr/[token]`, `claim/[token]`,
`privacy-policy`.

`(dashboard)`: `/` (dashboard home), `board`, `voting`, `voting/new`,
`voting/[id]`, `owners`, `owners/[id]`, `owners/pending`,
`owners/pending-registrations`, `documents`, `community-info`, `profile`,
`onboarding`, `settings`, `settings/modules`, `settings/registration-qr`,
`admin/import`, `komunita`, `komunita/pomoc`, `komunita/pomoc/novy`,
`komunita/udalosti`, `komunita/udalosti/nova`, `komunita/adresar`,
`komunita/burza`(+`/novy`) — *marketplace hidden in UI but routes exist; audit
or confirm de-routed*.

30 `page.tsx` files total. Component library under `src/components/**`
(`layout`, `voting`, `owners`, `community`, `documents`, `settings`,
`notifications`, `ui`(empty), `system`, …). Establishing primitives in the empty
`ui/` is part of the remediation.

### Baseline facts

- **Good:** 16px base `font-size`, mobile form-control 16px (iOS zoom guard),
  `color-scheme` + canvas painting on `<html>` (`globals.css`), next-intl drives
  `lang`.
- **Missing:** skip link, app-wide `:focus-visible`, `prefers-reduced-motion`,
  `forced-colors` handling, screen-reader audit, any a11y test tooling.
- **Palette:** mono remap in `globals.css` `@theme` — single source of truth, so
  contrast fixes are CSS-variable edits, not per-component churn.
- **Dark mode:** shipped (BYT-20260506-001, `ThemeProvider`/`ThemeToggle`); its
  inline pre-paint script is the precedent referenced in the FOUC subsection, and
  contrast must be verified in **both** themes.
- **No test runner exists** — this spec introduces **Playwright** (with
  `@axe-core/playwright`) as the app's first browser test runner, setting the
  precedent reused by T3 interop tests and future e2e.
- **Cross-cutting commitment:** full-app coverage with per-surface backlog tickets,
  per CLAUDE.md — explicitly not a bounded key-surfaces list.

## Notes

### Decisions locked (2026-06-09)

- **Sweep tooling: Playwright + `@axe-core/playwright`** — the app's first browser
  test runner. Wins on auth fixtures (`storageState`), interactive-state scanning,
  and WebKit/iOS; also serves T3 interop + future e2e. `pa11y-ci` rejected.

### Decisions to confirm before `in_progress`

- **Marketplace routes:** `komunita/burza` is hidden (tile commented) but the
  routes still resolve. Decide: de-route (preferred — don't audit/ship dead UI) or
  include in coverage.
- **WCAG 2.2:** target 2.1 AA per grant wording; 2.2 (target-size 2.5.8 especially
  — relevant for seniors) is a strong fast-follow candidate. Flagged, not in scope.

### Deferred / linked

- **PDF accessibility:** voting `zápisnica` and the T2 audit bundle produce PDFs;
  PDF-UA / tagged-PDF is a separate effort, not in this web-app spec.
- **T6 docs:** the accessibility statement + contributor a11y checklist produced
  here feed the documentation task.

Placement note: filed in `specs/specs/` (status `spec`) alongside the other NLnet
grant-task specs. The cross-cutting commitment (full inventory + per-surface
backlog) and the FOUC subsection satisfy the CLAUDE.md rules for visual/a11y specs.
Two tooling/scope decisions above want confirming before promotion to
`in_progress`.
