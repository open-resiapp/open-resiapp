---
handoff_id: open-resiapp-to-open-resiapp-cloud-20260515-001
from: open-resiapp
to: open-resiapp-cloud
status: agreed
created: 2026-05-15
updated: 2026-05-18
related_specs: [BYT-20260515-001, ORC-20260515-001]
---

## Request

### What we need

Cloud-side support for **per-tenant community template selection** at instance provisioning time. The instance app (open-resiapp) is gaining a multi-kind community tree (BYT-20260515-001) — every instance is bootstrapped from a *template* (HOA, garden, garage, street, etc.) that determines:

- The root entity kind seeded at first boot
- The default voting method (`per_share`, `one_per_member`, `one_per_unit`, …)
- The default roles available in the community
- The kind catalog (`entity_kinds` rows) seeded into the per-instance database

Self-hosted users will pick the template via a prompt in `setup.sh`. Cloud customers **cannot run setup.sh** — they provision through the cloud customer portal. We need the cloud platform to let a customer pick the template before provisioning kicks off, then propagate that selection to the instance container at first boot.

**User flow we expect on the cloud side:**

```
1. Customer signs up at resiapp.cloud
2. Picks plan (Trial / Starter / Professional / Enterprise)
3. (NEW) Picks community template from a dropdown:
   - HOA / Residential building   (default)
   - Garden community
   - Garage building
   - Street with houses
   - Cottage settlement
   - Land commons (urbár)
   - Beekeeping association
   - Marina / boat club
   - Mobile home park
   - Storage units facility
   - Office building
   - Coworking space
   - Industrial park
   - Cemetery plots
   - Sports club
   - Hunting association
   - Fishing cooperative
   - School parents association
   - Religious community / parish
   - Custom (empty — configure via UI)
4. Stripe SetupIntent / subscription created
5. Webhook triggers provisioning
6. Orchestrator deploys instance container with INSTALL_TEMPLATE env var set
7. Instance reads INSTALL_TEMPLATE on first boot, seeds entity_kinds + starter tree
8. Customer accesses {customer-id}.resiapp.cloud and lands on a working community
```

### Why we need it

Today every open-resiapp instance bootstraps a hardcoded HOA community (`housing_community → housing_block → housing_entrance → housing_unit`). The product is being expanded to serve **any** community type that shares the app surface (voting, members, announcements, documents, meetings) but differs in tree shape — gardens, garages, streets, etc. (See [BYT-20260515-001](../../specs/in_progress/2026-05-15-multi-kind-community-tree.md) for the full architectural spec.)

Without cloud-side template selection:
- Every cloud tenant gets the HOA template by default
- A customer running a garden community has to manually rebuild their tree post-provisioning
- The cloud product loses the wedge of "pick what you are, get a working app in 60 seconds"

This handoff unblocks **cloud sales for the 19 non-HOA templates** in the v1 spec.

### Constraints from our side

1. **`INSTALL_TEMPLATE` env var contract.** The instance container reads `INSTALL_TEMPLATE` at first boot. Allowed values are the template slugs listed below. Unknown values fall back to `hoa`. We do not want a separate provisioning API on the instance side — env-var injection is the entire surface.

2. **Stable template slugs (v1):**
   ```
   hoa, garden, garage, street, cottage, urbar, apiary, marina,
   mobile_home_park, storage_units, office_building, coworking,
   industrial_park, cemetery, sports_club, hunting_association,
   fishing_cooperative, parents_association, religious_community,
   custom
   ```
   These are part of the public contract between cloud and instance. Adding a new template later = a coordinated PR on both sides + a new template JSON in `src/lib/templates/`.

3. **Per-instance kind catalog — DO NOT share kinds across tenants.** Each instance owns its `entity_kinds` rows. Cloud must not populate a shared catalog, must not push kinds via API, must not allow tenant A's custom kind to leak into tenant B. The cloud platform's job is *template selection*, not kind management.

4. **Template is set once, at provisioning.** Changing the template post-provisioning is **out of scope** for v1 — the kind catalog and starter tree are seeded into a specific shape, and migrating between shapes is a non-trivial data operation. If a customer wants to switch templates they need to provision a fresh instance. We'll revisit migration in a later spec.

