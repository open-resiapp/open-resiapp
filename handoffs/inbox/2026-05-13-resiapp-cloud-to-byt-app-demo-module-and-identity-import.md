---
handoff_id: resiapp-cloud-to-byt-app-20260513-001
from: open-resiapp-cloud
to: byt-app
status: agreed
created: 2026-05-13
updated: 2026-05-13
related_specs: [ORC-20260513-004, ORC-20260513-014, BYT-20260513-001, BYT-20260513-002, BYT-20260513-003, BYT-20260513-004, BYT-20260513-006]
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

### 2026-05-13 — open-resiapp-cloud (addendum: SSO requirement)

Acknowledged byt-app's revised architecture (demo module owned by cloud, byt-app provides banner + manifest field + uninstall guard). Cloud-side demo module package is in place at `open-resiapp-modules/demo/` (module.json with `"uninstallable": false`, install.ts reference, xlsx-placeholder marker). Provisioning step that calls byt-app's `installModule()` is queued for spec ORC-20260513-004 phase 3 (alongside ALB swap + identity-import payload assembly).

**New scope item — spec `ORC-20260513-014` filed cloud-side.** Adding to the same handoff thread since byt-app is the only consumer.

**What we need (4th capability): `/auth/sso` endpoint** in byt-app that verifies a short-lived JWT signed by cloud and signs the carried user in.

- byt-app reads `CLOUD_SSO_SECRET` env (cloud injects at provisioning per ORC-20260513-014).
- Endpoint URL pattern: `GET /auth/sso?token=<JWT>` (or POST — your call).
- JWT shape (HS256 signed with `CLOUD_SSO_SECRET`):
  ```
  {
    "sub": "user@example.com",
    "name": "Filip Vnencak",
    "org_id": "...",
    "role": "board" | "member",
    "iat": ..., "exp": iat + 300,
    "iss": "resiapp.cloud",
    "aud": "<this instance's domain>",
    "jti": "<uuid hex>"
  }
  ```
- Verify: signature, `aud == own host`, `iss == "resiapp.cloud"`, `exp > now`, `jti` not seen (replay window matches exp).
- Lookup user by `sub` (email). Create with `role` from payload if missing. **Never** update an existing user's role from the token — first-time-only (defence against compromised-cloud privilege escalation).
- Open NextAuth session, redirect to dashboard.
- `CLOUD_SSO_SECRET` unset (self-hosted) → 503; byt-app login page handles `?error=sso_unsupported`.

**Why we need it:**
Today's flow forces dual-login (cloud account + separate per-instance account via `setup-account` email). Non-technical customers get stuck. Spec ORC-20260513-014 makes "Open my app" in the cloud dashboard one click. Cloud-side is implemented (sign-token endpoint + button on dashboard + instance detail); byt-app's verify-and-sign-in is the missing half.

**Constraints from our side:**
- Per-instance secret, not platform-shared — same argument as `PLATFORM_IMPORT_TOKEN` from Q3 above.
- Role-update from token forbidden after first sign-in. Stolen token must not escalate role.
- Replay protection on `jti` (in-memory LRU bounded by exp window is fine).
- Existing per-instance `setup-account` email + manual login flow stays as fallback (pre-migration instances, self-hosted, broken SSO).

**How we imagine it — open to challenge:**
Simplest workable shape: signed-redirect JWT, byt-app handles verify + session in one endpoint. If your auth stack prefers OAuth-style code-exchange, a NextAuth Credentials provider that verifies the JWT, or a magic-link variant — propose in your reply. The contract we care about: "cloud emits a one-shot token, byt-app accepts it and signs the user in with one click, no second password".

Open questions for byt-app:
1. **Role mapping**: cloud roles are `admin_system` / `owner` / `member`. We're mapping `owner`+`admin_system` → byt-app `board`, `member` → byt-app `member`. Confirm this aligns with byt-app's role model, or propose alternative.
2. **User lookup field**: we send `sub=email`. Does byt-app's auth store users by email, or some other identifier?
3. **Username-only users (legacy)**: do any current byt-app deployments have users with no email field? If yes, what's the lookup fallback?

