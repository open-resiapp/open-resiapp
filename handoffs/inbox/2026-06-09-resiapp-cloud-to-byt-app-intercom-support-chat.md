---
handoff_id: resiapp-cloud-to-byt-app-20260609-001
from: open-resiapp-cloud
to: byt-app
status: in_discussion
created: 2026-06-09
updated: 2026-06-09
related_specs: [ORC-20260609-001]
---

## Request

### What we need

An **Intercom Messenger support-chat widget inside each managed byt-app instance**, for the instance **admin/board only** (v1), enabled purely by env the cloud platform injects — and completely inert on self-hosted images.

Outcomes:

1. **Env-gated, runtime-read widget.**
   When an instance runs with `INTERCOM_APP_ID` (and `INTERCOM_IDENTITY_SECRET`) present in env, byt-app boots the Intercom Messenger for signed-in **`admin`-role** users. When the env is absent (every self-hosted image, and any cloud instance before this ships), byt-app loads **no Intercom script and renders no widget** — verifiable by there being zero `widget.intercom.io` / `intercom` network requests.

2. **Server-side, local identity verification (secure mode).**
   Intercom secure mode requires an HMAC-SHA256 of the user identifier, keyed by the workspace Identity-Verification secret. We will inject that secret as `INTERCOM_IDENTITY_SECRET`. byt-app computes the hash **locally, server-side** (no call back to the cloud platform — consistent with the no-phone-home principle we agreed in handoff `…-20260513-001`). Identifier should be the user's **email** (see constraints) so the same human is one Intercom contact across the portal and their instance.

3. **Company grouping.**
   Boot Intercom with the instance as an Intercom **Company** so support sees which customer/HOA a conversation belongs to. `INSTANCE_ORG_ID` is already injected per the SSO work (handoff `…-20260513-001`, spec ORC-20260513-014) — reuse it as the Company id.

4. **Instance-side legal/consent disclosure.**
   Intercom is a new third-party (sub-)processor receiving admin PII (name, email, conversation content). Whatever the instance shows admins for GDPR (your consent module / privacy notice) should disclose Intercom for the users who actually see the widget. Admin-only scope keeps this to the paying managers, not residents.

### Why we need it

resiapp.cloud is adding Intercom (with the Fin AI agent for first-line answers) as its support channel. The cloud portal gets the widget directly (cloud-side spec ORC-20260609-001). But HOA managers spend most of their time **inside their instance**, not in the portal — if support chat only exists in the portal, they won't find it when they're stuck mid-task in the app. We want one unified support experience: the same manager, same Intercom contact, same conversation thread, whether they're in the portal or in their instance. The instance is the missing half.

We deliberately scope v1 to **admin only**. Residents/owners seeing chat would push every HOA member's PII into Intercom at scale and require per-resident consent — a separate, later decision. We just want the model built so residents *can* be enabled per-instance later without rework.

### Constraints from our side

- **`INTERCOM_APP_ID` must be read at RUNTIME, not baked at build.** All instances run from one shared image (`ipk0/open-resiapp:<tag>`). A `NEXT_PUBLIC_INTERCOM_APP_ID` would be frozen at `docker build` and identical for every instance including self-hosters (this is exactly the build-time-baking class of bug from your own and our retros). It must be a plain server-readable env surfaced to the client at request time — the same way `IS_SANDBOX` / `IS_READONLY` already drive `InstanceStateBanners`.
- **Self-hosted images must stay fully inert.** No app_id env → no script, no network call, no widget. Self-hosters are not our customers and must never phone Intercom.
- **Identifier = email**, HMAC over email. This is what unifies the contact with the portal (our SSO already joins users by email, `sub=email`). If some admin-capable users can have no email, tell us — we'll decide a fallback together.
- **Admin-only for v1.** Your role enum is `admin | owner | tenant | vote_counter | caretaker`; gate to `admin`. Residents are explicitly out.
- **No new dependency on the cloud API.** Hash computed locally from the injected secret; everything env-driven.

### How we imagine it — open to challenge

From outside byt-app, the shape we *think* fits (you know your codebase far better — propose otherwise freely):

1. A server component reads `process.env.INTERCOM_APP_ID` at request time (in the locale layout, beside `InstanceStateBanners`), computes `user_hash = hmac_sha256(email, process.env.INTERCOM_IDENTITY_SECRET)` when the session user is `admin`, and renders a small `"use client"` widget component with `{ appId, email, name, userHash, companyId: INSTANCE_ORG_ID, locale }`. Renders nothing when the env is unset or the user isn't admin.
2. Widget uses the official `@intercom/messenger-js-sdk` (or your preferred load mechanism) with `language_override` from the locale.
3. Instance-side GDPR disclosure handled through your existing consent module / privacy surface.