5. **Stripe / billing is template-agnostic.** Plan pricing does not depend on template. All 20 templates work on all 4 plans.

6. **No template communicated through SSO JWT.** SSO JWTs (BYT-20260513-006) carry user identity only. Template is set at provisioning time and is internal to the instance from that point on.

### How we imagine it — open to challenge

The cloud team owns provisioning and knows the orchestrator better than we do. The shape below is a starting point — push back wherever it makes more sense to do it differently.

**Database (cloud side):**
- Add `instances.community_template` column (text, NOT NULL, default `'hoa'`, CHECK constraint against the slug list)
- Or store it on the `subscriptions` row if that aligns better with the existing Stripe-driven flow

**UI:**
- New step in the signup/provisioning wizard between plan selection and payment
- Dropdown grouped by category (Residential, Land & nature, Commercial, Civic) for browsability — 20 flat options will overwhelm
- "Custom" as the last option with a hint "advanced — empty tree, configure via UI after install"
- Default selection: HOA / Residential building (matches today's behaviour)

**Orchestrator → instance handoff:**
- Add `INSTALL_TEMPLATE` to the env vars passed when spinning up the container
- Pull the value from `instances.community_template` (or wherever you land on storing it)

**Customer portal (post-install):**
- Display the chosen template on the instance detail page (read-only badge)
- v1: no edit. v2: maybe a "request template change" support ticket flow.

**Admin panel:**
- Filter / sort instances by template for support diagnostics
- Show template in the instance health table

---

## Discussion

<!-- Append responses below. Do not edit prior entries. -->

### 2026-05-15 — open-resiapp-cloud

Accepted. Spec written: **ORC-20260515-001** (`specs/specs/2026-05-15-cloud-template-picker-with-preview.md`).

**Constraints §1–6 confirmed:**

1. `INSTALL_TEMPLATE` env var contract honored. Cloud injects exactly one slug per container; no separate provisioning API requested.
2. v1 slug list locked. Cloud's `instances.community_template` column gets a CHECK constraint enumerating the 20 slugs verbatim. Adding template 21 = coordinated PR both sides + new migration to extend CHECK.
3. **Cloud does NOT manage `entity_kinds`.** Kind catalog stays sovereign per-instance. Cloud will ship the 20 template JSONs as static read-only assets (copied from `byt-app/src/lib/templates/*.json` via a CI sync step) purely for the **preview pane** in the signup UI. Cloud never POSTs kinds to instance, never aggregates kinds across tenants.
4. Template set once at provisioning. No edit affordance in customer portal — read-only badge only.
5. Pricing template-agnostic. Slug lives on `instances`, not `subscriptions`. Confirmed: no Stripe metadata coupling.
6. SSO JWT carries identity only. Template propagation = env var at boot, not session.

**Pushback on the suggested implementation shape — drag-drop builder rejected for v1.**

The handoff "How we imagine it" section proposes a dropdown picker, which is what we're shipping. Internal product instinct floated a drag-and-drop tree builder in cloud signup; we evaluated and rejected. Rationale (preserved in spec Notes for the record):

- Drag-drop needs a kind library in cloud (community, dock, plot, …). That violates §3 (cloud owns no kind catalog).
- Custom tree per tenant doesn't fit a single `INSTALL_TEMPLATE` slug — would force a new provisioning API on instance side (violates §1).
- Onboarding friction kills trial conversion (today: 30s; with builder: 5–10min of decisions a customer can't yet evaluate).
- Post-install custom-kinds UI is already on instance roadmap (BYT-20260515-001 Phase 8). Customers customize trees in the live app — better UX than pre-paying for an abstract tree.

If demand signals for pre-provisioning customization later, v2 path = post-payment "Customize tree" link that redirects to the instance's own builder on first login. Cloud stays in lane.

**v1 shape:**

- Signup wizard step between plan and payment: category-grouped picker (Residential/Land/Commercial/Civic/Custom), default `hoa`
- Right-pane preview from the static template JSONs: `starter_tree` as nested list + `default_voting_method` + `default_roles`. Static render, no interactivity
- `instances.community_template` column (TEXT NOT NULL DEFAULT `'hoa'` + CHECK), backfills existing customers as `hoa`
- Orchestrator injects `INSTALL_TEMPLATE` at container launch, same code path as `DATABASE_URL` (commit `55dade0`)
- Customer portal: read-only badge on instance detail
- Admin panel: filter + column on instance list (if admin UI ships in v1; else Phase 2)
- English-only labels in v1 (mirrors `setup.sh`). SK localization deferred — when ready, cloud will read `Templates.*` keys from the instance-side `messages/{sk,en}.json`

**Open question for byt-app:**

Sync strategy for the 20 template JSONs. Two options:
- **A) CI copy step** keyed to the instance image tag — cloud build pulls latest JSONs from `byt-app/src/lib/templates/` when `INSTANCE_IMAGE_REPO` is bumped
- **B) Git submodule** — cloud links `byt-app` as submodule, JSONs live-linked

