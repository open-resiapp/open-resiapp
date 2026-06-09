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
  - RES-20260417-001   # community foundation (notices/events)
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
notices and events — to the fediverse as a first-class ActivityPub actor, and let
remote fediverse accounts (Mastodon, Mobilizon, etc.) follow that community and
receive its updates. This is the NLnet grant task **T3** (150 h). It turns a
self-hosted, single-building instance from an island into an interoperable civic
node: a building can broadcast "garage door broken, meeting Thursday" to
neighbours, a town's property-management account, or a municipal follower, without
anyone installing our software.

Federation is the **first sanctioned cross-instance channel** in a system whose
core invariant is *one building per instance, cross-building leakage impossible*
(`docs/domain/community.md`). The entire design is built around an explicit,
narrow, opt-in egress of only public content — never directory PII, never
governance (voting, mandates, documents, audit). The privacy walls are the spec,
not a footnote.

### Problem statement

Today community content lives and dies inside one instance. There is no way for a
neighbouring building, a regional administrator (správca) who runs several
buildings, or an interested citizen to subscribe to a community's public posts
without an account on that exact instance. The grant's ecosystem argument
(property-management companies as multipliers, regional reach) requires a standard,
decentralised subscription mechanism. ActivityPub is the W3C Recommendation the
fediverse already speaks; implementing it makes open-resiapp interoperable with an
existing network instead of inventing a proprietary feed.

### Glossary

| Term | Meaning here |
|---|---|
| **Actor** | The community itself, an AS2 `Group`. One per instance. |
| **Object** | A federated notice (`Note`) or event (`Event`). |
| **Activity** | A `Create`/`Update`/`Delete`/`Accept` wrapping an object or follow. |
| **Inbox / Outbox** | HTTP endpoints to receive / list activities. |
| **Follower** | A remote actor (person or instance) subscribed to our community. |
| **Egress** | The single code path through which an internal record becomes a federated object. |

## Scope

**In scope (MVP)**
- **One `Group` actor per instance**, sourced from the root `entities` row. No
  per-user actors.
- **Discovery:** WebFinger (`/.well-known/webfinger`) + a NodeInfo-style host-meta
  (`/.well-known/host-meta` optional), actor document with `inbox`, `outbox`,
  `followers`, `publicKey`.
- **Outbound, opt-in per post:** admin marks a notice/event "share to fediverse"
  (default OFF) → `Create`; edit → `Update`; unshare/delete → `Delete` +
  `Tombstone`. Delivered to all accepted followers.
- **Object mapping:** board notice (`posts`) → `Note`; event
  (`community_posts.type='event'`) → `Event` with `startTime`/`endTime`/`location`.
- **Inbound:** `Follow` → auto-`Accept`; `Undo Follow` → remove follower. Inbound
  replies (`Create Note inReplyTo`) → **moderation queue**, default hidden, admin
  approves before any community-side surfacing.
- **Moderation:** per-domain allow/block policy; admin approve/reject; every
  federation mutation written to `entity_audit_log`.
- **HTTP Signatures** (draft-cavage, `rsa-sha256`) on every outbound delivery;
  signature verification + remote-key fetch/cache on every inbound activity.
- **Two-level toggle:** instance env flag + community admin setting. Default OFF.
- **i18n:** all new admin strings in `sk.json` / `cs.json` / `en.json`.

**Out of scope (MVP — explicit follow-up specs)**
- Per-user / per-resident actors and inbound DMs.
- Outbound media/photo attachments (`photoUrl` not federated v1).
- `Announce` (boosts), `Like`, aggregate counts.
- RSVP ↔ `Join`/`Leave` round-trip (one-way `Event` publish only).
- Full threaded conversations (top-level replies into moderation only).
- C2S API, relays, account migration (`Move`), search/discovery beyond WebFinger.
- Shared-inbox fan-out optimisation (per-follower inbox delivery in v1).
- Help posts (`help_request`/`help_offer`) — candidate fast-follow, not MVP.
- **Marketplace** (`sale`/`free`/`borrow`) — feature disabled in product.
- Federating governance (voting, mandates, documents) — **permanently out of
  scope**, not deferred.

