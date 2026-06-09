---
spec_id: RES-20260428-003
title: "WebAuthn/Passkeys Voting – Module"
status: spec
created: 2026-04-28
updated: 2026-06-09
author: "open-housing"
owner: "filipvnencak"
last_verified: 2026-06-09
project_type: other
depends_on: [RES-20260428-002, RES-20260417-001]
related_handoffs: []
tags: [passkey, webauthn, biometrics, voting, security, nlnet-grant]
changelog_version: ""
changelog_date: ""
docs_version: ""
---

## Goal

Add cryptographic vote verification (FaceID / TouchID / Windows Hello / security keys) to open-housing as an **open-source module** shipped in the AGPL-3.0 repository, installable on any self-hosted instance via the standard module admin UI. The module strengthens vote authenticity beyond email confirmation, surfaces the proof in the PDF zápisnica, and helps satisfy the identity-verification requirement of §14a zák. 182/1993 Z.z. for Slovak HOAs. It is the NLnet grant's **T1** deliverable and ships upstream like the rest of the funded work.

This is the first concrete consumer of the module system defined in **RES-20260428-002**. It validates that the SDK, lifecycle hooks, UI slots, permission model, and per-module DB conventions are sufficient for a real, security-sensitive feature.

### Problem Statement

Slovak HOA voting law requires reliable identification of the voter. Today open-housing relies on email confirmation, which is acceptable for many communities but is the weakest link in the chain — anyone with mailbox access can vote. A passkey gives a verifiable cryptographic proof tied to a hardware-backed credential and a clean audit trail in the zápisnica, for any community that chooses to install the module.

As a module, the feature follows normal module semantics: an instance that has not installed it carries **no reference to the feature** — no env flag, no commented-out code, no stub. Absence of the package = the feature does not exist for that instance.

## Scope

**In scope**
- A self-contained module package `@open-housing/passkey-voting`
- Module-owned `authenticators` table (managed by this module, never by core)
- Four API routes under `/api/modules/passkey/`
- `voting.before` slot injection — `BiometricVoteButton`
- `settings.tabs` slot injection — passkey device management
- Vote audit annotation via `sdk.votes.annotate()` (no direct write to `votes` table)
- Replay-protection challenge format (`votingId + choice + userId + timestamp`)
- Counter validation for cloned-authenticator detection
- Graceful fallback when `window.PublicKeyCredential` is unavailable
- PDF zápisnica enhancement showing biometric badge per voter
- Module-scoped env vars set by the operator/admin at install time
- Open-source distribution in the AGPL repo, installed via the module admin UI

**Out of scope**
- Any change to the open-source core to "support" this module — RES-20260428-002 must already be sufficient. If something is missing there, file a follow-up spec against the module system, not against core.
- Roaming authenticators / cross-device passkey sync UX (works because the standard handles it; no extra UI work)
- Multi-tenant key rotation / RP ID migration tooling — separate ops spec
- Replacing email confirmation as a fallback — fallback remains; this module **adds** a stronger path
- Mobile-app native integration — browser WebAuthn only for v1

## Approach

### Module identity

```yaml
# module.json
name: "@open-housing/passkey-voting"
version: "1.0.0"
description: "Cryptographic vote signing via WebAuthn/Passkeys"
entry: "dist/index.js"
minCoreVersion: "0.5.0"
permissions:
  - db:read
  - db:write
  - ui:inject
uiSlots:
  - voting.before
  - settings.tabs
checksum: "sha256:..."
```

### Module entry

```typescript
import { defineModule } from '@open-housing/sdk';
import { onInstall, onUninstall } from './lifecycle';
import { BiometricVoteButton } from './ui/BiometricVoteButton';
import { PasskeySettingsTab } from './ui/PasskeySettingsTab';
import { mountRoutes } from './routes';

export default defineModule({
  name: '@open-housing/passkey-voting',

  async onInstall(ctx)   { await onInstall(ctx); },
  async onUninstall(ctx) { await onUninstall(ctx); },
  async onAppStart(ctx)  { await mountRoutes(ctx); },

  ui: {
    'voting.before':  () => import('./ui/BiometricVoteButton'),
    'settings.tabs':  () => import('./ui/PasskeySettingsTab'),
  },
});
```