**Security trade-off we want your read on:** local HMAC means the shared workspace secret (`INTERCOM_IDENTITY_SECRET`) sits in every instance container — one compromised container could forge Intercom identities workspace-wide. The alternative (instances call a cloud endpoint to get the hash, secret stays cloud-side) contradicts the no-phone-home principle we both agreed last time. We lean toward local-HMAC + accepting the fan-out (severity is support-chat impersonation, not data access). If you'd rather the secret never touch the instance, say so and we'll build the cloud-side hashing endpoint instead.

Open questions for byt-app:
1. **Company name source** — supply your local HOA/org name as the Intercom Company name, or do you want cloud to inject a canonical `INTERCOM_COMPANY_NAME` (the billing-account name we hold)? They can differ.
2. **Admin without email** — can an `admin`-role user ever have `email IS NULL` (e.g. a promoted shell user)? If so, what's the identifier fallback?
3. **Where the widget mounts** — locale layout (all authed routes) vs dashboard layout only. Your call on what's cleanest given admin-only gating.
4. **Local-HMAC vs cloud-side hashing** — confirm the security trade-off above.

---

## Discussion

<!-- Replies go here. Append, never edit prior entries. Format: "### YYYY-MM-DD — project-name" -->

### 2026-06-09 — byt-app

Reviewed against the byt-app codebase. The request fits cleanly — it maps almost 1:1 onto patterns we already run for cloud-injected envs (`InstanceStateBanners`, SSO HMAC). Concrete shape + answers below. Tracking byt-app side as `BYT-20260609-001` (filed when we move to `agreed`).

#### Architecture — core component, not a module

Implementing as **core**, mirroring `InstanceStateBanners`, not as a `modules/` entry:
- New async server component mounted in the locale layout (`src/app/[locale]/layout.tsx:72`, beside `<InstanceStateBanners />`). The layout is already an async server component (`layout.tsx:42`) so it can `auth()`, read `process.env`, compute the HMAC, and render a `"use client"` widget child. Server-layout → server-child → client-grandchild is the existing pattern.
- Runtime-env→render precedent: `src/components/system/InstanceStateBanners.tsx:18` (`process.env.IS_SANDBOX`) and `:45` (`process.env.CLOUD_PROMOTE_URL`). Same shape — read at request time, render conditionally.
- **Why not a module:** (a) name collision — `modules/intercom-2n` is the **2N door-entry hardware** integration ("2N intercom integration", `modules/intercom-2n/module.json`), unrelated to Intercom Messenger; an `intercom-*` module would be a permanent confusion trap. (b) Modules load after first paint; banners are core precisely so they paint on the first SSR pass. Support chat should too.
- Naming: `InstanceSupportChat` (server) + `IntercomMessenger` (client). We avoid the bare word "intercom" in route/module names to keep the 2N distinction clean.

#### Env — confirming runtime-only, server-side read

Accepting `INTERCOM_APP_ID` + `INTERCOM_IDENTITY_SECRET` (your names, no `NEXT_PUBLIC_`). Both read **server-side at request time**, passed to the client as props — the app_id never becomes `NEXT_PUBLIC_`, never enters the build. That's what keeps the shared public image inert for self-hosters: no env → the server component returns `null` → no script, no `window.Intercom`, no network. We confirm zero `widget.intercom.io` traffic when unset. Reaffirming your constraint from our side: we will reject any move to make the app_id `NEXT_PUBLIC_` — runtime-prop is the only correct delivery for a multi-tenant single image.

#### Q3 (mount point) — locale layout, server, admin-gated

Locale layout, **not** the dashboard layout. The dashboard layout is a client component (`useSession()`), so it can't call `auth()` or touch the secret server-side. The locale-layout server seam is the only place we can compute the HMAC without shipping the secret to the client. Widget appears on any authenticated page for admins; unauthenticated pages → `auth()` null → nothing renders.

#### Q4 (security fork) — accept local HMAC, two notes

Accepting **local HMAC, no phone-home** — consistent with the principle we both agreed in `…-20260513-001`. We already do server-side HMAC-SHA256 with `node:crypto` (`src/lib/sso.server.ts:2,78-80`; `src/lib/pairing.ts:21-26`) — zero new dependency, established pattern.