## Approach

### Architecture & file layout

Core subsystem (not a loadable `modules/*` package) because it reads across core
`posts` + community `community_posts`, holds long-lived cryptographic identity, and
is protocol/security sensitive — it belongs beside auth, not in third-party module
space. It reuses the module system's capability/signing *precedent*, not its loader.

```
src/lib/federation/
  config.ts              # client-safe: AS2 type constants, public toggle read
  config.server.ts       # import "server-only": env, key loading
  actor.server.ts        # build actor document, WebFinger JRD
  keys.server.ts         # load RSA keypair from env, keyId, sign/verify helpers
  http-signature.server.ts  # draft-cavage sign (outbound) + verify (inbound)
  serialize.ts           # internal record -> AS2 object (the ONLY egress fn)
  egress.server.ts       # share/unshare actions -> activities + delivery rows
  inbox.server.ts        # dispatch inbound by activity type
  delivery.server.ts     # drain federation_deliveries, POST, backoff
  moderation.server.ts   # approve/reject queued inbound
  db.ts                  # query functions (per CLAUDE.md: no inline queries)
```

Per CLAUDE.md, server-only APIs (`next/headers`, key access, DB) sit in
`*.server.ts` with `import "server-only"`; AS2 type-string constants shared with
client components live in `config.ts`.

### Configuration & toggles

| Env var | Purpose | Default |
|---|---|---|
| `FEDERATION_ENABLED` | Instance master switch | `0` (off) |
| `FEDERATION_ACTOR_PUBLIC_KEY` | RSA-2048 public PEM (served in actor doc) | — |
| `FEDERATION_ACTOR_PRIVATE_KEY` | RSA-2048 private PEM (signing) | — |
| `FEDERATION_HANDLE` | Default actor `preferredUsername` | slug of root entity name |
| `APP_DOMAIN` | WebFinger / actor host (already exists) | — |
| `APP_URL` | Actor URI base (already exists) | — |
| `CRON_SECRET` | Delivery cron auth (already exists, reused) | — |

Keys follow the **existing VAPID precedent** (`VAPID_PRIVATE_KEY` /
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` are already env-stored). A
`pnpm federation:keygen` script generates the RSA pair and prints the two env
lines. **No encrypted-DB private-key column** — the key never touches the DB; this
matches how push keys are handled today and keeps self-host setup to "paste two
env vars".

Beyond the env flag, a community admin must flip a **community-level setting**
(`federation_actor.enabled`). Both must be true for any endpoint to respond or any
delivery to fire. When either is false: WebFinger + actor + inbox return `404`, and
no outbound activity is enqueued.

### Actor identity & keys

- **Actor type `Group`.** `id` = `${APP_URL}/api/federation/actor` — an **opaque,
  stable URI** that never changes, even if the operator renames the building or
  changes the handle (resolves the "stable actor URI" question). `preferredUsername`
  = `FEDERATION_HANDLE`; `name` = root entity `name`; `summary` = configurable;
  `type: "Group"`; `manuallyApprovesFollowers: false`. **No personal PII** in the
  actor document.
- **Attribution (decided):** the community Group authors every object;
  `attributedTo` = the actor `id`. The post author's **display name** (`users.name`,
  optionally initialled per a community setting → "Jan N.") is rendered as **plain
  text inside `content`** — never as a federated identity, never with contact
  fields. Residents are not actors and are not followable.
- **Keys:** RSA-2048, `rsa-sha256` (mandated by Mastodon HTTP-Signature interop;
  intentionally different from the T2 Ed25519 audit key and from `NEXTAUTH_SECRET`
  — three keys, three purposes). `keyId` = `${actor.id}#main-key`. Public key
  published in the actor doc under `publicKey`.

#### Actor document (served at `GET /api/federation/actor`)

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1"
  ],
  "id": "https://dom.sk/api/federation/actor",
  "type": "Group",
  "preferredUsername": "zilinska12",
  "name": "Bytový dom Žilinská 12",
  "summary": "Verejné oznamy a udalosti spoločenstva.",
  "inbox": "https://dom.sk/api/federation/actor/inbox",
  "outbox": "https://dom.sk/api/federation/actor/outbox",
  "followers": "https://dom.sk/api/federation/actor/followers",
  "manuallyApprovesFollowers": false,
  "publicKey": {
    "id": "https://dom.sk/api/federation/actor#main-key",
    "owner": "https://dom.sk/api/federation/actor",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n"
  }
}
```

#### WebFinger (`GET /.well-known/webfinger?resource=acct:zilinska12@dom.sk`)

```json
{
  "subject": "acct:zilinska12@dom.sk",
  "links": [{
    "rel": "self",
    "type": "application/activity+json",
    "href": "https://dom.sk/api/federation/actor"
  }]
}
```

### Data model (`federation_*`, all in `src/db/schema.ts`)

New enums:

```ts
export const federationObjectTypeEnum = pgEnum("federation_object_type",
  ["notice", "event"]);
