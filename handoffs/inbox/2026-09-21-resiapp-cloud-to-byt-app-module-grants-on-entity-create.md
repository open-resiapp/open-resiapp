---
handoff_id: resiapp-cloud-to-byt-app-20260921-001
from: open-resiapp-cloud
to: byt-app
status: open
created: 2026-09-21
updated: 2026-09-21
related_specs: [ORC-20260921-001]
---

## Request

### What we need

A bundled module that is meant to be on by default for a given entity kind
should be usable on a community as soon as that community exists — without
anyone restarting the container, and without an operator clicking anything.

Concretely, after this is done the following should hold on a fresh instance:

- The app starts against an empty database (no entities yet).
- Someone creates the community — through the onboarding UI, the bootstrap
  script, or an import.
- Accounting and voting are immediately usable on that community: their pages
  render, their API routes answer, and the sidebar shows them.

Right now step 3 fails until the container is restarted.

A second, smaller outcome: when the cloud provisions an instance it passes
`INSTALL_TEMPLATE`, and we would like a guarantee that an instance carrying that
variable ends up with its community tree seeded — without the cloud having to
reach into the container to run a script itself. See "How we imagine it" for why
we suspect this belongs on your side, and please push back if you disagree.

### Why we need it

On 2026-09-21 we provisioned `dunaj.resiapp.cloud` for a live customer demo. The
instance came up healthy, the customer got their credentials email, logged in —
and accounting was dead. Two separate causes, both on the seam between our
provisioning and your module system:

1. Nothing ever ran `src/scripts/bootstrap-community.ts`, so `entities` was
   empty. In self-hosted installs `setup.sh:376` runs it; our provisioning has
   no equivalent step.
2. Once we seeded the community by hand, accounting was *still* not granted on
   it. `bootstrapBundledModules` runs at app start and grants only over
   entities that exist **at that moment** — on a fresh instance that set is
   empty, so no grant is ever written for a community created later.
   `core_modules` said `accounting: enabled`, which made it look fine from the
   outside.

We unblocked the demo by inserting the `core_module_grants` rows directly. That
is not something we want to keep doing per customer, and it is not something a
self-hosted operator should have to discover either — the same gap hits anyone
who starts the app before creating their community.

### Constraints from our side

- We set `INSTALL_TEMPLATE`, `APP_NAME` and `LANGUAGE` as container env vars at
  provisioning time (spec ORC-20260515-001) and can keep doing so; treat those
  as the inputs you have available.
- Whatever the mechanism, it must be idempotent. Our scheduler restarts
  containers on config changes, version updates and host reboots, and a second
  run must not duplicate entities or re-grant over an operator's deliberate
  "disabled".
- An operator's explicit decision must keep winning. `OPEN_HOUSING_DISABLE_BUNDLED`
  should still suppress the module, and a module an operator disabled by hand
  must not be silently re-enabled. We are adding a per-instance Modules toggle
  in the cloud UI that maps onto that variable.
- We need to be able to tell, from the control plane, whether an instance is
  actually usable before we email the customer. A query we can run against the
  instance database, or an endpoint, is enough — we are not asking for a
  specific shape.

### How we imagine it — open to challenge

You know the module system; this is only our reading of it after a day inside it.

For the grants: the natural hook looks like entity creation rather than app
start — when an entity is created whose kind appears in some bundled module's
`autoEnableKinds`, write the grant then. `bootstrapBundledModules` would stay as
the catch-up path for instances that already have entities.

For the tree: `docker-entrypoint.sh` already self-migrates, and it already has
`DATABASE_URL` and the env we inject. Running the bootstrap there when
`INSTALL_TEMPLATE` is set and the tree is empty would make cloud and self-hosted
behave identically, and would mean we never have to shell into your container.
Our fallback, if you would rather not own this, is for the control plane to
`docker exec` the script — it works, we did it by hand today, but it couples us
to your script path and to `tsx` staying in the runner image, so we would rather
not.

We are also happy to be told that the real fix is somewhere else entirely — e.g.
that the grant check belongs in the route guard rather than in stored rows.

---

## Discussion

<!-- Each reply follows this format — append, never edit previous entries -->

---

## Decision Summary
<!-- Filled in when status moves to "agreed" — distilled from the discussion above -->

**What will be built:**
**What will NOT be built (and why):**
**Constraints agreed:**
**Each party's responsibilities:**

| Project | Responsibility | Target |
|---------|---------------|--------|
| open-resiapp-cloud | ... | ... |
| byt-app | ... | ... |

---

## Resolution
<!-- Filled in when status moves to "resolved" -->
**Resolved on:**
**Outcome:**
**Related specs/PRs:**
