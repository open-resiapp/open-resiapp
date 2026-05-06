---
retro_for: RES-20260506-002
spec_title: "Dark mode with header toggle"
created: 2026-05-06
status: applied
---

## Discrepancies

### 1. Persistence mechanism switched from `next-themes` + localStorage to custom cookie-based provider
- **Category:** better_approach
- **Spec said:** add `next-themes`; persist via its default `localStorage` (`theme` key)
- **Implementation did:** removed `next-themes`; built custom `ThemeProvider` writing a `theme` cookie (`samesite=lax`, 1y); server reads it and sets `<html className>` on first render
- **Why:** localStorage isn't readable on the server. Between RSC navigations the server-rendered HTML had no class until a client `useEffect` re-applied it, causing a visible theme flash. Cookie + server-side read fixed it.

### 2. Client/server module split for `theme.ts`
- **Category:** spec_incomplete
- **Spec said:** a single `src/lib/theme.ts` exporting `Theme`, `THEME_COOKIE`, and `getThemeFromCookie()`
- **Implementation did:** split into `src/lib/theme.ts` (types + constants, client-safe) and `src/lib/theme.server.ts` (`import "server-only"` + `getThemeFromCookie()`)
- **Why:** `ThemeProvider` (a client component) imports the `Theme` type and `THEME_COOKIE` constant. With everything in one file, the client bundle pulled in `next/headers` and the build errored. Splitting kept server-only APIs out of the client bundle.

### 3. `<html>`-level canvas painting
- **Category:** spec_incomplete
- **Spec said:** body base classes (`bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100`) + `dark:` utilities on key surfaces
- **Implementation did:** added explicit CSS rules `html { background-color: #fff; color-scheme: light }` + `html.dark { background-color: #111827; color-scheme: dark }` to `globals.css`
- **Why:** The browser canvas (the `<html>` element itself) defaulted to white between RSC navigations, even when `body` was dark — visible as a flash. Painting `<html>` directly removes the flash and `color-scheme` aligns native scrollbars/inputs.

### 4. Pre-paint bootstrap script idempotency
- **Category:** spec_incomplete
- **Spec said:** inline `<head>` script reads cookie, resolves `system`, applies class to `<html>`
- **Implementation did:** same, but the script now only mutates classList when the desired class isn't already present
- **Why:** The first version unconditionally `removed("light","dark")` then `added(...)`, which cleared the server-set class for one frame on every page load — exactly the flash the script was supposed to prevent. Idempotent version is a no-op when the server already painted correctly.

### 5. Scope: "key surfaces" → full app sweep
- **Category:** scope_creep
- **Spec said:** bounded list — Header, Sidebar, dashboard page shells, shared `PostCard`, auth login/register
- **Implementation did:** full sweep — every dashboard page (board, profile, owners list/detail/pending, community-info, all komunita pages), all Settings tabs (BuildingInfo, Flats, Entrances, BoardMembers, VotingSettings, ExternalConnections, ModulesAdmin, registration-qr) + Settings root + SettingsTabs, full Voting module (list/new/detail) and all child components (VotingCard, VotingResults, PaperVoteModal, MandateModal), profile children (ConsentManagement, NotificationPreferences, PushSubscriptionManager), all modals (NewPost, EditPost, Invitation, PendingApproval, DirectoryEdit, Response, ConsentForm), EntitySwitcher, both PostCard variants (nastenka + community), auth misc (privacy-policy, register/qr/[token])
- **Why:** As soon as the toggle landed, navigation surfaced page after page that was still white. The bounded "key surfaces" framing created a long tail of bug reports rather than reducing scope. User asked to keep going until coverage was complete.

### 6. Locale count drift in spec/memory
- **Category:** one_off
- **Spec said:** `messages/sk.json`, `messages/en.json` (sk + en) — implicit assumption from MEMORY.md
- **Implementation did:** added `ThemeToggle` namespace to sk + en + **cs**
- **Why:** MEMORY.md hadn't been updated when Czech locale was added to the repo. Caught early during the i18n step but the spec's blast-radius table inherited the stale assumption.

## Findings

### 1. Theming / accessibility / i18n specs default to full-app coverage, not "key surfaces"
- **Target:** claude_md
- **From discrepancy:** #5
- **Recommendation:** When introducing an app-wide visual or behavioral property (dark mode, RTL, accessibility audit, locale rollout), don't bound the spec to a "key surfaces" list. Either commit to full-app coverage in the same spike or create an explicit follow-up backlog (one ticket per remaining surface) that ships alongside. A bounded list creates a long tail of "still white / still untranslated" reports because users navigate the whole app, not just the listed routes.
- **Applied:** yes

### 2. Split client-safe constants from server-only APIs in shared lib modules
- **Target:** claude_md
- **From discrepancy:** #2
- **Recommendation:** When a `src/lib/*.ts` module mixes server-only APIs (`next/headers`, `cookies()`, `headers()`, DB drivers) with constants/types imported by client components, split into two files: `foo.ts` (types + constants, client-safe) and `foo.server.ts` (server APIs, with `import "server-only"` at the top). Without the split, anything importing the constants drags `next/headers` into the client bundle and the build errors with "You're importing a component that needs next/headers".
- **Applied:** yes

### 3. SSR/RSC theming specs need explicit FOUC / navigation-flicker coverage
- **Target:** spec_skill
- **From discrepancy:** #1, #3, #4
- **Recommendation:** Specs introducing app-wide theming under SSR/RSC must cover three things explicitly in Approach + AC: (a) persistence in a server-readable channel (cookie, not localStorage) so the server can paint the resolved class on first render; (b) `<html>`-level background painting in CSS, not just body, because the browser canvas is the `<html>` element and shows through during route transitions; (c) idempotent pre-paint inline script that resolves `system` mode before hydration AND no-ops when the server-set class already matches. Missing any one of these reintroduces the flicker the toggle was meant to prevent.
- **Applied:** proposed (consolidated with #4 into `specs/retros/proposals/2026-05-06-spec-new-fouc-section.md`)

### 4. `/spec-new` template should require a "FOUC / navigation flicker" section for theming/styling specs
- **Target:** spec_skill
- **From discrepancy:** #1, #3, #4
- **Recommendation:** Add a conditional section to the `/spec-new` template — when the spec is tagged `theming`, `styling`, or otherwise touches global appearance — requiring the author to fill in: where the resolved theme class comes from on first paint, how `<html>` is painted (not just body), how `system` mode is resolved before hydration, and how navigation between RSC routes is verified flash-free. This forces the issues out at spec time instead of mid-implementation.
- **Applied:** proposed (consolidated with #3 into `specs/retros/proposals/2026-05-06-spec-new-fouc-section.md`)

### 5. Verify list-shaped MEMORY claims against current code before referencing in a spec
- **Target:** claude_md
- **From discrepancy:** #6
- **Recommendation:** When a spec references a list pulled from MEMORY.md (locales, installed modules, entity kinds, role enum, schema tables), verify against the code (`messages/`, `modules/`, `src/types`, schema files) before writing the spec body or blast-radius table. Memory snapshots drift quickly; lists are the most common drift surface. One `ls messages/` is cheaper than a follow-up spec to add the missed locale.
- **Applied:** yes