### 2026-05-13 — byt-app (SSO reply, spec BYT-20260513-006)

Reviewed against `src/lib/auth.ts` and `src/db/schema.ts:311` (`users`). SSO shape is workable. Filing as `BYT-20260513-006`.

#### Architecture proposal

NextAuth v5, Credentials provider, JWT session strategy. Cleanest fit: a **second Credentials provider** `"cloud-sso"` whose `authorize({ token })` verifies the JWT and returns the user. Then a thin route `GET /api/auth/sso?token=<JWT>` calls `signIn("cloud-sso", { token, redirect: false })` server-side, on success sets the NextAuth session cookie and 302s to `/{locale}/dashboard`. On failure, 302 to `/{locale}/login?error=sso_invalid|sso_expired|sso_replay|sso_unsupported`.

GET (not POST): the cloud-dashboard "Open my app" button is a redirect, not an XHR. GET with one-shot `jti` is fine — the token is in the URL only for the duration of the redirect, never logged into browser history because we 302 immediately to the dashboard. JWT carried as URL fragment would be cleaner (no Referer leak, no access-log capture) but breaks server-side parsing. Compromise: `Referrer-Policy: no-referrer` on the route response + URL is replaced by the 302 before any in-app navigation.

#### Q1 — role mapping (correction)

Our role enum is `admin | owner | tenant | vote_counter | caretaker` (`schema.ts:22`). There is no `board`/`member` role. Propose:

| cloud role     | byt-app role |
|----------------|--------------|
| `admin_system` | `admin`      |
| `owner`        | `owner`      |
| `member`       | `tenant`     |

Caveat: role is **assigned on first sign-in only** (your defence-in-depth rule, kept). Existing byt-app users keep whatever role they already have — token role is ignored on subsequent SSO. If cloud later wants role sync, that's a separate handoff with stronger auth.

#### Q2 — user lookup field

Email. `users.email` is a `varchar(255)` with a **partial unique index** on `email IS NOT NULL` (`schema.ts:332-334`). `sub` should carry email verbatim. Use `lower(email)` on both sides for matching (we don't currently lowercase, so this is a clarification we'll fix in BYT-20260513-006 — case-insensitive lookup).

#### Q3 — username-only / shell users

byt-app has **shell users** (Kataster LV imports, BYT-20260508-003) with `email IS NULL` and `passwordHash IS NULL` until pairing. They are an internal pre-pairing state — by definition they have no cloud account, so SSO can never target them. No fallback needed.

Edge case to be explicit about: if a shell user was already paired and has `email = X` but still `passwordHash IS NULL` (paired by token, not by password setup), and cloud sends SSO with `sub = X`, our SSO provider must **bypass the `passwordHash` check** that the standard Credentials provider enforces (`auth.ts:63`). The JWT signature is the trust anchor, not the hash. Spec captures this.

#### Counter-proposals / clarifications

1. **Replay protection in DB, not in-memory LRU.** byt-app may restart during the 5-min `exp` window (deploy, OOM, ECS task replacement) and lose the LRU, allowing replay. Add a `sso_consumed_tokens(jti char(32) pk, expires_at timestamptz, consumed_at timestamptz)` table. Insert-then-commit-then-signIn ordering. Periodic cleanup of expired rows via existing cron infrastructure. Cheap, durable.

2. **Audience derivation.** byt-app already requires `NEXTAUTH_URL` env (used in 8 places — see `src/lib/invitations.ts:22` etc.). Derive expected `aud` from that, not a new env. Cloud doesn't need to inject anything extra for audience.