### Database

Module-owned table (per RES-20260428-002 prefix convention):

```ts
// migrations/0001_authenticators.sql (generated via drizzle-kit)
CREATE TABLE mod_passkey_voting_authenticators (
  id                 text PRIMARY KEY,                  -- credentialID (base64url)
  user_id            text NOT NULL,                     -- references core users via SDK
  community_id       text NOT NULL,
  public_key         bytea NOT NULL,
  counter            bigint NOT NULL DEFAULT 0,
  transports         text[],                            -- ['internal','hybrid','usb',...]
  device_label       text,                              -- "iPhone 15", "MacBook Pro"
  aaguid             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz
);

CREATE INDEX ON mod_passkey_voting_authenticators (user_id);
CREATE INDEX ON mod_passkey_voting_authenticators (community_id);
```

Challenges live in a short-TTL table (5 min):

```ts
CREATE TABLE mod_passkey_voting_challenges (
  challenge   text PRIMARY KEY,                         -- base64url, opaque
  user_id     text NOT NULL,
  purpose     text NOT NULL,                            -- 'register' | 'auth' | 'vote'
  payload     jsonb,                                    -- voting context for 'vote' purpose
  expires_at  timestamptz NOT NULL
);
```

Core `votes` table is **read-only** to this module. Audit fields are added through `sdk.votes.annotate(voteId, payload)` — the SDK writes to a core-managed `vote_annotations` table (or extra columns; decided in RES-20260428-002 implementation). This module never issues `INSERT/UPDATE` on `votes`.

### API routes

Mounted under `/api/modules/passkey/` by the module on `onAppStart`:

| Method | Path                              | Purpose                                |
|--------|-----------------------------------|----------------------------------------|
| POST   | `/register/options`               | issue registration challenge           |
| POST   | `/register/verify`                | verify attestation, persist credential |
| POST   | `/vote/options`                   | issue vote-bound auth challenge        |
| POST   | `/vote/verify`                    | verify assertion, annotate vote        |

All routes go through `sdk.auth.requireUser()` and `sdk.community.current()` — no direct NextAuth or DB use.

### WebAuthn — registration

```typescript
// /api/modules/passkey/register/options
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { sdk } from '@open-housing/sdk';

export async function POST() {
  const user = await sdk.auth.requireUser();

  const options = await generateRegistrationOptions({
    rpID:   process.env.PASSKEY_RP_ID!,
    rpName: process.env.PASSKEY_RP_NAME!,
    userID: Buffer.from(user.id),
    userName: user.email,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
    excludeCredentials: await listUserCredentials(user.id),
  });

  await sdk.db.write('mod_passkey_voting_challenges', {
    challenge:  options.challenge,
    user_id:    user.id,
    purpose:    'register',
    expires_at: new Date(Date.now() + 5 * 60_000),
  });

  return Response.json(options);
}
```

```typescript
// /api/modules/passkey/register/verify
import { verifyRegistrationResponse } from '@simplewebauthn/server';

export async function POST(req: Request) {
  const user = await sdk.auth.requireUser();
  const body = await req.json();

  const challenge = await consumeChallenge(body.response.clientDataJSON, user.id, 'register');

  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge: challenge,
    expectedOrigin: process.env.PASSKEY_ORIGIN!,
    expectedRPID:   process.env.PASSKEY_RP_ID!,
    requireUserVerification: true,
  });

  if (!verification.verified) return new Response('not verified', { status: 400 });

  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo!;
  const community = await sdk.community.current();

  await sdk.db.write('mod_passkey_voting_authenticators', {
    id:           toBase64Url(credentialID),
    user_id:      user.id,
    community_id: community.id,
    public_key:   credentialPublicKey,
    counter,
    transports:   body.response.transports ?? [],
    device_label: body.deviceLabel ?? null,
    aaguid:       verification.registrationInfo?.aaguid ?? null,
  });

  return Response.json({ ok: true });
}
```

