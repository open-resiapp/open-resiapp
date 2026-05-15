---
handoff_id: open-resiapp-to-open-resiapp-cloud-20260515-001
from: open-resiapp
to: open-resiapp-cloud
status: agreed
created: 2026-05-15
updated: 2026-05-15
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
