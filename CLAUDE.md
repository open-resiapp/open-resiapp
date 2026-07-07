# open-housing

Slovak HOA (housing community) management app.

## Stack
- Next.js App Router + TypeScript + Tailwind CSS v4
- PostgreSQL + Drizzle ORM — migrations in `drizzle/migrations/`
- NextAuth v5 (beta.30) — auth
- next-intl — i18n, locales: `sk` (default), `en`, `cs`
- Docker + Caddy — deployment

## Structure
```
app/
  [locale]/
    dashboard/
      board/        # board of directors
      voting/       # voting (Slovak electronic voting law compliance)
      owners/       # unit owners
      settings/
      consent/      # data processing consent
      notifications/
lib/
  db/               # Drizzle schema + queries
  auth/             # NextAuth config
drizzle/
  migrations/       # SQL migrations
messages/
  sk.json           # Slovak strings (default)
  en.json
  cs.json           # Czech
```

## Rules

### i18n
- ALL user-facing strings via `useTranslations()` / `getTranslations()`
- Never hardcode text in components
- Add new keys to ALL locale catalogs: `sk.json`, `en.json`, `cs.json` (cs is a live, routed locale — see `src/i18n/routing.ts`). Czech localizes the HOA legal basis to Czech law (§1187 zák. 89/2012 Sb.); SK-specific community types (urbár, hunting, fishing) keep their Slovak act references unchanged.
- Email copy: any new function in `src/lib/email.ts` sources strings via `getTranslations({ locale, namespace: "Email" })` against `messages/{locale}.json`, and accepts an optional `locale?: string` param (default `routing.defaultLocale`). Pre-existing SK-hardcoded emails (`sendPasswordReset`, `sendPairingInvitation`, `sendVoteConfirmation`) are tech debt — do not copy that pattern.
- Domain/engine errors are user-facing strings too. A pure engine (allocation, settlement, booking — `modules/*/engine/*` and `src/lib/*` pure fns) must throw/return stable error **codes**, never English prose; the calling server action / component maps the code to an i18n catalog entry. Function purity does NOT exempt error messages from the next-intl rule — design the code→catalog mapping in the same slice as the engine, or the string surfaces raw in the UI (the accounting engines shipped EN-only errors and it stayed tech debt across ~5 slices).

### Database
- Schema changes always via `drizzle-kit generate` — never manual SQL
- Query functions in `lib/db/`, not inline in server actions
- Commit migrations together with schema changes
- Every `references(...)` in schema MUST specify `onDelete` — default is almost never correct. Use `cascade` for owned children, `set null` for soft links, `restrict` only when an intentional hard block.
- Per-(post, recipient) email tracking — throttle, dedupe, suppression — lives in a single `*_notifications_sent` table with a `kind` enum, not a purpose-specific table per email type. One index pattern, one mental model.
- Before converting an enum column to text (or renaming any enum value), grep all string-literal occurrences of every enum value across `src/` and `modules/`. Every match becomes a code change in the same PR as the migration — otherwise queries like `eq(table.col, "old_value")` match zero rows post-migration and the app silently breaks.
- Hand-written SQL migrations are required for destructive type alters (enum→text with USING), DROP TABLE, and data backfills — `drizzle-kit generate` can't produce them safely. Workflow: copy the previous `drizzle/meta/0NNN_snapshot.json` to the new index, generate a fresh UUID for `id`, set `prevId` to the previous snapshot's `id`, mutate the JSON tables/enums sections via Python JSON parse (not text edits), and append an entry to `drizzle/meta/_journal.json`. See `drizzle/0023_backfill_entities.sql`, `0034_kind_to_text_fk.sql`, `0036_drop_legacy_housing_data.sql` for the established pattern.

### Auth
- Session check via `auth()` in server components / server actions
- Protected routes via middleware (`matcher` in `middleware.ts`)

### Route handlers
- `app/**/route.ts` files may export only HTTP method handlers (`GET`, `POST`, etc.) and Next.js-recognized config (`runtime`, `dynamic`, `revalidate`). Module-level state (in-memory caches, last-run snapshots, singletons) lives in `src/lib/*` and is imported by the route — exporting anything else triggers a build-time error.

### Library modules
- When a `src/lib/*.ts` module mixes server-only APIs (`next/headers`, `cookies()`, `headers()`, DB drivers) with constants/types imported by client components, split it: `foo.ts` (types + constants, client-safe) and `foo.server.ts` (server APIs, with `import "server-only"` at the top). Without the split, anything importing the constants drags `next/headers` into the client bundle and the build errors with "You're importing a component that needs next/headers".

