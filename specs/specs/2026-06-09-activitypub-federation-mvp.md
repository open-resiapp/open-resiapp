---
spec_id: BYT-20260609-002
title: "ActivityPub federation MVP (community-as-actor)"
status: spec
created: 2026-06-09
updated: 2026-06-09
author: byt-app
owner: filipvnencak
last_verified: 2026-06-09
project_type: other
depends_on:
  - RES-20260417-001   # community foundation (notices/events/marketplace)
  - BYT-20260515-001   # entity tree — root entity is the actor source
  - RES-20260428-002   # plugin/module system (capability + signing precedent)
related_handoffs: []
tags:
  - federation
  - activitypub
  - fediverse
  - interoperability
  - community
  - nlnet-grant
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Let an open-resiapp community publish its **public** community content — board
notices, events, and marketplace/help posts — to the fediverse as a first-class
ActivityPub actor, and let remote fediverse accounts (Mastodon, Mobilizon, etc.)
follow that community and receive its updates. This is the NLnet grant task **T3**.
It turns a self-hosted, single-building instance from an island into an
interoperable civic node: a building can broadcast "garage door broken, meeting
Thursday" to neighbours, a town's property-management account, or a municipal
follower, without anyone installing our software.

Federation is the **first sanctioned cross-instance channel** in a system whose
core invariant is *one building per instance, cross-building leakage impossible*
(`docs/domain/community.md`). The entire design is therefore built around an
explicit, narrow, opt-in egress of only public content — never directory PII,
never governance (voting, mandates, documents, audit). The privacy walls are the
spec, not a footnote.

### Problem statement

Today community content lives and dies inside one instance. There is no way for
a neighbouring building, a regional administrator (správca) who runs several
buildings, or an interested citizen to subscribe to a community's public posts
without an account on that exact instance. The grant's ecosystem argument
(property-management companies as multipliers, regional reach) requires a
standard, decentralised subscription mechanism. ActivityPub is the W3C
Recommendation that the fediverse already speaks; implementing it makes
open-resiapp interoperable with an existing network instead of inventing a
proprietary feed.

## Scope

**In scope (MVP)**
- **One actor per instance.** The root `entities` row (depth 0) is exposed as a
  single ActivityPub `Group`-type actor. One building per instance ⇒ exactly one
  actor. No per-user actors in MVP.
- **Discovery:** WebFinger (`/.well-known/webfinger`) resolving
  `acct:{handle}@{host}` → the actor URI; actor document at a stable URL with
  `inbox`, `outbox`, `followers`, `publicKey`.
- **Outbound federation, opt-in per post.** An admin explicitly marks a post as
  "share to fediverse" (default OFF). Marking emits a signed `Create`; editing
  emits `Update`; deleting/unsharing emits `Delete`. Delivered to all accepted
  followers' inboxes.
- **Object mapping:**
  - Board notice (`posts`) → AS2 `Note`.
  - Event (`community_posts.type = 'event'`) → AS2 `Event` with `startTime`,
    `location` from `eventDate` / `eventLocation`.
  - Marketplace / help (`community_posts.type` in
    `sale | free | borrow | help_request | help_offer`) → AS2 `Note` carrying a
    structured `tag` for the category (richer `Offer`/`Request` vocab deferred).
- **Inbound:** accept `Follow` → reply `Accept`; accept `Undo Follow`. Inbound
  replies (`Create` `Note` `inReplyTo`) land in a **moderation queue**, default
  hidden, surfaced to admin only — never auto-published into the community feed.
- **Basic moderation:** per-domain allow/block policy; admin approve/reject of
  queued inbound objects; every federation action written to `entity_audit_log`.
- **HTTP Signatures** (draft-cavage, RSA-SHA256) on every outbound delivery;
  signature verification on every inbound activity, with remote actor key fetch
  + cache.
- **Instance-level + community-level toggle.** Federation OFF by default. Self-host
  operator must opt in; admin must then enable it for the community.
- **i18n:** all new admin-facing UI strings in `sk.json` / `cs.json` / `en.json`.

**Out of scope (MVP — follow-up specs)**
- Per-user / per-resident actors and inbound DMs.
- Outbound delivery of media attachments / photos (post `photoUrl` not federated
  in v1; alt-text + sanitization story deferred).
- `Announce` (boosts), `Like`, and aggregate counts.
- RSVP ↔ `Join` / `Leave` round-trip on events (one-way Event publish only in v1).
- Full threaded conversations; we accept top-level replies into moderation only.
- C2S (client-to-server) API, relays, account migration (`Move`), search.
- Shared-inbox optimisation (deliver per-follower inbox in v1; sharedInbox later).
- Federating governance content (voting, mandates, documents) — **permanently out
  of scope**, not deferred.

## Approach

### Where it lives — core subsystem, not a loadable module