### WebAuthn — voting

Challenge **encodes the vote intent** so a captured challenge cannot be reused for a different choice:

```typescript
// /api/modules/passkey/vote/options
const { votingId, choice } = await req.json();
const user = await sdk.auth.requireUser();

await sdk.votes.assertCanVote(user.id, votingId);   // SDK enforces eligibility

const ts = Date.now();
const intent = `${votingId}|${choice}|${user.id}|${ts}`;
const challenge = base64url(sha256(intent));

const options = await generateAuthenticationOptions({
  rpID: process.env.PASSKEY_RP_ID!,
  userVerification: 'required',
  allowCredentials: await listUserCredentials(user.id),
  challenge,
});

await sdk.db.write('mod_passkey_voting_challenges', {
  challenge,
  user_id: user.id,
  purpose: 'vote',
  payload: { votingId, choice, ts },
  expires_at: new Date(ts + 5 * 60_000),
});

return Response.json(options);
```

```typescript
// /api/modules/passkey/vote/verify
const body = await req.json();
const user = await sdk.auth.requireUser();

const ch = await consumeChallenge(body.response.clientDataJSON, user.id, 'vote');
const { votingId, choice, ts } = ch.payload as VotePayload;

const authenticator = await getAuthenticator(body.id, user.id);

const verification = await verifyAuthenticationResponse({
  response: body,
  expectedChallenge: ch.challenge,
  expectedOrigin: process.env.PASSKEY_ORIGIN!,
  expectedRPID:   process.env.PASSKEY_RP_ID!,
  authenticator,
  requireUserVerification: true,
});

if (!verification.verified) return new Response('not verified', { status: 400 });

// Counter must strictly advance — otherwise authenticator is cloned.
if (verification.authenticationInfo.newCounter <= authenticator.counter) {
  await sdk.log.error('passkey-voting: counter regression', { credId: authenticator.id });
  return new Response('counter regression', { status: 400 });
}

await bumpCounter(authenticator.id, verification.authenticationInfo.newCounter);

const signature = body.response.signature;        // base64url
const auditHash = sha256Hex([
  votingId, choice, user.id, ts, signature, authenticator.id,
].join('|'));

const voteId = await sdk.votes.castVote({ votingId, userId: user.id, choice });

await sdk.votes.annotate(voteId, {
  verifiedByBiometrics: true,
  webauthnSignature:    signature,
  webauthnChallenge:    ch.challenge,
  authenticatorId:      authenticator.id,
  auditHash,
});

return Response.json({ ok: true, voteId });
```

### Audit fields on votes (via SDK)

```typescript
type VoteAuditPayload = {
  verifiedByBiometrics: true;
  webauthnSignature:    string;   // base64url
  webauthnChallenge:    string;   // base64url
  authenticatorId:      string;
  auditHash:            string;   // sha256 hex of the payload tuple
};

sdk.votes.annotate(voteId, payload as VoteAuditPayload);
```

The SDK writes these into a core-managed `vote_annotations` table (or extra columns — final shape decided in RES-20260428-002). The module never touches `votes` directly.

### UI — BiometricVoteButton (voting.before slot)

```tsx
import { startAuthentication } from '@simplewebauthn/browser';

export function BiometricVoteButton({ votingId, choice }: SlotProps) {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return null;

  return (
    <button onClick={async () => {
      const opts = await fetch('/api/modules/passkey/vote/options', {
        method: 'POST',
        body: JSON.stringify({ votingId, choice }),
      }).then(r => r.json());

      const assertion = await startAuthentication(opts);

      const result = await fetch('/api/modules/passkey/vote/verify', {
        method: 'POST',
        body: JSON.stringify(assertion),
      });

      if (!result.ok) throw new Error('biometric verification failed');
    }}>
      Hlasovať s biometriou
    </button>
  );
}
```