### Deployment
- Docker image → Docker Hub → Railway
- Caddy as reverse proxy
- Env vars: never commit `.env`, keep `.env.example` up to date
- Pre-migration backup (`docker-entrypoint.sh`): on every boot it logs both the pg_dump client major and the PostgreSQL server major. Expected steady state is matched majors (image client == RDS server). If the client is **older** than the server, the dump is forward-incompatible, so the entrypoint logs a WARNING and auto-skips the backup (migrations still run) instead of bricking the instance — per-DB S3 backups remain the safety net. Env vars: `DISABLE_PREMIGRATION_BACKUP=1` skips the backup entirely (manual opt-out); `FORCE_PREMIGRATION_BACKUP=1` overrides the auto-skip and restores strict abort-on-version-skew (downtime over a missing snapshot). A dump under 1KB is treated as a failure and aborts startup.

### UI patterns
- Multi-state user choice (RSVP yes/maybe/no, vote for/against/abstain, status filters): use explicit per-state buttons. Avoid implicit toggles where one button cycles values.
- Reuse shared card components (e.g., `PostCard`) by injecting feature-specific children. New bespoke card per feature requires explicit justification — visual mocks alone are not enough.
- Components emitting legally regulated content (voting minutes PDFs, GDPR notices, statutory citations, accounting attestations) MUST NOT be naively parametrized across templates / kinds. Display labels (column headers, leaf-kind names) parametrize cleanly; statutory references (e.g. §14 ods. 4 zák. 182/1993 Z.z. in `VotingMinutesPDF`) don't — they cite HOA law that doesn't apply to garden / garage / etc. Either restrict the feature to the template that owns the statute, or ship a separate template-aware content module. Default assumption: legally regulated until proven display-only.

### Cross-cutting changes (theming, accessibility, i18n rollout)
- Don't bound the spec to a "key surfaces" list. Either commit to full-app coverage in the same spike or create an explicit follow-up backlog (one ticket per remaining surface) that ships alongside. A bounded list creates a long tail of "still white / still untranslated" reports because users navigate the whole app, not just listed routes.

### Specs
- A spec that introduces a per-user mutable record (RSVP, opt-in entry, subscription, draft) must explicitly cover the undo/delete path in Approach and Acceptance Criteria — not only create/update.
- When a spec references a list pulled from MEMORY.md (locales, installed modules, entity kinds, role enum, schema tables), verify against current code (`messages/`, `modules/`, `src/types`, schema files) before writing the spec body. Memory drifts; lists are the most common drift surface.
- Features that seed a reference table (kind catalog, role catalog, country catalog, plan catalog) must land the FULL catalog enumeration BEFORE any bootstrap / seed script that references it. Reviewers reject "bootstrap lands first, catalog rows follow later" sequencing — the bootstrap will reference missing rows and either fail at runtime or silently create orphan entities. AC must list every catalog row (slug + metadata) that the feature's bootstrap path will read.
- Cross-cutting visual specs (theming, RTL, accessibility audit, locale rollout under SSR/RSC) must include a "FOUC / navigation flicker" subsection in Approach, covering: (a) **persistence channel** — server-readable (cookie, URL param, header) so the server paints the resolved state on first render; localStorage is server-invisible and flickers on every RSC nav; (b) **canvas painting** — how `<html>` itself is painted, not just `<body>` (the html background shows through between paints); (c) **pre-paint resolution** — for values the server can't know (e.g. `prefers-color-scheme`), how they're applied before first paint via an idempotent inline script that no-ops when the server already painted correctly; (d) **flash-free verification** — how RSC navigation is exercised during testing. AC must mirror these as testable bullets.
- When an AC enumerates an exhaustive allowed set ("shows only …", "exposes exactly …", "nothing else"), its test must assert the surface holds NOTHING beyond that set — check the full membership / count, not just that each listed item is present. Presence-only checks pass silently on over-delivery (AC 507's owner portal gained an extra debtors card that every presence check missed; caught only by a later manual audit).

## Common commands
```bash
pnpm dev                    # dev server
pnpm db:generate            # generate migration after schema change
pnpm db:migrate             # apply migrations
pnpm db:studio              # Drizzle Studio
docker compose up           # local docker
```
