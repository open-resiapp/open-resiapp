---
spec_id: BYT-20260513-006
title: "Cloud SSO sign-in endpoint (one-click instance access)"
status: implemented
created: 2026-05-13
updated: 2026-05-13
author: Filip
owner: Filip
last_verified: 2026-05-13
project_type: node
depends_on: []
related_handoffs: ["2026-05-13-resiapp-cloud-to-byt-app-demo-module-and-identity-import.md"]
tags: [auth, sso, cloud-onboarding, nextauth, jwt, security]
feature_branch: ""
changelog_version: "2.1.1"
changelog_date: "2026-05-13"
docs_version: ""
docs_communicated: ""
---

## Goal

Cloud customers click "Open my app" in the cloud dashboard and land already signed-in on their byt-app instance. Today the flow forces a second per-instance login (separate password via `setup-account` email), which non-technical chairpersons routinely get stuck on. Cloud-side already implements the signed-token issuer (ORC-20260513-014). This spec adds the verify-and-sign-in half on the byt-app side.

## Scope

**IN scope:**
- New route `GET /api/auth/sso?token=<JWT>` (locale-less)
- New NextAuth Credentials provider `"cloud-sso"` whose `authorize({ token })` verifies the JWT and returns the user
- JWT verification: HS256 signature against `CLOUD_SSO_SECRET`; checks `iss=resiapp.cloud`, `aud == NEXTAUTH_URL host`, `exp > now`, `iat <= now`, `exp - iat <= 600`, `jti` not previously consumed
- New table `sso_consumed_tokens(jti char(32) pk, expires_at timestamptz)` for replay protection (durable across restarts)
- First-time user create from `sub` (email) + `name` + role-mapped `role` (cloud `admin_system|admin → admin`, cloud `viewer → owner`); never updates role on existing users
- Bypass of the `passwordHash` check that the standard Credentials provider enforces — JWT signature is the trust anchor
- `isActive=false` / `status='rejected'` rejection respected
- Self-hosted defence: `CLOUD_SSO_SECRET` unset → 503 + redirect to `/login?error=sso_unsupported`
- Optional `INSTANCE_ORG_ID` env: if set, token must carry matching `org_id`
- Locale-aware error/success redirect using `?locale=sk|en|cs` query param (cloud-supplied), fallback to `LANGUAGE` env default