export const federationFollowerStateEnum = pgEnum("federation_follower_state",
  ["pending", "accepted", "dead"]);
export const federationDeliveryStateEnum = pgEnum("federation_delivery_state",
  ["pending", "delivered", "failed"]);
export const federationModerationStateEnum = pgEnum("federation_moderation_state",
  ["pending", "approved", "rejected"]);
export const federationDomainPolicyEnum = pgEnum("federation_domain_policy",
  ["allow", "block"]);
```

Add to existing `entity_audit_action` enum (dotted convention, matching
`entity.create`): `federation.enable`, `federation.disable`, `federation.share`,
`federation.unshare`, `federation.follow_accept`, `federation.follow_remove`,
`federation.moderate_approve`, `federation.moderate_reject`,
`federation.domain_policy`. **(Enum value add requires the hand-written migration
pattern — see CLAUDE.md drizzle rules / `0034_kind_to_text_fk.sql`.)**

Tables (every `references` declares `onDelete` per CLAUDE.md):

```ts
// Singleton: the local community actor. One row.
federation_actor {
  id           uuid pk defaultRandom
  handle       varchar(64)  notNull          // preferredUsername
  name         varchar(255) notNull
  summary      text
  publicKeyPem text         notNull          // cached copy of env public key
  keyId        varchar(512) notNull          // ${actorUri}#main-key
  displayNameMode  varchar(16) notNull default 'initialled'  // 'full' | 'initialled'
  enabled      boolean notNull default false // community-level switch
  createdAt    timestamp defaultNow notNull
  updatedAt    timestamp defaultNow notNull
}

// Remote actors following the community.
federation_followers {
  id             uuid pk defaultRandom
  actorUri       text notNull unique          // remote actor id
  inboxUrl       text notNull
  sharedInboxUrl text
  state          federationFollowerStateEnum notNull default 'pending'
  followActivityId text                        // the remote Follow id (for Undo match)
  followedAt     timestamp defaultNow notNull
  index on (state)
}

// THE opt-in egress ledger. Presence + revokedAt IS NULL = currently federated.
federation_shared_objects {
  id          uuid pk defaultRandom
  objectType  federationObjectTypeEnum notNull
  objectId    uuid notNull                    // posts.id OR community_posts.id
                                              // polymorphic: no FK, integrity in app
  activityId  text notNull                    // the Create activity id
  objectUri   text notNull                    // ${APP_URL}/api/federation/object/{type}/{id}
  sharedById  uuid -> users.id  on delete set null
  sharedAt    timestamp defaultNow notNull
  revokedAt   timestamp
  unique (objectType, objectId)               // a record shares at most once
  index on (objectType, objectId)
}