Federation reads across two subsystems (core `posts` + community `community_posts`),
manages long-lived cryptographic identity, and is protocol/security sensitive.
That places it in **core**, behind a toggle, alongside auth — not in a third-party
`modules/*` package. It still respects the module-system precedents (capability
gating, signing) but ships as `src/lib/federation/*`. Rationale recorded in Notes;
this is an explicit decision reviewers will probe.

Server-only APIs (key access, signing, `next/headers`) live in
`*.server.ts` files with `import "server-only"`, per the CLAUDE.md library-module
split rule. Constants / AS2 type strings shared with client components go in
client-safe modules.

### Actor identity & keys

- Actor type `Group`. `preferredUsername` derived from a configurable handle
  (default from root entity name, slugified); `name` = root entity `name`;
  `summary` = configurable description. **No personal PII** in the actor.
- Dedicated **RSA-2048** keypair (ActivityPub HTTP Signature interop still mandates
  RSA-SHA256 for Mastodon et al.). This is intentionally a *different* key from the
  T2 voting-audit Ed25519 signing key and from `NEXTAUTH_SECRET` — three separate
  keys, three separate purposes. Private key stored encrypted at rest.
- `publicKey` published in the actor document with a stable `keyId`.

### New tables (core, `federation_*` prefix)

Every `references(...)` specifies `onDelete` per CLAUDE.md.

- `federation_actor` — the single local actor: `id`, `handle`, `name`, `summary`,
  `publicKeyPem`, `privateKeyEnc`, `keyId`, `enabled`, `createdAt`. One row.
- `federation_followers` — `id`, `actorUri`, `inboxUrl`, `sharedInboxUrl`,
  `state` (`pending|accepted`), `followedAt`. Remote follower of the community.
- `federation_shared_objects` — the opt-in egress join table (avoids bloating
  `posts` / `community_posts`): `id`, `objectType` (`notice|event|market`),
  `objectId` (uuid, no FK — polymorphic, integrity enforced in app layer),
  `activityId`, `sharedById` → `users.id` `on delete set null`, `sharedAt`,
  `revokedAt`. Presence + `revokedAt is null` = currently federated.
- `federation_outbox` — `id`, `activityId`, `activityType`
  (`Create|Update|Delete|Accept`), `payload` jsonb, `createdAt`.
- `federation_deliveries` — per-(outbox, follower) attempt: `id`,
  `outboxId` → `federation_outbox.id` `on delete cascade`, `followerId` →
  `federation_followers.id` `on delete cascade`, `state`
  (`pending|delivered|failed`), `attempts`, `lastAttemptAt`, `nextRetryAt`.
- `federation_inbox` — `id`, `remoteActorUri`, `activityType`, `payload` jsonb,
  `moderationState` (`pending|approved|rejected`), `inReplyToObjectId`,
  `receivedAt`, `processedAt`.
- `federation_domain_policy` — `domain` (pk), `policy` (`allow|block`), `reason`,
  `createdAt`.

A new `entity_audit_action` enum value covers federation mutations (e.g.
`federation_share`, `federation_unshare`, `federation_moderate`) so the existing
audit log is the single moderation/accountability trail.

### Route handlers (`app/api/federation/**`, outside `[locale]`)

Per CLAUDE.md, `route.ts` exports only HTTP handlers; module state lives in
`src/lib/federation/*`.

- `GET /.well-known/webfinger?resource=acct:...` → JRD.
- `GET /api/federation/actor` → actor document (`application/activity+json`).
- `GET /api/federation/actor/outbox` → paged `OrderedCollection`.
- `GET /api/federation/actor/followers` → followers collection.
- `POST /api/federation/actor/inbox` → verify HTTP signature, dispatch by activity
  type (`Follow`/`Undo`/`Create`), enqueue or moderate.
- `GET /api/federation/object/{type}/{id}` → AS2 representation of a shared object
  (only if currently shared; else 404/410 `Tombstone`).

### Delivery & retry

Outbound activities enqueue into `federation_deliveries`; a background worker
(reuse existing job mechanism — confirm during design) signs and POSTs to each
follower inbox with exponential backoff on `nextRetryAt`, capped retries, then
`failed`. Idempotent on `activityId` (remote dedupe via stable ids).

### Privacy & safety gates (hard requirements)

1. **Default OFF** at instance and community level; federation impossible until
   both toggles on.
2. **Allowlist of object types.** Only `notice | event | market` can ever enter
   `federation_shared_objects`. Directory entries, voting, mandates, documents,
   audit, memberships, user PII have **no code path** to an activity. Enforced by
   a single typed egress function, not scattered checks.
3. **Per-post opt-in.** Default unshared; sharing is an explicit admin action and
   is revocable (emits `Delete` + `Tombstone`), satisfying the CLAUDE.md
   "per-user mutable record must cover undo/delete" rule.
4. **No contact PII.** Author rendered as display name per a community setting
   (or anonymised); phone/email never leave the instance.
5. **Inbound is untrusted.** Signature-verified, domain-policy-filtered, parked in
   moderation, never auto-rendered.

### W3C / SocialCG alignment