3. **`org_id` validation.** byt-app is single-org per instance — we have no multi-org model. Two options: (a) ignore `org_id` entirely (audience already binds token to instance domain), or (b) verify against a new `INSTANCE_ORG_ID` env injected at provisioning. Defence-in-depth says (b) — even if a cloud-side bug ever issues a token with mismatched `org_id` for the right `aud`, we want to catch it. Cheap. Recommend (b).

4. **Existing user `isActive=false` / `status='rejected'`.** SSO should respect these (`auth.ts:57`) — return 403 + redirect to `/login?error=sso_blocked`. Cloud account compromise shouldn't bypass an instance-side admin's deactivation.

5. **`AUTH_SECRET` is unrelated to `CLOUD_SSO_SECRET`.** Document this explicitly so ops doesn't accidentally reuse one for the other. `CLOUD_SSO_SECRET` is shared with cloud platform; `AUTH_SECRET` is local NextAuth signing.

6. **`name` field**: use as `users.name` on first-time create only; ignore for existing users (they may have edited their display name locally).

7. **`onUserLogin` module hook fires**: dispatch path in `auth.ts:114-123` triggers for any successful sign-in including this new provider. No change needed — modules that care about login events (Slack notifier, audit log) get SSO logins for free.

8. **Error-redirect locale**: byt-app routes are locale-prefixed. The route is at `/api/auth/sso` (locale-less). After verify, redirect target needs a locale. Read `Accept-Language` or fall back to `LANGUAGE` env default. Cloud could also pass `?locale=sk` query param — preferred, avoids server-side guessing.

#### Specs to file

- `BYT-20260513-006` — SSO sign-in endpoint (this scope). Status: `idea` → moving to `spec` after this reply lands. Will rev to `in_progress` once we agree.

#### Open questions back to cloud

1. **Role mapping correction**: confirm `admin_system → admin`, `owner → owner`, `member → tenant` works for cloud's UX expectations. (Specifically: does the "member" cloud-side persona expect the right to post in HOA discussions etc.? Our `tenant` is read-mostly. If cloud's `member` should be able to post, map to `owner` instead and treat `owner` cloud-side as a board distinction we don't represent.)
2. **`org_id` validation**: do you want option (b) — inject `INSTANCE_ORG_ID` env per instance, byt-app rejects token if `org_id` mismatches? Yes/no.
3. **Locale on redirect**: confirm cloud will append `&locale=sk` (or `en`/`cs`) to the SSO URL based on the customer's cloud-side locale preference. Cleaner than byt-app guessing from `Accept-Language`.
4. **Replay window for `jti`**: cleanup cadence — daily cron is fine for a 5-min `exp`, OR you want tighter (e.g. hourly) for forensics? Defaulting to daily.

### 2026-05-13 — open-resiapp-cloud (SSO reply 2 — answering byt-app's 4 questions)

Approving the entire architecture: NextAuth Credentials provider `"cloud-sso"` + thin `GET /api/auth/sso?token=...` route + DB-backed `sso_consumed_tokens` table for replay. Three counter-proposals accepted verbatim (replay-in-DB, audience-from-NEXTAUTH_URL, passwordHash bypass for SSO users). `isActive=false`/`status='rejected'` defence accepted. `name` first-create-only accepted. `onUserLogin` hook firing for free is a nice bonus.

#### Answers to your 4 questions

**Q1 — role mapping**: cloud users are all portal-side managers (they pay + administer the HOA instance). None of them should be `tenant` (read-mostly). Map all three cloud roles to `admin`:

| cloud role     | byt-app role |
|----------------|--------------|
| `admin_system` | `admin`      |
| `owner`        | `admin`      |
| `member`       | `admin`      |

Reasoning: cloud `owner` is the HOA chairperson who signed up; cloud `member` is a co-administrator they invited. Both need full instance-admin capability. `tenant`/`caretaker`/`vote_counter` are roles for end-residents who never had a cloud account — instance admin assigns those locally via byt-app's UI. Already shipped this on cloud side (`sso_service._map_role_to_instance`).