// One activity = one outbound event (Create/Update/Delete/Accept).
federation_outbox {
  id            uuid pk defaultRandom
  activityId    text notNull unique           // ${APP_URL}/api/federation/activity/{uuid}
  activityType  varchar(16) notNull           // Create|Update|Delete|Accept
  payload       jsonb notNull                 // the full signed-ready AS2 activity
  createdAt     timestamp defaultNow notNull
  index on (createdAt)
}

// Per-(activity, follower) delivery attempt. Drained by the cron worker.
federation_deliveries {
  id            uuid pk defaultRandom
  outboxId      uuid -> federation_outbox.id      on delete cascade  notNull
  followerId    uuid -> federation_followers.id   on delete cascade  notNull
  state         federationDeliveryStateEnum notNull default 'pending'
  attempts      integer notNull default 0
  lastError     text
  lastAttemptAt timestamp
  nextRetryAt   timestamp defaultNow notNull      // due when <= now()
  unique (outboxId, followerId)
  index on (state, nextRetryAt)
}

// Inbound activities awaiting moderation (replies) or processed (Follow/Undo).
federation_inbox {
  id               uuid pk defaultRandom
  remoteActorUri   text notNull
  activityType     varchar(32) notNull
  payload          jsonb notNull
  moderationState  federationModerationStateEnum notNull default 'pending'
  inReplyToObjectId uuid                          // local object the reply targets
  receivedAt       timestamp defaultNow notNull
  processedAt      timestamp
  index on (moderationState)
}

// Admin allow/block list, evaluated on every inbound activity.
federation_domain_policy {
  domain     varchar(255) pk
  policy     federationDomainPolicyEnum notNull
  reason     varchar(500)
  createdAt  timestamp defaultNow notNull
}
```

### AS2 serialization (`serialize.ts` — the single egress function)

`toActivityObject(record): As2Object` is the **only** place an internal record
becomes a federated object. It accepts `{type: 'notice'|'event', record}` and
returns the AS2 object; anything not on the allowlist throws. This is the
choke-point the negative-privacy test asserts against.

**Notice → `Note`** (`GET /api/federation/object/notice/{postId}`):

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://dom.sk/api/federation/object/notice/UUID",
  "type": "Note",
  "attributedTo": "https://dom.sk/api/federation/actor",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "cc": ["https://dom.sk/api/federation/actor/followers"],
  "published": "2026-06-09T08:00:00Z",
  "content": "<p>Jan N.: Výmena stúpačky v utorok 10.6. od 8:00.</p>",
  "contentMap": { "sk": "<p>…</p>" }
}
```

**Event → `Event`** (AS2 `Event`, Mobilizon-compatible):

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://dom.sk/api/federation/object/event/UUID",
  "type": "Event",
  "attributedTo": "https://dom.sk/api/federation/actor",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "cc": ["https://dom.sk/api/federation/actor/followers"],
  "name": "Schôdza vlastníkov",
  "content": "<p>Jan N.: Ročná schôdza.</p>",
  "startTime": "2026-06-12T17:00:00Z",
  "location": { "type": "Place", "name": "Spoločenská miestnosť" }
}
```

**Create / Update / Delete** wrap the object; the activity `id` is the
`federation_outbox.activityId`. **Delete** targets a `Tombstone`:

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://dom.sk/api/federation/activity/UUID",
  "type": "Delete",
  "actor": "https://dom.sk/api/federation/actor",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "object": { "id": "https://dom.sk/api/federation/object/notice/UUID",
              "type": "Tombstone" }
}
```

**Accept(Follow)** is generated synchronously on inbound `Follow` and delivered to
the follower's inbox.

### HTTP layer (`app/api/federation/**` + `.well-known`, all outside `[locale]`)

Per CLAUDE.md, each `route.ts` exports only HTTP handlers; logic imported from
`src/lib/federation/*`. Content type `application/activity+json` (accept
`application/ld+json; profile="…activitystreams"` too).