**OUT of scope:**
- Token role-sync for existing users (deliberate — first-time-only is the defence-in-depth posture agreed in the handoff)
- Cloud → byt-app role updates of any kind
- Replay window > 5 min (cloud's `exp = iat + 300`)
- OAuth-style code exchange / PKCE (signed redirect JWT is simpler and sufficient given short `exp` + `jti` replay protection)
- Magic-link variant (the SSO link IS the magic link, lifetime-capped)
- Cron cleanup of `sso_consumed_tokens` rows — covered by spec BYT-20260513-007 (write follow-up if not already filed); for v1 we accept unbounded growth bounded by issuance rate

## Approach

### 1. Database

New table:

```ts
export const ssoConsumedTokens = pgTable("sso_consumed_tokens", {
  jti: char("jti", { length: 32 }).primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
```

`drizzle-kit generate` → new migration in `drizzle/migrations/`.

### 2. NextAuth provider

In `src/lib/auth.ts`, add a second Credentials provider alongside the existing one:

```ts
Credentials({
  id: "cloud-sso",
  name: "Cloud SSO",
  credentials: { token: { type: "text" } },
  async authorize(credentials) {
    return await verifySsoTokenAndUpsertUser(credentials?.token);
  },
}),
```

`verifySsoTokenAndUpsertUser()` lives in `src/lib/sso.server.ts` (named `.server.ts` to keep it out of any client bundle that might import other auth types — see project CLAUDE.md rule on `src/lib/*` split):

1. If `process.env.CLOUD_SSO_SECRET` is unset → throw `SsoUnsupported`
2. Decode + verify JWT signature (HS256, `jsonwebtoken` lib already a transitive dep — confirm during impl; if not, prefer `jose`)
3. Validate claims:
   - `iss === "resiapp.cloud"`
   - `aud === new URL(process.env.NEXTAUTH_URL).host`
   - `exp > now`, `iat <= now`, `exp - iat <= 600`
   - `process.env.INSTANCE_ORG_ID` matches `org_id` (only if env is set)
4. Atomically insert `jti` into `sso_consumed_tokens` — UNIQUE violation → `SsoReplay`
5. Lookup user: `where(eq(lower(users.email), lower(sub)))` (case-insensitive)
6. If exists:
   - reject if `isActive === false` or `status === "rejected"` → `SsoBlocked`
   - return `{ id, email, name, role, status }` — role and name unchanged
7. If not exists:
   - validate `claims.role` is one of `admin_system | admin | viewer`; reject otherwise
   - map: `admin_system → admin`, `admin → admin`, `viewer → owner`
   - insert with email=sub, name=name-from-token, role=mapped, passwordHash=NULL, status='active', isActive=true
   - return new user object

### 3. Route handler

`src/app/api/auth/sso/route.ts`:

```ts
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const locale = sanitizeLocale(req.nextUrl.searchParams.get("locale"));
  try {
    const result = await signIn("cloud-sso", { token, redirect: false });
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, req.url), {
      headers: { "Referrer-Policy": "no-referrer" },
    });
  } catch (err) {
    const code = ssoErrorCode(err); // sso_invalid|sso_expired|sso_replay|sso_unsupported|sso_blocked
    return NextResponse.redirect(
      new URL(`/${locale}/login?error=${code}`, req.url),
      { headers: { "Referrer-Policy": "no-referrer" } },
    );
  }
}
```

### 4. Login page error handling

Add i18n keys `Sso.error.invalid`, `Sso.error.expired`, `Sso.error.replay`, `Sso.error.unsupported`, `Sso.error.blocked` in `messages/sk.json` + `messages/en.json` (+ `cs.json` if installed). Render the matching string when `?error=sso_*` is present on the login page.

### 5. Env documentation

`.env.example` adds:

```
# Cloud SSO (managed-hosting only; leave unset on self-hosted to disable)
CLOUD_SSO_SECRET=
INSTANCE_ORG_ID=
```

## Acceptance Criteria

- [ ] Migration adds `sso_consumed_tokens` table
- [ ] `GET /api/auth/sso?token=<valid JWT>` opens NextAuth session and 302s to `/{locale}/dashboard`
- [ ] Existing user signs in successfully without password input; role + name preserved
- [ ] Non-existing user with cloud role `admin_system` or `admin` → byt-app role `admin`
- [ ] Non-existing user with cloud role `viewer` → byt-app role `owner`
- [ ] Non-existing user create: name from token + `passwordHash IS NULL`
- [ ] Unknown cloud role → `sso_invalid`
- [ ] Replayed token (same `jti`) → 302 to `/{locale}/login?error=sso_replay`
- [ ] Expired token (`exp < now`) → `sso_expired`
- [ ] Wrong signature → `sso_invalid`
- [ ] Wrong `aud` (different instance domain) → `sso_invalid`
- [ ] Wrong `iss` → `sso_invalid`
- [ ] `iat > now + 60` (clock skew) → `sso_invalid`
- [ ] `exp - iat > 600` → `sso_invalid`
- [ ] `INSTANCE_ORG_ID` set + token `org_id` differs → `sso_invalid`
- [ ] `INSTANCE_ORG_ID` unset → `org_id` ignored
- [ ] `CLOUD_SSO_SECRET` unset → 302 to `sso_unsupported`
- [ ] Deactivated user (`isActive=false` or `status='rejected'`) → `sso_blocked`
- [ ] Shell-paired user (email matches, `passwordHash IS NULL`) signs in via SSO (passwordHash check bypassed)
- [ ] `Referrer-Policy: no-referrer` header on both success and error responses
- [ ] `onUserLogin` module hook fires on SSO sign-in (already triggered by NextAuth `events.signIn`)
- [ ] Standard credentials provider still works (regression check)
- [ ] All new strings in `sk.json` + `en.json` (+ `cs.json` if present)

## Project Context

- Auth lives in `src/lib/auth.ts` (NextAuth v5 Credentials + JWT session strategy)
- `users` table at `src/db/schema.ts:311` — email nullable, partial unique index on `email IS NOT NULL` (`schema.ts:332-334`)
- Role enum at `schema.ts:22`: `admin | owner | tenant | vote_counter | caretaker`
- `dispatchHook("onUserLogin", ...)` at `auth.ts:114-123` covers any provider's sign-in
- Shell users (BYT-20260508-003): NULL email + NULL passwordHash until pairing; never SSO targets but post-pairing edge needs the passwordHash bypass
- `NEXTAUTH_URL` already required env, used in 8+ places (`src/lib/invitations.ts:22`, etc.)
- Project CLAUDE.md rule on `*.server.ts` split applies — keep `next/headers` out of any module a client component might pull through

## Notes

- 2026-05-13 — initial draft after handoff SSO addendum.
- 2026-05-13 — cloud answered all 4 open questions:
  1. Role mapping: cloud corrected role enum is `admin_system | admin | viewer` (not the earlier `owner | member`). Final mapping per user direction:
     - `admin_system → admin`
     - `admin → admin`
     - `viewer → owner` (byt-app `owner` is the regular participating-resident role; `tenant` would be too narrow for a portal-viewer who may also be an owner of a unit)
  2. `INSTANCE_ORG_ID` env: yes, cloud injects per instance. Spec already requires it.
  3. Locale: cloud appends `&locale=<sk|en|cs>`.
  4. `jti` cleanup: daily cron.
- Ready to promote to `in_progress` once handoff moves to `agreed`.