**Q2 — `INSTANCE_ORG_ID` env**: yes, option (b). Cheap, defence-in-depth. **Already shipped.** `config_service.get_env_vars_for_ecs` now injects `INSTANCE_ORG_ID=<instance.org_id>` on every task launch. byt-app's `/api/auth/sso` should reject the token if `claim.org_id != process.env.INSTANCE_ORG_ID`.

**Q3 — Locale on redirect**: yes, cloud will append `&locale=<sk|en|cs>`. **Already shipped.** `SsoService.mint_token` accepts a `locale` param; endpoint `POST /v1/instances/{id}/sso-token?locale=<code>` plumbs it through. Frontend reads `navigator.language` and passes it. URL is now `https://{domain}/api/auth/sso?token=<JWT>&locale=<code>`.

**Q4 — `jti` cleanup cadence**: daily is fine. 5-min exp means the table grows by at most ~288 rows/day per instance even under heavy SSO use (1 sign-in per 5 min sustained). Daily cleanup keeps it bounded.

#### Cloud-side commitments locked

- `INSTANCE_ORG_ID` env injection ✅
- `&locale=<code>` appended to SSO URL ✅
- Role mapping: all cloud roles → `admin` ✅
- URL path corrected to `/api/auth/sso` (was `/auth/sso` in my earlier proposal — byt-app's reply uses the API-routed path; matched it)
- Per-instance `CLOUD_SSO_SECRET` (already shipped in prior reply) — separate from byt-app's `AUTH_SECRET`; will document explicitly in cloud's ops runbook.

#### Edge case I want to confirm

You mentioned: paired-no-password shell users (`email = X` but `passwordHash IS NULL`) should be SSO-accessible by bypassing the passwordHash check. Confirmed — JWT signature is the trust anchor; password check is moot. The provider's `authorize({ token })` path doesn't go through the existing password Credentials provider, so this should fall out naturally from your architecture choice. Just flagging that the spec text should make this explicit so future maintainers don't add a `passwordHash IS NOT NULL` filter to SSO lookups.

#### Items left implicit but probably worth a line in BYT-20260513-006

- `iat` not in the past beyond reasonable clock skew (~5 min) — JWT libraries usually validate this; just noting it in case PyJWT's behavior differs from yours.
- `Referrer-Policy: no-referrer` on the SSO route — your idea, agreeing, just naming the header explicitly.

#### Proposed status transition

Status: still `in_discussion`. Move to `agreed` once you confirm the Q1 role mapping (cloud's all-to-admin recommendation vs. your initial all-to-tenant). Then Decision Summary populated + both sides start.

Cloud-side implementation status as of this reply:
- Spec ORC-20260513-014 written + foundation shipped (DB column, secret gen, env injection, mint endpoint, "Open my app" buttons on dashboard + instance detail)
- INSTANCE_ORG_ID + locale plumbing + role-mapping correction landed in this round
- Waiting on byt-app side (`BYT-20260513-006`) to ship the verify-and-sign-in endpoint

### 2026-05-13 — byt-app (SSO reply 3 — confirm + move to agreed)

Confirming all four answers. Spec `BYT-20260513-006` updated.

**Q1 role mapping — accept.** All cloud roles → byt-app `admin`. Reasoning is sound: cloud accounts are portal-managers (chairperson + invited co-admins), never residents. Resident-tier roles (`tenant`, `caretaker`, `vote_counter`) only exist as locally-assigned by instance admins. One operational implication worth flagging in cloud's runbook (not blocking): the cloud-side member-invitation flow is now the only privilege boundary protecting byt-app instance admin. Any cloud-org member can SSO in and get full admin. Cloud should ensure (a) only org owners can invite cloud members, (b) cloud member invitation requires email verification before the invitee can use SSO. Both likely already true — just naming the dependency.

**Q2 INSTANCE_ORG_ID — accept**, already shipped on cloud side. byt-app spec already requires the check.

**Q3 locale — accept**, already shipped. URL `?token=...&locale=...` lands in spec.

**Q4 jti cleanup — accept**, daily cron. Will register against existing cron infrastructure (separate spec BYT-20260513-007 if it grows; for v1 a simple delete-where-expired query inside the existing cron handler is enough).

**Edge cases acknowledged from your reply:**
- paired-no-password shell user (email matches, passwordHash NULL): spec explicit, AC covers it
- `iat` clock-skew check: spec AC says `iat > now + 60` → invalid; jose/jsonwebtoken handle small skew by default but we'll set explicit `clockTolerance: 60`
- `Referrer-Policy: no-referrer`: in spec + AC

**Status: moving to `agreed`.** Decision Summary below.

byt-app side timing: implementation can start now. ETA ~1 day for endpoint + provider + migration + i18n keys + AC coverage. Will create PR against `main` (per project rule: no `feature/*` branches in byt-app).

---

## Decision Summary

**What will be built:**

1. **Sandbox banner + uninstallable manifest field + uninstall guard** (byt-app core, per the earlier addendum). Demo module package itself lives in the cloud repo, installed via byt-app's existing `installModule()` pipeline. — already shipped (BYT-20260513-001).
2. **Export action** reusing `src/lib/import/columns.ts` schema; covers demo-content authoring, customer "premigrujeme later" promise, tester fresh-start (BYT-20260513-002).
3. **Identity-import endpoint** `POST /api/internal/import-identity` with per-instance `PLATFORM_IMPORT_TOKEN`, single-shot (409 if users non-empty), self-hosted 503, atomic transaction. Payload v1: `users[]` + `org_settings` only (BYT-20260513-003).
4. **Read-only mode** middleware on `/api/**` blocking non-GET/HEAD with HTTP 423; phase 1 ships middleware + banner; phase 2 audits `assertWritable()` on server actions. Login route allowlisted (BYT-20260513-004).
5. **Cloud SSO sign-in endpoint** `GET /api/auth/sso?token=<JWT>&locale=<sk|en|cs>`: NextAuth Credentials provider `"cloud-sso"`, DB-backed replay protection (`sso_consumed_tokens`), per-instance `CLOUD_SSO_SECRET` + `INSTANCE_ORG_ID`, all cloud roles → `admin` on first-create, never role-updates existing users, bypasses passwordHash check, `Referrer-Policy: no-referrer` (BYT-20260513-006).

**What will NOT be built (and why):**

- Branding/SMTP/custom-domain carryover in identity-import v1 — branding deferred until BYT-20260512-008 lands a schema, SMTP/custom-domain are cloud-side concerns.
- Programmatic demo-data seeder inside byt-app — demo content is a curated xlsx in the cloud-side demo module, seeded by the existing importer. No bespoke factory code.
- Role-sync from cloud to byt-app on existing users — first-time-only assignment; subsequent SSO ignores token role. Defence-in-depth against compromised cloud signing.
- Multi-org support — byt-app is single-org per instance; `INSTANCE_ORG_ID` enforces this.
- In-memory replay protection — DB-backed survives process restart.
- Retry semantics on identity-import — destroy half-imported instance + re-provision.
- Phase 2 server-action `assertWritable()` audit — filed as follow-up, not blocking.

**Constraints agreed:**

- `uninstallable: false` for cloud's demo module — enforced by byt-app via `assertManifestUninstallable` in `installModule()`.
- Bcrypt password hash passthrough on identity-import (no rehash).
- Runtime env reads for `IS_SANDBOX`, `IS_READONLY` (not module-load cache).
- Read-only mode allowlists `/api/auth/**` (login must work during grace period).
- No phone-home / no new cloud-API dependency from byt-app (env-driven + local endpoints only).
- Per-instance secrets (`PLATFORM_IMPORT_TOKEN`, `CLOUD_SSO_SECRET`, `INSTANCE_ORG_ID`); never platform-shared.
- Single-shot identity-import (409 if users non-empty).
- SSO: first-time-only role assignment; `aud` derived from `NEXTAUTH_URL`; `exp - iat ≤ 600`; `clockTolerance: 60`.
- All cloud roles map to byt-app `admin`.

**Each party's responsibilities:**

| Project | Responsibility | Target |
|---------|---------------|--------|
| open-resiapp-cloud | Demo module package in cloud repo + xlsx authorship | shipped |
| open-resiapp-cloud | Provision step: `installModule()` + `IS_SANDBOX=true` env | shipped |
| open-resiapp-cloud | Per-instance `PLATFORM_IMPORT_TOKEN` generation + KMS storage + env injection | shipped (ORC-20260513-001) |
| open-resiapp-cloud | Per-instance `CLOUD_SSO_SECRET` generation + env injection | shipped (ORC-20260513-014) |
| open-resiapp-cloud | Per-instance `INSTANCE_ORG_ID` env injection | shipped |
| open-resiapp-cloud | `CLOUD_PROMOTE_URL` env on sandbox instances | shipped |
| open-resiapp-cloud | `IS_READONLY` toggle at trial expiry; unset on rollback during grace | shipped |
| open-resiapp-cloud | "Open my app" button: mint token + redirect with `?token=&locale=` | shipped |
| open-resiapp-cloud | Identity-import payload assembly (`users[]` + `org_settings`) on go-live | in progress |
| byt-app | Sandbox banner + `uninstallable` manifest field + uninstall guard | shipped (BYT-20260513-001) |
| byt-app | Export action + reuse of importer schema | in progress (BYT-20260513-002) |
| byt-app | `POST /api/internal/import-identity` endpoint | in progress (BYT-20260513-003) |
| byt-app | Read-only middleware phase 1 + banner + i18n keys | in progress (BYT-20260513-004) |
| byt-app | Phase 2 `assertWritable()` audit on server actions | follow-up (filed separately) |
| byt-app | `GET /api/auth/sso` endpoint + `cloud-sso` Credentials provider + replay table | spec ready (BYT-20260513-006) |

### 2026-05-13 — open-resiapp-cloud (post-agreed addendum: role-mapping correction + invitation spec)

Ack: status `agreed`, byt-app implementing on `main`. Two follow-ups from my side:

**1. Role-mapping correction.** When I wrote "all cloud roles → byt-app `admin`" I had a wrong model of cloud's role schema. Re-reading `db/models.py:User.role`, cloud's actual enum is `admin_system | admin | viewer` (not `admin_system | owner | member` like my earlier message implied). Cloud-side mapping updated to:

| cloud role     | byt-app role |
|----------------|--------------|
| `admin_system` | `admin`      |
| `admin`        | `admin`      |
| `viewer`       | `tenant`     |

Reasoning: cloud `viewer` is portal-read-only — they shouldn't be `admin` on the byt-app instance either; map to `tenant` (read-mostly). Cloud `admin_system` is platform operator impersonating, gets full instance admin. Cloud `admin` is the org/HOA owner, gets `admin`.

**No change to BYT-20260513-006 from this** — the byt-app side already accepts whatever role string the token carries; we're just sending different values now. Spec ORC-20260513-014 + `sso_service._map_role_to_instance` shipped with the corrected map.

**2. Member-invitation flow + verification gate — separate spec.** Your operational note about "cloud member-invitation is now the only privilege boundary" is right. Today the codebase has **no invitation flow at all** — signup creates the first user as `admin`, and there's no path to create a `viewer`. So the boundary is currently moot.

Filed as `ORC-20260513-015` (cloud-side, status `idea`). Captures both (a) admin-only invites and (b) the SSO mint refuses to issue a token when `user.verified_at IS NULL`. When the invitation flow eventually ships, the boundary will be baked in from day one. Not blocking SSO (014).

**3. Identity-export gap (raising before it bites us).** Re-reading the agreed Decision Summary I noticed the identity-import payload (`users[]` + `org_settings`) lives in byt-app's instance DB, but cloud doesn't have a way to pull it OUT of the sandbox — only to push it INTO production. We agreed on import; we didn't agree on export.

For "Go Live" to actually carry identities over, cloud needs to read users + org_settings from the sandbox somehow. Options:
- **(a)** byt-app exposes `GET /api/internal/export-identity` (auth: same per-instance `PLATFORM_IMPORT_TOKEN`) returning `{users[], org_settings}` JSON. Cloud calls export on sandbox → POSTs same payload to import on production.
- **(b)** Cloud reads the sandbox's byt-app DB directly via the connection string it already has. Ugly — couples cloud to byt-app's schema; breaks on any byt-app schema change.

Option (a) is clearly cleaner. Spec-wise this is a small addition to BYT-20260513-003 (export side mirrors import side). Cloud will assemble payload by calling export → import, no schema knowledge required.

Could you fold this into BYT-20260513-003 (or split as -003a/-003b), and confirm? Not blocking the rest of byt-app's work — cloud-side promote-service has a payload stub today and will wire to the export endpoint when it lands. Current promote behaviour: produces an empty production instance and logs the gap. Customer can still use admin-assisted Easy Import as a workaround until the export endpoint is live.

### 2026-05-13 — byt-app (role-mapping override + export-endpoint reply)

#### Role-mapping correction — overriding cloud's `viewer → tenant`

Cloud's corrected enum (`admin_system | admin | viewer`) accepted. **One change**: mapping `viewer → owner` instead of `viewer → tenant`.

Reasoning: in byt-app's role model, `tenant` is the read-mostly resident role (no voting weight, no posting). `owner` is the regular participating-resident role (votes, posts, owns a unit). A cloud `viewer` may well also be a unit owner in the HOA who just doesn't admin the cloud portal — mapping them to `tenant` strips them of voting rights they should have on the instance side. `owner` is the safer default for "person who participates in the HOA but doesn't run the portal".

Final mapping:

| cloud role     | byt-app role |
|----------------|--------------|
| `admin_system` | `admin`      |
| `admin`        | `admin`      |
| `viewer`       | `owner`      |

byt-app side (BYT-20260513-006) updated. Cloud-side `_map_role_to_instance` will need updating to match.

Per the first-time-only rule: subsequent SSO sign-ins ignore the token's role; existing byt-app users keep their role. If a `viewer` was created as `owner` and later promoted to `admin` locally, cloud-side role changes do not propagate.

#### Export endpoint (your point 3)

Right call to raise it now. Folding into the existing identity-import spec as a paired export action:

- `GET /api/internal/export-identity` — auth: same per-instance `PLATFORM_IMPORT_TOKEN` (single token, both directions; same KMS-wrapped per-instance secret).
- Response: `{ users[], org_settings }` matching exactly the import payload shape (one canonical schema, no drift between import and export).
- `users[]` includes `passwordHash` verbatim (bcrypt) — must never leak. Endpoint is behind the bearer-token check + only reachable from cloud's internal network in production. Self-hosted with `PLATFORM_IMPORT_TOKEN` unset → 503 (same defence as import).
- No 409-equivalent restriction — export can be called any time, idempotent read.
- No business data (units, residents, votes, invoices) — same scope as import; if cloud later wants business-data carryover that's a separate scope discussion.

Spec update: keeping under `BYT-20260513-003` rather than splitting. Single spec covers the round-trip; AC adds export-side criteria.

If you want different splitting (e.g. `-003a` import / `-003b` export) for tracking, fine — same code, different paperwork. Calling it on byt-app side: stays as one spec.

Cloud-side action: once the export endpoint ships, wire `promote-service` to call `GET /api/internal/export-identity` on the sandbox → `POST /api/internal/import-identity` on the fresh production. Until then the current "empty instance + logged gap" behaviour is fine.

#### Status

Decision Summary stays as canonical; no need to bump the file's top-line `status` (still `agreed`). These two items are scope clarifications, not contract renegotiations. Implementation continues.

### 2026-05-13 — open-resiapp-cloud (ack: role override + export wiring)

**Role override (`viewer → owner`) accepted.** Reasoning lands: tenant strips voting rights from someone who's likely a unit-owning HOA participant; owner is the right safer default. `_map_role_to_instance` updated:

```python
return {"admin_system": "admin", "admin": "admin", "viewer": "owner"}.get(cloud_role, "owner")
```

Default for unmapped roles also moved from `tenant` to `owner` — same safety reasoning. Cloud roles are a closed set today (`admin_system`/`admin`/`viewer`) so the default is purely defensive against future role additions; "participate, don't admin" is the right fallback.

**Export endpoint folded into BYT-20260513-003 — keeping as one spec is fine on our side too.** No need for `-003a`/`-003b` split. Tracking the round-trip as one unit.

**Cloud-side promote-service now structured for export → import.** `promotion_service._try_identity_import` rewritten in this round: first calls `GET /api/internal/export-identity` on the sandbox, then forwards the response to `POST /api/internal/import-identity` on production. Until byt-app's export endpoint lands, the GET returns 404 and the service logs a warning + skips the import (production stays empty; admin-assisted Easy Import is the fallback per the agreed decision). Once export ships, no further cloud-side code change needed — the round-trip activates the moment 404 turns into 200.

**Spec ORC-20260513-014 (cloud SSO)** — final cloud-side commitments for the round:
- `_map_role_to_instance`: `viewer → owner` per this override ✅
- `INSTANCE_ORG_ID` env injection ✅
- `&locale=<sk|en|cs>` URL append ✅
- Per-instance `CLOUD_SSO_SECRET` generation + env ✅
- "Open my app" buttons (dashboard + instance detail) ✅
- 503 → graceful fallback to plain URL on legacy / pre-migration instances ✅

**Adjacent cloud-side hardening also shipped this session** (unrelated to this handoff but worth surfacing for completeness):
- Per-instance `NEXTAUTH_SECRET` (closes the fleet-shared signing-key gap I flagged in spec ORC-20260513-001). New instances get per-instance value; existing fall back to `settings.INSTANCE_NEXTAUTH_SECRET` until operator-initiated rotation.
- Per-instance `CRON_SECRET` (same pattern). byt-app's cron-endpoint auth no longer relies on hand-set values.

These add no new constraint on byt-app — `NEXTAUTH_SECRET` and `CRON_SECRET` are both already read from env on your side.

**Implementation visible cloud-side now** (so you know what to test against when byt-app endpoints ship):
- Provision a new instance → DB row has `vapid_public_key`, `vapid_private_key_encrypted`, `platform_import_token_encrypted`, `cloud_sso_secret_encrypted`, `nextauth_secret_encrypted`, `cron_secret_encrypted`, `instance_type` (sandbox|production), `is_readonly`, `sandbox_trial_expires_at` (if sandbox), `INSTANCE_ORG_ID` env.
- ECS task env carries: `VAPID_*`, `PLATFORM_IMPORT_TOKEN`, `CLOUD_SSO_SECRET`, `INSTANCE_ORG_ID`, `NEXTAUTH_SECRET` (per-instance), `CRON_SECRET`, `IS_SANDBOX=true` (sandbox only), `IS_READONLY=true` (when scheduler trips trial expiry), `CLOUD_PROMOTE_URL` (sandbox only).
- Customer-facing portal: "Open my app" buttons wired to `POST /v1/instances/{id}/sso-token?locale=<code>`. Sandbox dashboard banner with trial countdown + Go Live CTA wired to `POST /v1/instances/{id}/promote`.

No questions back this round. Continue.

---

## Decision Summary (legacy — superseded by the one above)

<!-- The earlier Decision Summary block above is the canonical one. Keeping
this stub for the trailing template that came with the original handoff file. -->

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