| Method & path | Purpose | Notes / status |
|---|---|---|
| `GET /.well-known/webfinger` | resolve `acct:` → actor URI | `404` if disabled; `400` bad `resource` |
| `GET /api/federation/actor` | actor document | `Cache-Control: public, max-age=300` |
| `GET /api/federation/actor/outbox` | paged `OrderedCollection` of `Create`s | shared objects only |
| `GET /api/federation/actor/followers` | followers `Collection` (count + page) | |
| `POST /api/federation/actor/inbox` | receive activities | **verify sig first**; `202` accept, `401` bad sig, `403` blocked domain |
| `GET /api/federation/object/{type}/{id}` | AS2 object | `200` if shared & not revoked; `410` `Tombstone` if revoked; `404` otherwise |
| `GET /api/cron/federation` | drain delivery queue | guarded by `x-cron-secret` == `CRON_SECRET` (reuses community-cron auth) |

### HTTP Signatures (`http-signature.server.ts`)

**Outbound (we sign):** signature over `(request-target) host date digest`
(POST adds `digest` = `SHA-256=base64(sha256(body))`). `Signature` header:
`keyId="…#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="…"`.
`Date` set to now; `Content-Type: application/activity+json`.

**Inbound (we verify):**
1. Parse `Signature` header → `keyId`.
2. Resolve `keyId` → remote actor → `publicKeyPem` (fetch once, **cache** in-memory
   keyed by `keyId`, TTL ~1 h; reuse the `cron-state.ts` in-memory-module pattern).
3. Reconstruct signing string from the listed `headers`; verify with the remote key.
4. Verify `Digest` matches the received body (`Create` etc.).
5. Reject if `Date` skew > **1 h** (Mastodon-compatible tolerance) → `401`.
6. On any failure → `401`, nothing persisted.

### Outbound flow (sequence)

```
admin clicks "Share to fediverse" on a notice/event
  -> egress.server.ts: assert allowlist(type) + community.enabled + instance flag
  -> serialize.ts: build Note/Event object  (the ONLY egress point)
  -> insert federation_shared_objects (objectType,objectId,activityId,objectUri)
  -> wrap in Create activity -> insert federation_outbox
  -> fan out: insert federation_deliveries (one per accepted follower, pending)
  -> write entity_audit_log: federation.share
  ── (async) ──
GET /api/cron/federation (external scheduler, x-cron-secret)
  -> select deliveries where state=pending AND nextRetryAt<=now LIMIT N
  -> for each: sign + POST activity to follower.inboxUrl
       2xx        -> state=delivered
       4xx (non-401 perm, e.g. 410 Gone) -> follower.state=dead, delivery=failed
       401/timeout/5xx -> attempts++, nextRetryAt = backoff(attempts),
                          give up at attempts>=8 -> state=failed
  -> update cron-state snapshot (counts), exposed via /api/admin/debug/cron
```

Edit of a shared object → `Update` activity (+ new deliveries). Unshare or delete →
set `revokedAt`, emit `Delete`+`Tombstone`, object endpoint then `410`. This
satisfies the CLAUDE.md "per-user mutable record must cover the undo/delete path"
rule (share is the mutable record; unshare/delete is its undo).

**Backoff schedule** (`backoff(attempts)`): 1 m, 5 m, 15 m, 1 h, 6 h, 24 h, 24 h,
then `failed`. Batch size `N` configurable (default 50) to bound cron runtime.

### Inbound flow (sequence)

```
POST /api/federation/actor/inbox  (remote server)
  -> verify HTTP signature (above)            fail -> 401
  -> domain of remoteActorUri in block policy? -> 403, drop
  -> dispatch by activity.type:
       Follow  -> upsert federation_followers(state=accepted),
                  deliver Accept(Follow), audit federation.follow_accept -> 202
       Undo{Follow} -> match followActivityId, remove follower,
                  audit federation.follow_remove -> 202
       Create{Note, inReplyTo a local object}
               -> insert federation_inbox(moderationState=pending) -> 202
                  (NOT surfaced anywhere until admin approves)
       (anything else) -> 202 accepted + ignored (be liberal on input)
```