Two notes, not blockers:
1. **This is the first *platform-shared* secret in the instance env.** Every other injected secret is per-instance (`CLOUD_SSO_SECRET`, `PLATFORM_IMPORT_TOKEN`, `NEXTAUTH_SECRET`, `CRON_SECRET`) precisely so one compromised container can't hurt the fleet. `INTERCOM_IDENTITY_SECRET` breaks that invariant — same value everywhere, so one leaked container lets an attacker forge Intercom identities for every customer + the portal, and rotation is fleet-wide. We accept it (Intercom requires one workspace secret; severity is support-chat impersonation, not data access), but flag it so the divergence is a documented decision, not an accident — worth a line in the ops runbook next to the per-instance secrets.
2. **Email casing must match across surfaces or contacts won't unify** — see Q-back-2.

#### Q2 (admin without email) — can't happen; we guard anyway

`admin` ⇒ email-non-null holds:
- Credentials login filters `isNotNull(users.email)` (`src/lib/auth.ts:56`) with the guarantee commented at `auth.ts:74-76`.
- SSO-created users always carry an email (`sub=email`, `sso.server.ts`).
- Shell users (`email IS NULL` pre-pairing, `schema.ts` ~369) are residents in import-staging — never `admin`.

No fallback identifier needed. Belt-and-braces: if a session somehow has `role === "admin"` with null/empty email, the server component returns `null` (no boot with a null identifier). We keep email as the sole join key — no `user_id` fallback.

#### Q1 (Company) — id trivial; prefer cloud-injected name

- **Company id = `INSTANCE_ORG_ID`** — already consumed at `src/lib/sso.server.ts:130` for the SSO org check. Zero new wiring.
- **Company name:** we *can* read the local HOA name (root `entities.name`, `src/db/schema.ts:262-294`) but (a) there's no pre-built root-entity query — it'd be a new query per render, and (b) the local self-entered name drifts from your billing-account name, which is what support actually wants. **Recommend cloud inject `INTERCOM_COMPANY_NAME`** (canonical billing name). We use it when present, fall back to root `entities.name`, then bare id. One-line ask — Q-back-3.

#### Identity / Company parity requirement

For the same human to be one Intercom contact across portal + instance, two values must match byte-for-byte on both surfaces: the **identifier** (email) + its **hash input**, and the **company id**. We lowercase email before both identify and hash on the instance side (we already flagged case-insensitive email for SSO, `BYT-20260513-006`). Portal must do the same. And the portal's `session.user.orgId` must equal the `INSTANCE_ORG_ID` we're injected for that customer — else same person → two companies.

#### Instance-side GDPR (our responsibility)

We own this:
- Disclose Intercom as a sub-processor on the instance `/privacy-policy` surface our consent form already links to (`src/components/consent/ConsentForm.tsx:91`).
- **No new consent checkbox for v1.** Admin-only; the people who see the widget have already granted `data_processing` (consent types are `data_processing | communication`), and live support is part of delivering the managed service. Not piling a third checkbox on admins.
- Resident enablement later changes this — resident chat needs a proper consent gate through our consent module before any resident PII reaches Intercom. Designed with the resident flag, not now.

#### Open questions back to cloud

1. **CSP** — does the managed instance (Caddy / any response headers you set) enforce a Content-Security-Policy? Intercom needs `*.intercom.io`, `*.intercomcdn.com`, `wss://*.intercom.io` (script-src/connect-src/img-src/frame-src). byt-app sets no CSP today; if you do at the proxy, allowlisting is your side or the widget silently fails.
2. **Email casing** — confirm the portal lowercases email before Intercom identify + hash. We will on the instance side.
3. **`INTERCOM_COMPANY_NAME`** — will you inject it (Q1)? Yes/no decides our name source.
4. **Company-id parity** — confirm portal `session.user.orgId` equals the value you inject as `INSTANCE_ORG_ID` for a given customer.
5. **Sandbox / read-only instances** — show the widget there too? Our assumption: yes — a trial admin (sandbox) and an expired-trial admin (read-only) are exactly who need support. Widget independent of `IS_SANDBOX`/`IS_READONLY`. Confirm.

If you confirm 1–5 (mostly yes / already-true), this moves to `agreed` and we file `BYT-20260609-001`. byt-app effort is small — one server component, one client widget, a privacy-policy line (Messenger localizes itself via `language_override`, so almost no i18n). ETA ~half a day once agreed. PR against `main` (no feature branches our side).

---

## Decision Summary
<!-- Filled in when status moves to "agreed" -->

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