The standard email-confirmation vote button continues to render below — module **adds**, never replaces. If WebAuthn is unsupported, the component returns `null` and the user sees the standard flow only.

### Open-source distribution & install

This module is distributed and installed like any other open-source module:

1. The module source lives in the **AGPL-3.0 repository** alongside the other reference modules (e.g. `modules/intercom-2n`), built and versioned the same way.
2. An operator or community admin installs it via the **standard module admin UI** — zip upload or GitHub release URL, per RES-20260428-002 — and approves its declared permissions.
3. Core has **zero** references to the module:
   - No env flag like `PASSKEY_ENABLED`
   - No commented-out import
   - No conditional UI in core that "becomes active" when the module is present
   - The `voting.before` slot exists for **all** modules; this module just happens to be one consumer.
4. **Absent module = absent feature:** an instance that has not installed it shows no trace of passkeys in UI, env, or DB.
5. Removal: admin uninstalls like any other module. Core remains identical.

This is exactly the value of RES-20260428-002 — the absence of a module is indistinguishable from the absence of a feature.

### Fallback behavior

| State                                            | Behavior                                                       |
|--------------------------------------------------|----------------------------------------------------------------|
| Module not installed                             | Voting UI unchanged. No mention of passkeys anywhere.          |
| Module installed, browser supports WebAuthn      | Biometric button rendered above standard buttons.              |
| Module installed, browser **lacks** WebAuthn     | Component returns `null`. Inline notice: "Biometric verification not supported on this device." Standard flow used. |
| Module installed, user has no registered device  | Component shows "Add a biometric device first" linking to settings. |

In all cases, the email-confirmation flow remains the baseline and is fully sufficient for §14a compliance on its own.

### Legal compliance — §14a zák. 182/1993 Z.z.

§14a requires identification of the voter and integrity of the vote.

- **Identification**: WebAuthn binds the assertion to a hardware-backed credential previously registered to a verified user account. The assertion includes `userVerification: 'required'`, so the device must perform local biometric or PIN check before signing. This is materially stronger than possession of an email mailbox.
- **Integrity**: The signed challenge **encodes the vote intent** (`votingId|choice|userId|timestamp`). Any tampering with the choice between the user's intent and the server invalidates the signature.
- **Non-repudiation**: The signature plus public key allow recomputing and verifying the proof at any later point in time.
- **PDF zápisnica audit section** shows, per voter:
  - Voter identifier (name, unit, choice)
  - Verification method badge: 🔒 Biometricky overené **or** ✉️ Email overenie
  - When biometric: short hash prefix and device label
  - All raw signatures and challenges remain in the database, not the PDF
- **Retention**: Authenticators and annotated audit fields are retained for at least **10 years** after the vote closes — covers HOA dispute and accounting timelines. Configurable per community; never below the legal minimum.

Disclaimer in spec: this is the engineering plan; legal sign-off on whether biometric WebAuthn satisfies §14a in a given dispute is confirmed by the independent legal opinions (grant T9), not asserted by core.

### PDF zápisnica enhancement

When the module is active, the PDF generator (core) reads the annotation fields via SDK and renders:

```
Elektronicky hlasujúci vlastníci:
─────────────────────────────────────────────────────────
Ján Novák,  byt 12,  ZA       🔒 Biometricky overené
                               Hash: a3f9c2d1...
                               Zariadenie: iPhone 15
Anna K.,    byt 5,   ZA       ✉️  Email overenie
─────────────────────────────────────────────────────────
```