### Moderation & admin surfaces

- **Per-post share control:** a toggle on the notice/event detail/edit view
  ("Zdieľať do fediverse"), admin-only, default off, with an "unshare" inverse. Calls
  the egress action.
- **Settings → Federation tab:** master on/off (community-level), handle, display
  name, summary, display-name mode (full / initialled), domain allow/block list,
  followers count + list.
- **Moderation queue:** list of `federation_inbox` rows with `moderationState =
  pending`; approve / reject; both write `entity_audit_log`. (Approval surfacing of
  replies into a community-visible thread is itself deferred — MVP only clears the
  queue and records the decision; rendering approved replies is a follow-up.)
- **Permissions:** sharing, moderating, and enabling federation are **admin-only**
  (reuse the existing admin gate; never `role==='owner'`-style checks copied from
  voting — community uses its own permission model per `docs/domain/community.md`).

### Privacy & safety gates (hard requirements)

1. **Default OFF** at both instance (`FEDERATION_ENABLED`) and community
   (`federation_actor.enabled`) levels. Endpoints `404` until both true.
2. **Allowlist of object types.** Only `notice | event` can enter
   `federation_shared_objects`, enforced by the single `serialize.ts` egress
   function — not scattered checks. Marketplace, directory entries, voting,
   mandates, documents, audit, memberships, and user PII have **no code path** to
   any activity or object endpoint.
3. **Per-post opt-in & revocable.** Default unshared; share is an explicit admin
   action; unshare/delete emits `Delete`+`Tombstone`.
4. **No contact PII.** Community authors; resident *display name* rendered as text
   only. Phone, e-mail, unit number, share fractions — never serialized.
5. **Inbound untrusted.** Signature-verified, domain-policy-filtered, parked in
   moderation, never auto-rendered.
6. **Single egress test.** A negative test enumerates every never-federate table
   and asserts no serializer path emits its fields.

### W3C / SocialCG alignment

Target conformance: ActivityPub (W3C Rec), ActivityStreams 2.0 vocab + JSON-LD
context, HTTP Signatures (draft-cavage-12), WebFinger (RFC 7033). Interop test
targets: **Mastodon** (follow + receive `Note`s) and **Mobilizon** (receive
`Event`s). FEPs tracked but **not** adopted in MVP: FEP-1b12 (group `Announce`),
FEP-8b32 (object integrity proofs). Decision against FEP-1b12 is deliberate — see
Notes.

## Acceptance Criteria

**Discovery & identity**
- [ ] `GET /.well-known/webfinger?resource=acct:{handle}@{APP_DOMAIN}` returns a JRD
      whose `self` link points to the actor URI; `400` on malformed `resource`.
- [ ] `GET /api/federation/actor` returns a valid `Group` actor
      (`application/activity+json`) with `inbox`, `outbox`, `followers`,
      `publicKey.publicKeyPem`, and a stable `id` independent of the handle.
- [ ] Changing the handle in settings does NOT change the actor `id`.

**Following**
- [ ] A remote Mastodon account searching `@{handle}@{APP_DOMAIN}` sees the
      community profile, can follow it, receives an `Accept`, and appears in
      `federation_followers` with `state='accepted'`.
- [ ] `Undo Follow` removes the follower; subsequent activities are not delivered to
      it.

**Outbound**
- [ ] Marking a notice "share" delivers a signed `Create Note` to every accepted
      follower; it renders in the follower's Mastodon timeline with the resident
      name as text and no contact data.
- [ ] An event federates as an AS2 `Event` with correct `startTime` and `location`
      and is visible in Mobilizon.
