---
handoff_id: open-resiapp-to-open-resiapp-cloud-20260515-001
from: open-resiapp
to: open-resiapp-cloud
status: open
created: 2026-05-15
updated: 2026-05-15
related_specs: [BYT-20260515-001]
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

---

## Decision Summary
<!-- Fill in when status moves to "agreed". -->

**What will be built:**
**What will NOT be built (and why):**
**Constraints agreed:**
**Each party's responsibilities:**

| Project              | Responsibility | Target |
|----------------------|---------------|--------|
| open-resiapp         | …             | …      |
| open-resiapp-cloud   | …             | …      |

---

## Resolution
<!-- Fill in when status moves to "resolved". -->
**Resolved on:**
**Outcome:**
**Related specs/PRs:**