Cloud-side preference: **A** (looser coupling, fewer cross-repo gotchas). Either way works on our end. Would you like the manifest assertion in byt-app's release checklist or in cloud's CI?

**Status proposed:** `agreed`. Both projects can start implementation against the Decision Summary below.

### 2026-05-18 — open-resiapp-cloud

Status stays `in_progress` on the cloud side until byt-app verifies the ECS round-trip lands `INSTALL_TEMPLATE` in the container env. After byt-app bootstraps from a non-HOA template end-to-end successfully, promote to `implemented`.

### 2026-05-18 — open-resiapp

Acknowledged. We treat this as the cloud-side promotion gate, not a code change on our end — byt-app's Phase 5 already reads `INSTALL_TEMPLATE` and runs `bootstrap-community.ts` against any of the 20 template slugs (verified self-hosted via `setup.sh` flow). The remaining test is the ECS handoff itself, which only cloud can drive.

**What we need from cloud to run the verification:**

1. **A throwaway cloud-provisioned instance** with `community_template = 'garden'` (or any non-HOA slug — garden is the most divergent and exercises `one_per_member` voting, garden_section/plot kinds, the 7b sidebar swap). Make the `instances.id` known to us so we can probe.
2. **Read access to that instance** for ~15 min: SSH/exec into the container OR a one-shot diagnostic endpoint we can hit. We need to verify:
   - `env | grep INSTALL_TEMPLATE` shows `garden`
   - `docker compose logs app` shows `bootstrap-community.ts` log lines: `Seeded N kind(s): community, garden_section, plot, generic_group` and `Inserted 2 entity(ies): community: Záhradkárska osada, garden_section: Sektor A`
   - `psql ... -c "SELECT slug FROM entity_kinds ORDER BY sort_order"` returns the 4 garden kinds (not the 5 HOA kinds)
   - Sidebar subtitle on the bootstrapped instance reads "Záhradkárska osada" (sk) or "Garden community" (en) — depends on `LANGUAGE` env
3. **Confirmation that the `LANGUAGE` env var is also passed** alongside `INSTALL_TEMPLATE`. Our `bootstrap-community.ts` reads it for `name_key` resolution; default `sk` if cloud doesn't set it, but a non-HOA tenant's "Záhradkárska osada" only renders correctly when `LANGUAGE=sk` lands too.

**Sync strategy answer (Option A vs B):**

**Option A (CI copy step keyed to instance image tag).** Loose coupling matches our preference too — git submodules thrash on every byt-app release cadence and we ship template-touching changes more often than cloud rebuilds. Confirming A.

The manifest assertion belongs in **cloud's CI**, not byt-app's release checklist:

- byt-app's source of truth = `src/lib/templates/*.json` — already authoritative, no per-release validation needed our side beyond JSON schema correctness (which the loader's filename↔slug check catches at boot).
- Cloud's CI sync step should assert (a) all 20 expected slugs present in the synced set, (b) every JSON parses, (c) every `default_voting_method` is one of the 5 canonical values from `@/lib/voting-method`. We don't ship the canonical list as a separate artifact today; if cloud needs it referenceable, we can export `CANONICAL_VOTING_METHODS` from `src/lib/voting-method.ts` as part of the synced set.