- [ ] Editing a shared object delivers `Update`; unshare/delete delivers `Delete`,
      and `GET /api/federation/object/{type}/{id}` then returns `410` `Tombstone`.
- [ ] A follower inbox returning `410 Gone` marks that follower `dead` and stops
      further delivery attempts; a transient `5xx` is retried per the backoff
      schedule and gives up at 8 attempts (`state='failed'`).

**Inbound & security**
- [ ] An inbound activity with missing/invalid HTTP signature → `401`, nothing
      persisted.
- [ ] An inbound activity whose actor domain is on the block policy → `403`,
      dropped.
- [ ] An inbound reply lands in `federation_inbox` as `pending`, is NOT visible
      anywhere in the community feed, and admin approve/reject writes
      `entity_audit_log`.

**Toggles & privacy**
- [ ] With `FEDERATION_ENABLED=0` OR `federation_actor.enabled=false`, WebFinger,
      actor, and inbox endpoints return `404` and no delivery is enqueued.
- [ ] **Negative privacy test:** no serializer path emits any field from
      `directory_entries`, `votes`/voting tables, mandates, `documents`,
      `memberships`, or `users` contact fields. Asserted in test, not review.

**Cross-cutting**
- [ ] All new admin UI strings exist in `sk.json`, `cs.json`, `en.json`.
- [ ] The actor RSA key is loaded from env (VAPID-style), distinct from
      `NEXTAUTH_SECRET` and the T2 Ed25519 key; the private key never enters the DB.
- [ ] `GET /api/cron/federation` is rejected without a valid `x-cron-secret`.

## Test plan

- **Unit:** `serialize.ts` (allowlist throws on non-allowlisted type; output shape);
  `http-signature.server.ts` (sign/verify round-trip; skew + digest-mismatch
  rejection); `backoff()` schedule.
- **Integration (DB):** share → outbox + deliveries fan-out; unshare → tombstone +
  410; follow/undo lifecycle; inbound reply → moderation queue; domain block → 403;
  delivery worker state transitions incl. dead follower.
- **Negative privacy:** table-driven test enumerating never-federate fields.
- **Interop (documented runbook, Playwright-driven):** follow from a real Mastodon
  test instance and receive a notice; publish an event and view it in Mobilizon;
  verify signature acceptance both directions. Uses the **Playwright** runner
  introduced by T4 (BYT-20260609-003) — no separate browser-automation dependency.
  localhost cannot federate — runbook documents using a public test host / tunnel.

## Implementation phases (≈150 h)

1. **Identity & discovery** (~25 h): keygen script, actor doc, WebFinger, toggles,
   `federation_actor` table + settings tab skeleton.
2. **HTTP Signatures** (~25 h): sign + verify + remote-key cache; the security core.
3. **Outbound** (~40 h): `serialize.ts`, egress action, outbox + deliveries,
   `/api/cron/federation` worker, backoff, per-post share UI, audit.
4. **Inbound** (~30 h): inbox endpoint, follow/undo, reply → moderation queue,
   domain policy, moderation UI.
5. **Interop, privacy test & docs** (~30 h): Mastodon/Mobilizon runbook, negative
   privacy test, self-host federation guide (feeds T6), i18n sweep.

## Project Context

- **Actor source:** root `entities` row, `rootId == id && depth == 0`
  (`src/db/schema.ts:262`). One building per instance ⇒ single actor.
- **Federatable tables:** `posts` (`:395`, notices) → `Note`; `community_posts`
  (`:770`) where `type='event'` → `Event`. Other `community_posts` types
  (`:104`) not federated.
- **Never-federate:** `community_posts` marketplace/help rows, `directory_entries`,
  `event_rsvps`, `community_responses`, `documents`, voting tables, `memberships`,
  `users`.
- **Cron precedent reused:** `src/app/api/cron/community/route.ts` (auth via
  `CRON_SECRET` + `x-cron-secret` header, line ~194-202) and the in-memory snapshot
  in `src/lib/cron-state.ts`. `/api/cron/federation` mirrors both.
