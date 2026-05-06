---
spec_id: RES-20260506-002
title: "Dark mode with header toggle"
status: implemented
created: 2026-05-06
updated: 2026-05-06
author: byt-app
owner: byt-app
last_verified: 2026-05-06
project_type: other
depends_on: []
related_handoffs: []
tags: [ui, theming, accessibility]
feature_branch: feature/dark-mode-toggle
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal
Give every user the ability to use the app in light, dark, or system-matched appearance with a header toggle. Today the app is light-only with hardcoded color utilities (`bg-white`, `text-gray-900`, …) and no theme system, which is uncomfortable in low-light HOA meetings, hurts accessibility, and pushes us behind expected modern UX. Adding a theme provider and a per-state toggle resolves all three.

## Scope

### In scope
- Custom `ThemeProvider` (`src/components/ThemeProvider.tsx`) — no `next-themes` dependency. Cookie-based persistence so the server can paint the right theme on every navigation.
- Tailwind v4 `@custom-variant dark` directive in `src/app/globals.css` so `dark:` utilities respond to the `class` attribute on `<html>`.
- New `ThemeToggle` component with three explicit buttons: light / dark / system. Pattern mirrors `LanguageSwitcher` (per CLAUDE.md UI rule: explicit per-state, no implicit cycling).
- Render the toggle in `Header.tsx` next to `LanguageSwitcher`, and in the auth-layout corner alongside it.
- i18n keys for the toggle in `messages/sk.json`, `messages/en.json`, `messages/cs.json` under a `ThemeToggle` namespace.
- `dark:` variants applied broadly across the app: Header, Sidebar, all dashboard page shells, both `PostCard` variants (nastenka + community), all komunita pages (landing, udalosti, pomoc, burza, adresar), Board, Profile (+ ConsentManagement, NotificationPreferences, PushSubscriptionManager), Owners list / detail / pending, Settings root + all tabs (BuildingInfo, Flats, Entrances, BoardMembers, VotingSettings, ExternalConnections, ModulesAdmin, registration-qr), Voting module (list/new/detail), all voting child components (VotingCard, VotingResults, PaperVoteModal, MandateModal), all modals (NewPost, EditPost, Invitation, PendingApproval, DirectoryEdit, Response, ConsentForm), EntitySwitcher, both auth pages + privacy-policy.
- Viewport `themeColor` converted to media-query array (`light` + `dark` colors).
- Persistence via a `theme` HTTP cookie (`samesite=lax`, 1-year max-age), read server-side in `[locale]/layout.tsx` and applied as a class on `<html>` before render. A small inline pre-paint script in `<head>` resolves "system" against `prefers-color-scheme` so navigation never flashes the wrong appearance.

### Out of scope
- Full semantic-token refactor (CSS variables for `--background`, `--foreground`, `--card`, `--border`, …). Tracked as a follow-up spec if the incremental `dark:` approach proves noisy.
- Dark mode for transactional emails (`src/lib/email.ts`).
- Dark mode for printable views and PDF exports.
- Dark-mode-aware chart/graph palettes.
- Per-user persisted theme preference in the database (we rely on the `theme` cookie only).
- (Originally out-of-scope but pulled in mid-implementation at user request — see Notes.)

## Approach

