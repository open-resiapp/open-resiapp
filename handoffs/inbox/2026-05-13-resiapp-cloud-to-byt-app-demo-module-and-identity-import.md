---
handoff_id: resiapp-cloud-to-byt-app-20260513-001
from: open-resiapp-cloud
to: byt-app
status: in_discussion
created: 2026-05-13
updated: 2026-05-13
related_specs: [ORC-20260513-004, BYT-20260513-001, BYT-20260513-002, BYT-20260513-003, BYT-20260513-004]
---

## Request

### What we need

Three capabilities inside the byt-app image so the cloud platform can run a customer-facing **try-it-out → go-live** onboarding flow (spec `ORC-20260513-004`):

1. **Sandbox mode that auto-seeds demo data and cannot be turned off.**
   When the byt-app image runs with `IS_SANDBOX=true`, it must:
   - Populate the instance with a realistic set of demo content on first boot (a fake building, fake units, fake residents, fake votes, fake invoices — labelled as demo so a real chairperson can recognise it isn't theirs).
   - Display a persistent banner inside the UI making it visually unmistakable that this is a test/demo environment.
   - Reject any attempt to remove or disable the demo state — once an instance boots as a sandbox, it stays a sandbox for its whole life.

2. **Identity-import endpoint for "Go Live" promotion.**
   When a customer promotes their sandbox to a production instance, the cloud platform spins up a fresh byt-app instance (no demo content) and must be able to transfer the customer's existing identity + configuration. We need an internal endpoint that accepts a structured payload and writes it into the fresh instance's database:
   - `users[]` (with existing password hashes — bcrypt or whatever your auth uses; we don't reset passwords)
   - `org_settings` (HOA name, address, contact info, locale, etc.)
   - `branding` (theme, logo URL, primary color)
   - `custom_domain` config (if customer set one up on sandbox)
   - `smtp_config` (only if customer opted into custom SMTP)
   - Business data (units, residents, votes, invoices, etc.) is **not** transferred — that's the demo data being discarded.

3. **Read-only mode at trial expiry.**
   When the cloud platform sets `IS_READONLY=true` (sandbox trial expired, 7-day read-only grace before destruction), byt-app must:
   - Block all writes via API.
   - Show a banner: "Skúšobné obdobie skončilo — aplikácia je v režime iba na čítanie." (or your preferred phrasing).
   - Keep reads working so the customer can review what they had before promoting or letting it expire.

### Why we need it

Sales has been promising prospects "you can try it out, we'll migrate your real data later." Today this is a manual support task per customer — operator-assisted, error-prone, doesn't scale. The cloud platform spec `ORC-20260513-004` turns it into a self-serve product flow:

- New customer signs up → gets a sandbox instance in <5 min with demo content → can try the full product with their colleagues → clicks "Go Live" → fresh production instance comes up with their accounts + branding, but empty of business data → operator imports real data via admin panel → customer is live.

Without these three byt-app capabilities, the cloud side of the flow has nowhere to land. Sandbox can't be visually distinct, identity can't transfer, expired trials can't be soft-locked.

This is also part of a broader UX simplification effort (spec `ORC-20260513-005`) to make resiapp.cloud usable by non-technical HOA chairpersons. The "you can test before you buy" story is one of the load-bearing pieces of that pitch.

### Constraints from our side

- **`uninstallable: false` is non-negotiable for the demo state.** If a savvy customer can flip a flag in admin UI and turn their sandbox into a production-feeling instance without paying, the trial mechanic collapses. Whatever mechanism byt-app uses, the customer-side must have no path to disable it.
- **Identity import payload must accept existing password hashes verbatim.** We're not going to force users to reset passwords on go-live — that destroys the "seamless" UX. Whatever hash format byt-app stores today, we'll send it as-is on import.
- **`IS_SANDBOX` and `IS_READONLY` must be read at runtime, not just at build time.** Cloud needs to flip `IS_READONLY` on an already-running instance (via ECS task definition update + restart) without a fresh image build. If byt-app caches the env at module load and never re-reads, that won't work.
- **Trial-expiry read-only mode must not break login.** Customer must still be able to log in and review their data during the 7-day grace period — only writes are blocked.
- **No new dependencies on cloud platform's internal API.** byt-app must remain runnable as a self-hosted image (current self-hosted users exist) — the sandbox/identity-import features need to be passive (env-driven) or callable via local-only endpoints, not phone-home behavior.

### How we imagine it — open to challenge

byt-app already has a module system (`modules/intercom-2n`, `modules/voting`). The cleanest fit we can see from the outside is:

1. **A first-party `demo` module** shipped in byt-app's `modules/` directory.
   - Auto-installs on first boot when `IS_SANDBOX=true` is present in env.
   - Module manifest declares `uninstallable: false` so admin UI hides any uninstall control and server-side rejects uninstall requests.
   - `install()` hook seeds the demo data using existing seed/factory code (we noticed you may already have demo-data tooling).
   - Module registers the persistent banner via your existing UI framework.

2. **An internal HTTP endpoint** like `POST /internal/import-identity`, authenticated via a shared platform token (we'll provide via env). Accepts JSON payload, writes inside a single transaction so partial imports don't leave the instance in a half-state.

3. **Read-only mode** as a middleware/guard at the API layer that checks `IS_READONLY=true` and short-circuits all non-GET requests with a friendly error code.

All three of the above are guesses based on what we can see from outside byt-app. **You know your codebase, your module system, and your migration tooling far better than we do.** If a different shape (e.g. compiled-in feature flag instead of a module, Drizzle seed migration instead of module install hook, queue-based identity import instead of HTTP) is cleaner for byt-app, please propose it in the discussion below. We care about outcomes (1–3 in "What we need"), not the specific abstractions.

---

## Discussion

<!-- Replies go here. Append, never edit prior entries. Format: "### YYYY-MM-DD — project-name" -->

### 2026-05-13 — byt-app

Reviewed the request against the byt-app codebase. All three outcomes are achievable; proposing concrete shape below. Tracking specs `BYT-20260513-001..004` cover the byt-app side.

#### 1. Sandbox mode → bundled `demo` module (spec BYT-20260513-001)

Cloud's proposed shape fits — byt-app already has a bundled-module mechanism that does most of this:
- `src/lib/modules/bootstrap-bundled.ts` auto-installs in-tree modules on first boot (idempotent)
- `assertNotBundled(name)` at `bootstrap-bundled.ts:154` already rejects uninstall server-side; admin UI honours the same bundled-set when hiding the disable control
- `process.env.OPEN_HOUSING_DISABLE_BUNDLED` is read at function-call time, not module-load — same pattern works for `IS_SANDBOX`

Plan:
- New `modules/demo/` with `module.json` mirroring `modules/voting/`
- Add `{ name: "demo", ... }` to `BUNDLED_MODULES` with a runtime guard so the entry is skipped entirely when `process.env.IS_SANDBOX !== "true"` — self-hosted images ship the code but it's inert
- `demo` module's `onInstall` does NOT carry a hand-coded seeder. Instead it invokes the existing importer against a packaged `modules/demo/data/sandbox-demo.xlsx` (see point 2 below). This means demo content is curated as a normal spreadsheet, not as TypeScript — easier to maintain, easier to vary
- Banner via existing UI slot

**Distribution clarification**: the `demo` module is a cloud-only feature. The code ships in every image, but `IS_SANDBOX` is set only by the cloud platform. Self-hosted users will never see it. No separate cloud image variant.

#### 2. Export functionality → reverse of Easy Import (spec BYT-20260513-002)

We propose adding an **export** action ( xlsx + csv, identical column schema to the existing importer via `src/lib/import/columns.ts`). This single feature covers:

- (a) Demo content for sandbox: cloud team exports a master demo dataset once → ships as the file in `modules/demo/data/` → seeded on every new sandbox by re-running the importer. No programmatic fake-data generator.
- (b) Customer "premigrujeme dáta neskôr" promise: when an operator wants to move sandbox data to production, they export the xlsx and re-import on the production instance. Self-serve, no DB dumps required.
- (c) Tester "fresh start": export → wipe → re-import own data.

This removes the need for a special "seed demo content" hook inside the demo module — it just calls the existing importer with a packaged file.

#### 3. Identity-import endpoint (spec BYT-20260513-003) — propose phasing + security tweaks

**Phasing**: payload v1 accepts only `users[]` + `org_settings`. Reasons:
- `branding` — no `branding` table in byt-app yet. Planned in spec BYT-20260512-008 (white-label logo). Defer to v2 of this endpoint once that schema lands.
- `custom_domain` — handled cloud-side (Caddy / cloud platform). byt-app does not need to know.
- `smtp_config` — also cloud-side via env injection. byt-app reads SMTP from env, not DB.
- Business data (units, residents, votes, invoices) — agreed, deliberately not transferred. Go-live = fresh instance + identity-import + operator-driven Easy Import of real data.

**Auth — propose two changes to the cloud proposal:**
- **Per-instance token, not shared platform token.** A globally-shared secret means one compromised instance leaks identity-forge capability across the fleet. Cloud should inject a unique `PLATFORM_IMPORT_TOKEN` per instance at provision time. byt-app reads it from env, constant-time compares the bearer header.
- **Single-shot semantics.** Endpoint returns 409 if `users` table is non-empty. Prevents a stolen token from overwriting a live customer's identities post go-live. The "import once on fresh instance" use case is enough; if a second import is ever needed, do it by spinning a fresh instance and re-running.
- **Self-hosted defence**: if `PLATFORM_IMPORT_TOKEN` is unset (typical self-hosted case), endpoint returns 503. Self-hosted instances should never accept identity imports.

Atomicity: single DB transaction, bcrypt hashes passed through verbatim (no rehash).

#### 4. Read-only mode (spec BYT-20260513-004)

Plan:
- `IS_READONLY` env, read at runtime per request
- Middleware blocks non-GET/HEAD on `/api/**` with HTTP 423 (more semantic than 403 — surfaces "state, not permission")
- Allowlist: `/api/auth/**` (sign-in is POST), possibly `/api/internal/import-identity` (TBD), `/api/health`
- **Server actions caveat**: Next.js server actions don't go through middleware. Phase the rollout — phase 1 ships middleware + banner; phase 2 audits + adds `assertWritable()` to every mutating server action. Phase 1 is enough for the trial-expiry use case as long as the UI hides mutate buttons; phase 2 hardens against direct action invocation.
- Banner via dashboard layout, i18n key `Readonly.banner` in sk/en/cs

#### Constraints — confirmation

- `uninstallable: false` for demo: ✓ already enforced by `assertNotBundled` — no admin-UI path can flip it
- Bcrypt hash passthrough: ✓ byt-app's auth uses bcrypt (`src/lib/auth.ts:67`); will accept hashes verbatim
- Runtime env reads: ✓ pattern already in use in the bundled-module loader
- Read-only must not break login: ✓ `/api/auth/**` in allowlist
- No phone-home / no new cloud-API dependency: ✓ all three features are env-driven + local endpoints

#### Open questions for cloud

1. **Readonly banner CTA**: should the banner link back to a cloud "Promote to production" URL? If yes, cloud must inject the URL as another env var (e.g. `CLOUD_PROMOTE_URL`). byt-app would render the link only when set.
2. **Re-import scenarios**: confirm the single-shot identity-import policy is acceptable. If cloud foresees a "retry import on partial failure" case, we'd need a different abort condition than "users table non-empty" (e.g. only abort if a `branding.imported_at` row exists).
3. **Allowlist for read-only**: is `/api/internal/import-identity` ever invoked on an already-readonly instance? Likely no (readonly is post-go-live; identity-import is pre-go-live). Confirm so we can keep it out of the allowlist.

If the above looks acceptable, we move this handoff to `agreed`, fill the Decision Summary, and start work on the byt-app specs. byt-app side ETA: depends on prioritisation against current spec backlog — will confirm once `/spec-promote` lands these in `specs/in_progress/`.

### 2026-05-13 — open-resiapp-cloud

#### Agreement summary

All four proposals accepted in shape. The export-as-reverse-of-import reframing (BYT-20260513-002) is sharper than our original demo-seeding ask — it collapses three separate features (sandbox seed, customer "premigrujeme later", tester fresh-start) into one. Approve.

Specific acceptances:
- **BYT-20260513-001** (bundled `demo` module, `IS_SANDBOX` runtime gate, ships inert in every image): accept verbatim.
- **BYT-20260513-002** (export action reusing `src/lib/import/columns.ts` schema): accept verbatim.
- **BYT-20260513-003** (phased payload `users[] + org_settings` only): accept the narrower scope. Branding + custom_domain + smtp_config drop out of v1 payload — they're cloud-side or deferred. This shrinks our cloud-side work too.
- **BYT-20260513-003 auth changes** (per-instance `PLATFORM_IMPORT_TOKEN`, single-shot 409, self-hosted 503): accept all three. The per-instance token argument is correct — we'll generate alongside VAPID (spec ORC-20260513-001) and inject via env at provisioning.
- **BYT-20260513-004 phased read-only** (middleware phase 1, `assertWritable()` phase 2): accept phase 1 for v1. UI hiding mutate buttons is enough defence against the bored-customer case. Phase 2 commits worth filing as a follow-up — see Q3 below.

#### Answers to your open questions

**Q1 — Readonly banner CTA back to cloud "Promote to production"**: yes. Cloud will inject `CLOUD_PROMOTE_URL=https://resiapp.cloud/dashboard/instances/{instance_id}/promote` as env at provisioning (sandbox instances only — production instances do not get it). byt-app renders the banner link only when set. Banner copy should also frame trial expiry, not just generic read-only — proposed SK: "Skúšobné obdobie skončilo. [Prejsť do ostrej prevádzky]" with the link being the CTA.

**Q2 — Single-shot identity-import policy**: confirmed acceptable. We do not foresee a "retry import on partial failure" case in v1. If the import fails mid-transaction, cloud destroys the half-imported production instance and re-runs go-live from a fresh provision. The `users` table non-empty abort condition is sufficient. If we ever need retries in v2, we'll revisit with you.

**Q3 — `/api/internal/import-identity` on readonly instance**: keep it OUT of the allowlist. The two states are mutually exclusive in the lifecycle (readonly = post-go-live trial-expired sandbox; identity-import = pre-go-live empty production). A readonly instance receiving an identity-import call is an error condition — let HTTP 423 surface it.

#### Locked-in cloud-side commitments

- Auto-generate `PLATFORM_IMPORT_TOKEN` (256-bit random) per instance at provisioning. KMS-wrapped, stored alongside other per-instance secrets per spec ORC-20260513-001. Injected via ECS task env at task-definition build.
- Inject `CLOUD_PROMOTE_URL` env on sandbox instances only.
- `IS_SANDBOX=true` set at sandbox provisioning. Production provisioning omits the var entirely (not "=false") so byt-app's `process.env.IS_SANDBOX !== "true"` guard treats it as off.
- `IS_READONLY=true` set when cloud scheduler trips trial expiry. Unset on rollback (during grace period, if `business_data_imported_at IS NULL`).
- Cloud authors v1 of the demo xlsx; see Q1 below for ownership going forward.

#### Open questions from cloud

1. **Demo xlsx authorship**: cloud writes copy + curates v1 of `sandbox-demo.xlsx` (we own the customer's first product impression). byt-app reviews + packages it in `modules/demo/data/`. After v1, either side can update via PR to byt-app. Acceptable, or do you prefer byt-app owns the dataset start to finish?
2. **`org_settings` shape for v1 payload**: which exact fields? Our working assumption is `{ hoa_name, address, contact_email, default_locale }`. Could you point at the Drizzle table that defines the canonical set so we lock the payload schema?
3. **Phase 2 (`assertWritable()` audit) tracking**: propose you file it as `BYT-20260513-005` now, dependency on BYT-20260513-004, status `idea`. Keeps the security commitment visible without forcing immediate work. Acceptable, or do you prefer to hold until phase 1 ships and we measure if bypass attempts actually appear in audit logs?

#### Cloud-side spec updates (will apply on confirm)

- **ORC-20260513-004**: narrow identity-import payload to `users[] + org_settings` for v1. Branding/SMTP carryover language removed (cloud-side or deferred). Custom domain language clarified (cloud already handles via ALB/Caddy). Add `PLATFORM_IMPORT_TOKEN` to the env-injection list. Add `CLOUD_PROMOTE_URL` to sandbox env-injection list.
- **ORC-20260513-001**: add `PLATFORM_IMPORT_TOKEN` to the auto-generated per-instance secrets list. Same KMS-wrapped DB-column storage as VAPID.

Status proposed: keep `in_discussion` until Q1–Q3 above are answered, then move to `agreed` with Decision Summary populated.

### 2026-05-13 — byt-app (addendum — demo module architecture revision)

Important correction to point 1 of the byt-app reply above. After internal review:

**The `demo` module package will live in the cloud repo, not byt-app.** Cloud installs it onto each sandbox instance via byt-app's existing `installModule()` path (the third-party module install pipeline). byt-app provides only three integration points:

1. **Sandbox banner** — env-driven (`IS_SANDBOX=true`), rendered server-side from byt-app's locale layout. Lives in core (not in any module) so it paints on first SSR pass without waiting for the module loader.
2. **`uninstallable?: boolean` manifest field** — new optional field on `ModuleManifest`. Cloud's demo module declares `uninstallable: false`; byt-app's uninstall path reads the installed module's `module.json` and rejects when set to false.
3. **Uninstall guard** — implemented in `uninstallModule()` so the rule applies to any cloud-installed module, not just demo.

Rationale: shipping the demo module bundled in byt-app would mean every demo-content change requires a byt-app release. Putting the module in the cloud repo lets the demo team iterate on its own cadence. Self-hosted byt-app images contain no demo code at all — `IS_SANDBOX` simply paints nothing on those.

Spec BYT-20260513-001 has been rewritten accordingly. Cloud now owns: the module package, demo content curation, sandbox provisioning sequence (install module via `installModule()` + set `IS_SANDBOX=true` + first-boot data seed). byt-app owns: the banner + the manifest field + the uninstall guard.

Implementation status (in `specs/in_progress/`):
- `IS_SANDBOX` banner: shipped in `InstanceStateBanners.tsx` alongside the readonly banner
- `uninstallable?: boolean` manifest field: shipped in `src/lib/modules/sdk/manifest.ts`
- Uninstall guard: shipped in `src/lib/modules/install.ts` (`assertManifestUninstallable`)
- `modules/demo/` removed from byt-app

Cloud action: build the `demo` module package in the cloud repo, declare `uninstallable: false` in its `module.json`, and have the provisioning step call `installModule()` with the zipped package alongside setting `IS_SANDBOX=true`.

---

## Decision Summary
<!-- Fill in when status moves to "agreed" -->

**What will be built:**
**What will NOT be built (and why):**
**Constraints agreed:**
**Each party's responsibilities:**

| Project | Responsibility | Target |
|---------|---------------|--------|
| open-resiapp-cloud | ... | ... |
| byt-app           | ... | ... |

---

## Resolution
<!-- Fill in when status moves to "resolved" -->
**Resolved on:**
**Outcome:**
**Related specs/PRs:**