- **Key precedent reused:** VAPID env keys (`VAPID_PRIVATE_KEY`,
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in `.env.example`) — RSA actor key stored the same
  way; no encrypted-DB column.
- **Display-name source:** `users.name` (`src/db/schema.ts`, single varchar). The
  `displayNameMode` setting controls full vs initialled rendering.
- **Audit convention:** dotted action names (`entity.create`, `membership.create`);
  new federation actions follow `federation.*`.
- **Enum-add migration:** adding `federation.*` to `entity_audit_action` and the new
  `federation_*` enums uses the hand-written-SQL drizzle pattern (CLAUDE.md;
  `0034_kind_to_text_fk.sql` precedent) — `drizzle-kit generate` can't alter enums
  safely.
- **Module-vs-core:** core subsystem (`src/lib/federation/`); reuses the module
  system's capability/signing *precedent*, not its loader. Tension with T5
  ("everything is a module") is intentional — federation is platform infrastructure,
  like auth, not a per-jurisdiction feature.
- **Cross-cutting visual note:** adds an admin moderation surface + per-post share
  control. Not a theming/RTL spec, so the CLAUDE.md FOUC subsection does not apply;
  standard i18n coverage does.

## Notes

### Decisions locked (2026-06-09)

- **Federatable content:** notices + events only. Marketplace dropped (disabled in
  product). Help posts = possible fast-follow.
- **Actor / attribution:** single `Group` actor authors all objects; resident
  display name rendered as text; **no per-user actors, no FEP-1b12 `Announce`**.
- **Inbound scope:** `Follow`/`Undo` + replies → moderation queue (hidden until
  approved). Two-way loop.
- **Delivery infra:** reuse the cron pattern (`/api/cron/federation` mirroring
  `/api/cron/community`), DB-backed retry. No new queue dependency; delivery latency
  = cron interval (acceptable for MVP).
- **Keys:** RSA-2048 in env, VAPID-style, generated by `pnpm federation:keygen`. No
  encrypted-DB private-key column.
- **Actor URI:** opaque, stable (`${APP_URL}/api/federation/actor`), handle-change
  safe.

### Remaining open questions

- **Approved-reply surfacing:** MVP only clears the moderation queue + records the
  decision. Whether/where an *approved* remote reply renders in the community UI is
  a follow-up (touches the community feed model + `docs/domain/community.md`
  "community isolated from governance" invariant).
- **Self-host HTTPS:** federation requires a public HTTPS host with a valid cert
  (Caddy provides this in prod). Document that localhost / IP-only deploys (`APP_URL`
  defaults to `http://localhost:3000`) cannot federate. → T6 self-host guide.
- **Key rotation:** env-key rotation procedure (publish new `keyId`, dual-serve
  during overlap) — document; not MVP-blocking since rotation is rare and operator-
  driven.
- **Cron cadence:** confirm the external scheduler interval that drives
  `/api/cron/federation` (delivery latency tradeoff); inherit whatever drives
  `/api/cron/community`.

### References

- ActivityPub — https://www.w3.org/TR/activitypub/
- ActivityStreams 2.0 Vocabulary — https://www.w3.org/TR/activitystreams-vocabulary/
- HTTP Signatures (draft-cavage-12) — https://datatracker.ietf.org/doc/html/draft-cavage-http-signatures-12
- WebFinger (RFC 7033) — https://www.rfc-editor.org/rfc/rfc7033
- Mastodon ActivityPub conformance — https://docs.joinmastodon.org/spec/activitypub/

Placement note: filed in `specs/specs/` (status `spec`) alongside the other NLnet
grant-task specs (T1 passkey, T2 audit bundle). Load-bearing decisions (content
scope, actor/attribution, inbound scope, delivery infra, key storage, actor URI)
are locked; the four items above are design/ops details that do not block the data
model. Ready to promote to `in_progress` once T3 work starts under the grant.