1. **Tailwind v4 dark variant** — in `src/app/globals.css` add `@custom-variant dark (&:where(.dark, .dark *));` and base body fallbacks (`bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100`).
2. **Cookie helpers** — `src/lib/theme.ts` exports the `Theme` type and `THEME_COOKIE` constant (imported by both server and client). `src/lib/theme.server.ts` (marked `server-only`) wraps `next/headers` `cookies()` in `getThemeFromCookie()`. The split keeps `next/headers` out of the client bundle.
3. **Custom `ThemeProvider.tsx`** — client provider that takes `initialTheme` from props (cookie value), exposes `useTheme()` with `{ theme, resolvedTheme, setTheme }`. `setTheme` writes `document.cookie` (`samesite=lax`, 1-year max-age) and updates a `class` on `<html>`. When `theme === "system"`, listens to `prefers-color-scheme` and follows OS changes live.
4. **Provider wiring** — `Providers.tsx` accepts `initialTheme`, nests `ThemeProvider` inside `SessionProvider`. `[locale]/layout.tsx` reads cookie via `getThemeFromCookie()`, passes it down, sets initial `class` on `<html>` for explicit choices, and injects an inline pre-paint script that resolves `system` against `prefers-color-scheme` before first paint. `suppressHydrationWarning` stays on `<html>`.
5. **`ThemeToggle.tsx`** — client component using `useTheme()`. Three buttons with active-state styling matching `LanguageSwitcher`. Inline SVG icons (sun / moon / monitor). No mounted-guard needed: server already renders correct class, so initial state is consistent.
6. **Header integration** — render `<ThemeToggle />` in `src/components/layout/Header.tsx` next to `<LanguageSwitcher />`. Same in `[locale]/(auth)/layout.tsx`. Update both shells' classes with `dark:` variants.
7. **i18n** — add `ThemeToggle` namespace to all three locale files: `light`, `dark`, `system`, `label`.
8. **Key-surface pass** — apply `dark:` variants to the bounded list above. Anything outside the list ships in follow-up.
9. **Viewport themeColor** — convert single value to array with `prefers-color-scheme` media queries.

## Acceptance Criteria
- [ ] No `next-themes` dependency. Persistence implemented via the `theme` cookie.
- [ ] `src/app/globals.css` contains `@custom-variant dark` so `dark:` utilities work against `<html class="dark">`.
- [ ] `src/lib/theme.ts` exports the `Theme` type and `THEME_COOKIE` constant (client-safe). `src/lib/theme.server.ts` exports `getThemeFromCookie()` and is `server-only`.
- [ ] `src/components/ThemeProvider.tsx` exposes `useTheme()` and writes `document.cookie` on `setTheme`.
- [ ] `[locale]/layout.tsx` reads the cookie, sets `className="light"` or `"dark"` on `<html>` for explicit choices, and injects an inline pre-paint script that handles `system`. `suppressHydrationWarning` is set on `<html>`.
- [ ] `src/components/ThemeToggle.tsx` renders three buttons (light / dark / system), shows the current selection visually, and uses i18n strings.
- [ ] Header renders the toggle next to `LanguageSwitcher`; auth layout renders it next to `LanguageSwitcher` in the corner.
- [ ] `messages/sk.json`, `messages/en.json`, `messages/cs.json` each contain a `ThemeToggle` namespace with `light`, `dark`, `system`, `label` keys.
- [ ] Selecting Light / Dark sets a `theme` cookie and applies `class="light"` or `class="dark"` to `<html>`; reload and route navigation preserve the choice without any flash.
- [ ] Selecting System removes the explicit DOM class effect; the bootstrap script tracks `prefers-color-scheme` and toggling the OS theme flips the app live.
- [ ] Sidebar, dashboard page shells, both `PostCard` variants, all komunita pages, Board, Profile, Owners (list/detail/pending), all Settings tabs, full Voting module (list/new/detail + child components), all modals, EntitySwitcher, and all auth pages render correctly in dark mode (no white-on-white or black-on-black contrast bugs).
- [ ] Viewport `themeColor` is an array with light and dark entries.
- [ ] No regressions in `LanguageSwitcher`, `EntitySwitcher`, profile link, or logout button styling in either mode.

## Project Context
**project_type:** other (Next.js 16 App Router + TypeScript + Tailwind v4 + next-intl, three locales: sk/en/cs).

Files in this spec's blast radius:

| File | Role |
|---|---|
| `src/lib/theme.ts` | new — cookie name, `Theme` type (client-safe) |
| `src/lib/theme.server.ts` | new — `getThemeFromCookie()`, `server-only` |
| `src/components/ThemeProvider.tsx` | new — client provider, cookie writer |
| `src/app/globals.css` | Tailwind v4 dark variant + body base classes |
| `src/components/Providers.tsx` | nest custom `ThemeProvider` inside `SessionProvider`, accept `initialTheme` |
| `src/app/[locale]/layout.tsx` | read cookie; set `<html className>`; inject pre-paint script; viewport themeColor array |
| `src/components/ThemeToggle.tsx` | new — 3-state toggle |
| `src/components/layout/Header.tsx` | render toggle; add `dark:` classes |
| `src/components/layout/Sidebar.tsx` | `dark:` classes (key surface) |
| `src/components/nastenka/PostCard.tsx`, `src/components/community/PostCard.tsx` | `dark:` classes |
| `src/app/[locale]/(dashboard)/{layout,page}.tsx` | shell-level `dark:` classes |
| `src/components/settings/{BuildingInfoTab,FlatsTab,EntrancesTab,BoardMembersTab,VotingSettingsTab,ExternalConnectionsTab,SettingsTabs}.tsx` | full Settings dark-mode coverage |
| `src/app/[locale]/(dashboard)/settings/{page,registration-qr/page,modules/ModulesAdminClient}.tsx` | settings root + sub-pages |
| `src/app/[locale]/(dashboard)/{board,profile,owners,owners/[id],owners/pending,community-info,komunita,komunita/{udalosti,pomoc,burza,adresar}}/page.tsx` | dashboard page coverage |
| `modules/voting/src/routes/dashboard/{page,new/page,id/page}.tsx` | voting module pages |
| `src/components/voting/{VotingCard,VotingResults,PaperVoteModal,MandateModal}.tsx` | voting child components |
| `src/components/{nastenka/{NewPostModal,EditPostModal},community/{ResponseModal,DirectoryEditModal},owners/{InvitationModal,PendingApprovalModal},consent/{ConsentForm,ConsentManagement},notifications/{NotificationPreferences,PushSubscriptionManager},layout/EntitySwitcher}.tsx` | all modals + widgets |
| `src/app/[locale]/(auth)/{layout,login,register/[token],register/qr/[token],privacy-policy}.tsx` | all auth pages; toggle in auth corner |
| `messages/{sk,en,cs}.json` | `ThemeToggle` namespace |

Reusable patterns referenced (no new code needed):
- `src/components/LanguageSwitcher.tsx` — per-state button group, active-state classes, i18n namespace pattern.

## Notes
- 2026-05-06: Memory file `MEMORY.md` claimed locales are sk/en — actual repo has sk/en/cs. Worth correcting after this lands.
- 2026-05-06: Initial implementation used `next-themes` (localStorage). Rejected because navigation between RSC routes flashed the wrong theme. Replaced with a custom cookie-based provider so the server can paint the resolved class on every render. Inline `<head>` script handles the only un-server-knowable case (`system` mode).
- 2026-05-06: After landing the bounded "key surfaces" pass, navigation revealed many secondary screens still on white (tables, profile children, komunita inner pages, voting module, modals, auth misc). User asked to keep going. Scope was expanded in-flight to cover all dashboard pages, all settings tabs, the full voting module incl. child components, all modals, EntitySwitcher, and all auth pages. The semantic-token CSS-var refactor still belongs in a follow-up spec — this pass remained `dark:` utility classes only.
- 2026-05-06: `<html>` itself now has explicit `background-color` + `color-scheme` in `globals.css` (light + `html.dark`). Without this, the browser canvas defaulted to white between RSC navigations even when the body was dark — visible as a flash. Bootstrap script also made idempotent (only mutates classList when needed) so server-rendered explicit choices pass through untouched.
- 2026-05-06: `src/lib/theme.ts` was split into a client-safe `theme.ts` (types + constants) and a `server-only`-marked `theme.server.ts` (`getThemeFromCookie()`). Required because `ThemeProvider` (client) imports the type/constants while the layout (server) calls `cookies()` — a single file would have pulled `next/headers` into the client bundle.
- Open question: should the toggle live in the mobile drawer (Sidebar) too, or only in the Header? Default for v1: Header only — same placement on mobile and desktop, matching `LanguageSwitcher`.
- Follow-up candidate: semantic CSS-var token system (`--background`, `--foreground`, `--card`, `--border`, `--muted`, `--primary`) once the incremental `dark:` pass surfaces enough painful spots to justify it. Would also pave the way for per-tenant brand-color overrides in the cloud module.