Target conformance: ActivityPub (W3C Rec), ActivityStreams 2.0 vocabulary + JSON-LD
context, HTTP Signatures (draft-cavage-12), WebFinger (RFC 7033). Interop test
targets: **Mastodon** (follow the community, receive Notes), **Mobilizon**
(receive Events). Track relevant FEPs (e.g. FEP-1b12 group/announce semantics,
FEP-8b32 object integrity) in Notes; adopt where they aid interop without
expanding MVP.

## Acceptance Criteria

- [ ] A remote Mastodon account can search `@{handle}@{host}`, see the community
      actor profile, and follow it; the community auto-`Accept`s and the follower
      appears in `federation_followers` with state `accepted`.
- [ ] Marking a board notice "share to fediverse" delivers a signed `Create Note`
      to every accepted follower; it renders in the follower's Mastodon timeline.
- [ ] Editing a shared post delivers `Update`; unsharing/deleting delivers
      `Delete` and the object URL returns `410 Tombstone`.
- [ ] An event post federates as an AS2 `Event` with correct `startTime` and
      `location`, and is visible in Mobilizon.
- [ ] WebFinger resolves `acct:{handle}@{host}` to the actor URI; the actor
      document validates as `application/activity+json` with `inbox`, `outbox`,
      `followers`, `publicKey`.
- [ ] Every inbound activity with an invalid or missing HTTP signature is
      rejected (401) and not persisted.
- [ ] Inbound replies land in the moderation queue with state `pending`, are NOT
      visible in the community feed until an admin approves, and admin
      approve/reject is recorded in `entity_audit_log`.
- [ ] A domain on the block policy has all inbound activities dropped.
- [ ] With federation disabled at instance OR community level, no outbound
      delivery occurs and the actor/WebFinger endpoints 404.
- [ ] **Negative privacy test:** there is no code path by which a directory entry,
      vote, ballot, mandate, document, or user phone/email is serialised into any
      activity or object endpoint. Asserted by test, not review.
- [ ] All new admin UI strings exist in `sk.json`, `cs.json`, and `en.json`.
- [ ] The actor RSA key is distinct from `NEXTAUTH_SECRET` and the T2 audit key;
      the private key is encrypted at rest.

## Project Context

- **Actor source:** root `entities` row, identified by `rootId == id && depth == 0`
  (`src/db/schema.ts:262`). One building per instance ⇒ single actor; no
  multi-tenant actor routing needed.
- **Federatable content tables:** `posts` (`src/db/schema.ts:395`, board notices),
  `community_posts` (`:770`, types at `:104` — `sale|free|borrow|help_request|
  help_offer|event`). Marketplace and help collapse to `Note`; `event` →
  `Event`.
- **Never-federate tables:** `directory_entries`, `event_rsvps`,
  `community_responses` (inbound replies are separate), `documents`, voting module
  tables, `memberships`, `users`.
- **Module-vs-core decision:** core subsystem (`src/lib/federation/`) because it
  spans core + community reads, holds long-lived crypto identity, and is
  security-sensitive. Reuses the module system's capability/signing *precedent*,
  not its loader.
- **Key separation:** RSA-2048 actor key (HTTP Signatures) ≠ Ed25519 audit key
  (BYT-20260518-001) ≠ `NEXTAUTH_SECRET`.
- **Cross-cutting visual note:** federation adds an admin moderation surface and a
  per-post share control. Not a theming/RTL spec, so the CLAUDE.md FOUC subsection
  does not apply; standard i18n coverage does.

## Notes

Open questions to resolve before promotion to `in_progress`:

- **Background worker:** does the codebase already have a job/cron mechanism for
  delivery + retry, or does this spec need to introduce one? Confirm before
  estimating; the grant T3 budget (150 h) assumes reusing existing infra.
- **Object vocab for marketplace:** MVP uses `Note` + `tag`. Decide whether
  `Offer`/`Request`/`tombstone` vocab is worth it for v1 interop or strictly
  follow-up.
- **Author display policy:** community-wide setting (display name vs anonymised)
  vs per-post. Default to community-wide for MVP simplicity.
- **Handle collisions / changes:** what happens if the operator renames the
  building (handle change)? AS2 actor URI must stay stable even if
  `preferredUsername` changes — pin the URI to an opaque id, not the handle.
- **Self-host HTTPS requirement:** federation requires a public HTTPS host with a
  valid cert (Caddy already provides this). Document that localhost / IP-only
  deploys cannot federate.
- **FEP adoption:** evaluate FEP-1b12 (group announce) so followers of the
  community see member-authored posts via `Announce` — may be the cleaner model
  than the community authoring everything. Decide in design; affects the
  `Group` vs `Service` actor choice.

Placement note: filed in `specs/specs/` (status `spec`) to sit alongside the other
NLnet grant-task specs (T1 passkey, T2 audit bundle). Several design decisions
above are still open, so promote to `in_progress` only after the worker + vocab +
FEP questions are answered.