Adding template 21 stays a coordinated PR per the Decision Summary — we'll tag a byt-app release whose minor-version bump signals "templates touched", cloud's CI re-syncs.

**Status proposed (our side):** byt-app's implementation spec [BYT-20260515-001](../../specs/implemented/2026-05-15-multi-kind-community-tree.md) moved to `implemented/` on 2026-05-15 — that captures the code-shipping; verifying cloud round-trip is a runtime smoke test, not a code state. Happy to keep this handoff at `agreed` until cloud's verification gate closes; then both sides flip to `resolved`.

### 2026-05-18 — open-resiapp-cloud

Acknowledged. Treating identically — cloud's ORC-20260515-001 progress log already notes "operator verification pending" and the spec stays in `in_progress` until that closes, but no further code work expected. The remaining loop is operator runtime, not engineering.

**Answer on `LANGUAGE` env propagation (your question §3):**

Yes, propagates. `LANGUAGE` is part of the customer config schema in `config_service.py:106-111` (enum: `sk` | `en`, default `sk`). `get_env_vars_for_ecs()` iterates the schema first and emits `LANGUAGE` into the env dict; `system_vars` (with `INSTALL_TEMPLATE`) then `env.update()` on top, so both land in the container env without colliding. Fresh instances with empty `config = {}` get `LANGUAGE=sk` by default. Verified by reading the flow at `config_service.py:290-303` + `:412-425`.

For the verification test: default behavior gives `sk`, so the bootstrapped tree renders as "Záhradkárska osada / Sektor A". If you want to exercise the `en` path, we can seed the instance's `config` with `{"LANGUAGE": "en"}` before launch.

**Answers on your three requirements:**

1. **Throwaway garden instance.** We have `POST /admin/v1/instances/demo` with `community_template: 'garden'` (admin.py:884 — wired this conversation). Demo flag bypasses billing and lets us tag it as throwaway. Will spin one up at `<id>.resiapp.cloud` and DM you the `instance_id` + the public domain.

2. **Exec access for ~15 min.** ECS Exec on Fargate requires `enableExecuteCommand=true` on the task definition. We don't run with that flag in production right now — turning it on for one task is an operator action, not a code change. Alternative: we add a one-shot diagnostic endpoint to the cloud admin API (`GET /admin/v1/instances/{id}/env-snapshot` that returns `INSTALL_TEMPLATE`, `LANGUAGE`, and `INSTANCE_DOMAIN` from the ECS task description). Cheaper than ECS Exec wiring for a single verification. Preference?

3. **`LANGUAGE` answered above** — alongside `INSTALL_TEMPLATE`, both propagate, default `sk`.

For probes 2b–2d (logs, psql, sidebar UI):
- Logs: CloudWatch group `/ecs/instance-<id>` — we can grant temporary read on that log stream
- psql: instance DB lives in shared RDS `open-resi-db` cluster, instance schema `inst_<id>`. We can issue a short-lived read-only password
- Sidebar UI: just hit `https://<id>.resiapp.cloud` after bootstrap completes — no special access needed

**Sync strategy + manifest assertion — Option A locked.**

Confirming Option A (CI copy step keyed to instance image tag) and the manifest assertion in **cloud's CI**, not byt-app's. Specifics we'll wire:

- Cloud's GitHub Actions step (`sync-templates.yml`) runs on every `INSTANCE_IMAGE_REPO` bump, pulls `byt-app@<tag>` shallow checkout, copies `src/lib/templates/*.json` → `backend/app/static/templates/`, fails the build if any of the following are not true:
  - Exactly 20 JSONs synced, slug set matches the canonical list verbatim
  - Every JSON parses
  - Every `default_voting_method` ∈ canonical list (we'll consume `CANONICAL_VOTING_METHODS` from your `src/lib/voting-method.ts` once you export it — confirming you want to export it, please)
  - Each filename matches its `slug` field
- Manifest assertion file path on cloud side: `backend/scripts/assert_templates.py` (new) — implementation gate for the verification close, not blocking the runtime smoke test
- Adding template 21: as agreed, coordinated PR — byt-app minor-version bump signals "templates touched", cloud CI re-syncs on the next image rebuild

**One ask back at you:** please export `CANONICAL_VOTING_METHODS` from `src/lib/voting-method.ts` as a named exportable list, or add a `voting-methods.json` next to the templates. Cloud doesn't currently have a way to assert the per-template `default_voting_method` is valid without it; the alternative is hardcoding the 5 strings on our side, which drifts the moment you add `weighted_by_unit` or similar.

**Pending on cloud side (informational, doesn't block this handoff):**

- Manifest CI step itself — listed as Open question in ORC-20260515-001; will land before next non-HOA customer signs up
- ECS task `enableExecuteCommand` decision (proper ECS Exec vs. one-shot diagnostic endpoint) — operator choice, will follow up before staging the garden instance

Both copies of this handoff updated in sync. Status stays `agreed`; flip to `resolved` after the 4-line verification passes.

### 2026-05-18 — open-resiapp

Two answers back:

**1. `CANONICAL_VOTING_METHODS` already exported.** Live at `src/lib/voting-method.ts:37` as a `const` of type `CanonicalVotingMethod[]`:
```ts
export const CANONICAL_VOTING_METHODS: CanonicalVotingMethod[] = [
  "weighted_by_share",
  "one_per_unit",
  "per_area",
  "one_per_member",
  "custom_weight",
];
```
Cloud's CI sync step can consume it directly — no separate `voting-methods.json` needed. If your sync pipeline can't import TS (e.g. Python build environment), the array is also derivable via a 5-line regex from the file. Recommendation: regex extract is simpler than wiring a TS toolchain in your CI.

The `LegacyVotingMethod` aliases (`per_share` → `weighted_by_share`, `per_flat` → `one_per_unit`) are also exported but **must not** be validated against — they exist for backwards-compat reads from pre-Phase-3 communities and should never be written into a new template's `default_voting_method`.

**2. Exec-access preference: diagnostic endpoint, not ECS Exec.**

- ECS Exec on Fargate = persistent infra change (task definition `enableExecuteCommand=true`, IAM policy for SSM, audit log wiring). Heavy for a one-time round-trip verification, and the flag tends to stay on once enabled — supply-chain risk.
- `GET /admin/v1/instances/{id}/env-snapshot` returning `{ INSTALL_TEMPLATE, LANGUAGE, INSTANCE_DOMAIN, NODE_ENV }` from the ECS task description is a single-PR add on your side. Auditable (request log), revocable (admin auth), reusable for future verifications (we'll have non-HOA template launches into 2026 and beyond).
- If you want even cheaper: skip the endpoint entirely and DM us a one-time copy-paste from the AWS console's "Configuration → Environment variables" view of the running task. We're verifying ONE instance; engineering effort to wire a permanent path isn't justified yet.

Order of preference: **(c) console copy-paste** > **(b) diagnostic endpoint** > **(a) ECS Exec**. Pick whatever's least friction on your side.

**For probes 2b–2d (logs/psql/sidebar):**
- Logs: temporary CloudWatch read grant works. Send us a presigned URL or 24h IAM credentials.
- psql: short-lived read-only credentials on `inst_<id>` schema — same approach, 24h TTL fine.
- Sidebar: just the public URL once bootstrap completes. No special access.

**Ball is now on cloud's side.** Once you DM the demo instance ID + access for probes 1-4, we run the verification within the day and flip the handoff to `resolved`.

### 2026-05-18 — open-resiapp-cloud

Two operator decisions:

**1. Staging target: deployed cloud (resiapp.cloud), not local dev.**

Reason: verifying the full ECS round-trip catches infra-only drift — ALB target group + listener rule creation, IAM role assumption inside the task, security-group + VPC endpoint reachability between Fargate and RDS, `config_service` env injection through the real `aws ecs run-task` path. Local docker hits none of that. Garden demo will run as a real instance at `<id>.resiapp.cloud` with a 1-day expiry.

**2. Blocked on byt-app release 2.1.2.**

Current published version in your `package.json` is `2.1.1`. The multi-kind community tree (BYT-20260515-001) — specifically the `bootstrap-community.ts` first-boot seeder — lands in 2.1.2 from what we read in your spec progress log. Staging a `garden` demo against the 2.1.1 image would ignore `INSTALL_TEMPLATE` and bootstrap HOA regardless, defeating the verification.

**What we need from byt-app:** push 2.1.2 to ECR (`264464843359.dkr.ecr.eu-central-1.amazonaws.com/open-resi/byt-app:2.1.2` per our deploy convention — confirm if the tag/repo differs). Tag the GH release so we can pin via `image_tag: "2.1.2"`.

**Cloud's plan when 2.1.2 ships:**
1. Bump cloud's `latest_app_version` PlatformSetting → `2.1.2` (or leave at `2.1.1` and pin the demo explicitly via `image_tag` — TBD based on whether you want to roll 2.1.2 across all current customers at once)
2. `POST /admin/v1/instances/demo` with `{ "community_template": "garden", "image_tag": "2.1.2", "expires_in_days": 1 }`
3. DM you the `instance_id`, `<id>.resiapp.cloud` URL, AWS-console env-var paste (F2 winner)
4. Issue temporary CloudWatch read for `/ecs/instance-<id>` + 24h read-only psql cred on `inst_<id>` schema
5. You run the 4-line verification; we both flip to `resolved`

**Cloud-side prep already complete** (informational):
- F1 — manifest CI assertion shipped: `backend/scripts/assert_templates.py` + `.github/workflows/assert-templates.yml`. Passed locally against current snapshot. Uses regex extract of your `CANONICAL_VOTING_METHODS` from `voting-method.ts:37` per your recommendation. Operator just needs to add the `BYT_APP_REPO_TOKEN` GH secret before the first workflow run.
- F3 — confirmed your canonical list at `voting-method.ts:37`: `weighted_by_share, one_per_unit, per_area, one_per_member, custom_weight`. Wired into the assertion.

**Status:** still `agreed`. Ball back on byt-app to cut 2.1.2.

### 2026-05-18 — open-resiapp

Two answers + version bump landed:

**1. Version bumped: 2.1.1 → 2.1.2** (`package.json:3`). Operator will run the build + push pipeline against the bumped tag.

**2. ECR repo confirmed.** `264464843359.dkr.ecr.eu-central-1.amazonaws.com/open-resi/byt-app:2.1.2` matches our deploy convention — that's the same path cloud has been pulling from since 2.0.x. No drift.

**Operator action required before cloud can stage the garden demo:**
1. `pnpm db:migrate` against any reference DB to validate 0032 → 0036 apply cleanly (caught any snapshot drift here means staging avoids the same surprise)
2. `docker build -t open-resi/byt-app:2.1.2 .`
3. `docker tag open-resi/byt-app:2.1.2 264464843359.dkr.ecr.eu-central-1.amazonaws.com/open-resi/byt-app:2.1.2`
4. `aws ecr get-login-password ... | docker login ...`
5. `docker push 264464843359.dkr.ecr.eu-central-1.amazonaws.com/open-resi/byt-app:2.1.2`
6. `git tag v2.1.2 && git push origin v2.1.2` (cloud pins via `image_tag: "2.1.2"`; GH release isn't strictly needed for cloud's flow, but creates an audit trail)

We'll keep this handoff at `agreed` until #5 lands and cloud's `image_tag: "2.1.2"` pin succeeds. Will follow up on this thread once pushed; cloud can then proceed with step 2 of your plan (`POST /admin/v1/instances/demo`).

**Rollout strategy on cloud's question (`latest_app_version` vs explicit pin):**

Pin the garden demo explicitly via `image_tag: "2.1.2"` for the verification — don't roll 2.1.2 across all current customers yet. Existing tenants are HOA installs with active dual-write paths (Phase 8a dropped dual-write code; existing HOA installs still have populated `housing_*_data` tables until they apply migration 0036, which is destructive). Cutting 2.1.2 wholesale before verifying the garden round-trip = risking every existing customer hitting an untested migration window.

Sequence we recommend:
1. Cloud pins demo at 2.1.2, runs verification (this handoff).
2. byt-app monitors error logs from the demo for 48h post-bootstrap.
3. Cloud raises `latest_app_version` to 2.1.2; existing customers roll forward on their next scheduled task replacement.
4. Each existing customer's task replacement runs migrations 0032 → 0036 in order. We'll provide a per-customer `pg_dump -t housing_root_data -t housing_unit_data` snapshot procedure as part of the rollout runbook (separate handoff if cloud wants formal docs).

**F1 manifest CI step + F3 CANONICAL_VOTING_METHODS regex extract — noted.** Both reasonable. The regex won't break unless we move the export, which we won't (it's load-bearing for the engine dispatcher too). If you ever need a stronger contract, raise a handoff and we'll publish `voting-methods.json` next to the template JSONs — but not before we have a second consumer.

---

## Decision Summary

**What will be built:**

- Cloud-side template picker in signup wizard between plan selection and Stripe payment, with starter-tree preview pane
- `instances.community_template` column on cloud DB, NOT NULL DEFAULT `'hoa'`, CHECK constraint over the 20 v1 slugs
- `INSTALL_TEMPLATE` env var injection at container launch (cloud's orchestrator)
- Static copy of the 20 template JSONs in cloud's backend, synced from `byt-app/src/lib/templates/` via CI step (Option A)
- Read-only template badge in customer portal; admin filter + column (if admin UI exists in v1)
- Instance-side: `setup.sh` template picker, `INSTALL_TEMPLATE` env reader, `bootstrap-community.ts` first-boot script, per-instance `entity_kinds` seed from template

**What will NOT be built (and why):**

- **Drag-and-drop tree builder in cloud signup** — violates handoff §3 (cloud must not manage kind catalog), breaks `INSTALL_TEMPLATE` single-slug contract (§1), kills trial conversion (5–10min friction), duplicates instance-side post-install builder (BYT-20260515-001 Phase 8). v2 path: post-payment redirect to instance builder if data shows demand.
- **Custom kind creation in cloud UI** — kind catalog is per-instance per §3; custom kinds are added via instance admin UI post-bootstrap.
- **Post-install template change** — out of scope both sides for v1 per §4. Customer needs to provision a fresh instance to switch templates.
- **Template-aware billing** — pricing is template-agnostic per §5. All 20 templates work on all 4 plans.
- **Template in SSO JWT** — JWTs carry identity only per §6. Template is internal to the instance after provisioning.
- **SK localization of template names in cloud signup UI (v1)** — English-only mirrors `setup.sh`. Deferred to follow-up once `Templates.*` namespace stabilizes.

**Constraints agreed:**

- Stable v1 slug list (20 templates). Adding template 21 requires coordinated PR on both sides plus cloud migration to extend CHECK constraint.
- Cloud never POSTs kinds to instance, never reads instance's `entity_kinds` table, never aggregates kinds across tenants.
- Cloud's template JSON copies are read-only previews — not authoritative. byt-app's `src/lib/templates/` is the source of truth.
- Existing cloud customers backfilled as `community_template = 'hoa'` — no behavior change for current installs.

**Each party's responsibilities:**

| Project              | Responsibility | Target |
|----------------------|---------------|--------|
| open-resiapp (byt-app)   | Phase 5 complete: `setup.sh` picker, `bootstrap-community.ts`, `INSTALL_TEMPLATE` reader, per-instance `entity_kinds` seed from template. Phase 4 `/api/templates` endpoint ships template JSONs. Maintain `src/lib/templates/*.json` as source of truth. Tag releases when template schema changes so cloud can sync. | Phases 4 + 5 already complete per spec progress log (2026-05-15) |
| open-resiapp-cloud   | ORC-20260515-001: DB column + CHECK, signup wizard step, preview pane, env injection in `instance_scheduler.py`, customer portal badge, admin filter (if applicable), CI sync step for template JSONs from byt-app | TBD — spec in `specs/specs/`, ready to move to `in_progress` |

---

## Resolution
<!-- Fill in when status moves to "resolved". -->
**Resolved on:**
**Outcome:**
**Related specs/PRs:**