Core PDF generator is **module-agnostic** — it asks the SDK for "verification badges" per vote; the module supplies them via a registered formatter. No core change is needed beyond what RES-20260428-002 already provides.

### Module-scoped env vars

Set by the operator/admin when installing the module, never by end users:

```env
PASSKEY_RP_ID=baryum.org
PASSKEY_RP_NAME="Bytové spoločenstvo Baryum"
PASSKEY_ORIGIN=https://baryum.org
```

Module reads these on `onAppStart`; missing values cause `onAppStart` to log a clear error and refuse to register routes. Module disables itself rather than starting in a broken state.

## Acceptance Criteria

- [ ] Module ships in the AGPL repository alongside the other reference modules; tagged releases produce a built artifact installable via the standard module admin UI (zip or GitHub release URL); no core files modified
- [ ] An operator/admin installs and activates the module via the module admin UI with no manual core edits
- [ ] An instance that has not installed the module shows zero traces of passkeys in UI, env, or DB
- [ ] Module installs without modifying any core files; install/uninstall toggled via the standard module admin UI
- [ ] Module uninstalls cleanly: drops `mod_passkey_voting_*` tables, deregisters routes and slots
- [ ] `BiometricVoteButton` appears in `voting.before` only when module is active and browser supports WebAuthn
- [ ] Vote signed via passkey has `verifiedByBiometrics: true` and matching audit fields visible via SDK read
- [ ] Captured challenge cannot be reused: second `/vote/verify` call with the same challenge returns 400
- [ ] Captured challenge for choice A cannot be replayed for choice B: hash mismatch rejects the request
- [ ] Authenticator counter regression (newCounter ≤ stored) returns 400 and logs a "cloned authenticator" warning
- [ ] PDF zápisnica renders 🔒 badge with hash and device label for biometrically verified votes; ✉️ badge for the rest
- [ ] WebAuthn-unsupported browser falls back silently to standard email confirmation; no error shown
- [ ] No raw `INSERT/UPDATE` on the core `votes` table from anywhere in this module's code (build-time check)
- [ ] All four API routes require an authenticated session via `sdk.auth.requireUser()`
- [ ] Missing `PASSKEY_RP_ID`/`PASSKEY_ORIGIN` causes module to refuse to start with a clear log line; core remains healthy
- [ ] Audit data (authenticators + annotations) retained for at least 10 years per community retention policy

## Project Context

- This is an optional **open-source module**, not a core feature. It ships in the AGPL repo and exists on instances where an admin has installed it — like any reference module.
- It is the NLnet grant's **T1** deliverable and ships AGPL-3.0 upstream alongside the rest of the funded work.
- Hard dependency on RES-20260428-002 (plugin/module system) — without that spec implemented, this module has nowhere to plug into.
- Soft dependency on RES-20260417-001 (community foundation) for `Community` and `Member` types via `sdk.community`.
- This module also serves as the **proof case** that the module SDK is sufficient for security-sensitive features. Anything missing from the SDK (e.g., `sdk.votes.annotate`, `sdk.votes.assertCanVote`, `sdk.auth.requireUser`) is a gap to file against RES-20260428-002, not a reason to break the abstraction.

## Notes

- Open question: should the SDK support **registering a "verification provider"** so the PDF generator and any future audit UI can render badges from any module (passkey today, eID tomorrow), without a switch on module name? Lean yes — file as a follow-up against RES-20260428-002 if not already covered.
- Open question: cross-device passkey sync (iCloud Keychain, Google Password Manager) — works out of the box at the WebAuthn layer, but document the UX so admins understand "the device label may not match the originally registered device." No code change needed.
- Open question: should we record `aaguid` → human-readable model name via the FIDO MDS feed? Nice for the zápisnica but adds an external dependency. Defer.
- The grant's T1 scope also names recovery codes + printable backup, a role/permission redesign, and §14a edge-case integration tests; these are tracked as T1 work but kept out of this module spec's current scope deliberately.
