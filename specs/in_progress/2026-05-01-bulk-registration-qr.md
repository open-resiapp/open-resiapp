---
spec_id: RES-20260501-001
title: "Bulk self-registration via QR code with admin approval"
status: in_progress
created: 2026-05-01
updated: 2026-05-05
author: open-housing
owner: open-housing
last_verified: 2026-05-05
project_type: other
depends_on: []
related_handoffs: []
tags: [auth, registration, admin, onboarding, qr]
feature_branch: feature/bulk-registration-qr
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal
HOAs need a low-friction way to onboard residents at scale. Today every new
user requires an admin-issued single-use invitation token, which does not
scale when an admin wants to onboard a whole building at once. This spec
introduces a durable registration link (rendered as a printable QR code)
that residents scan to submit a self-registration. Submissions land in an
admin approval queue — the admin assigns the correct flat and role before
the user gains access — preventing strangers, bots, or impostor residents
from logging in.

## Scope

**In scope:**
- One durable registration token per community (single-tenant app), rotatable by admin
- Admin UI to generate, view, rotate, and disable the registration QR code
- Printable QR view (PDF or print-friendly page) rendering the registration URL
- Public registration page (no auth) reachable via QR / token URL: collects name + email + password + phone + consent
- Email verification step: submission only enters approval queue after resident confirms email
- Pending user state in `users` table via `status` enum (`pending | active | rejected`)
- Pending users can log in but are restricted to a read-only community info page
- Admin approval queue UI: list pending registrations, assign flat (required), confirm role (defaults to `owner`), approve or reject
- Admin notification on new pending registration (one notification per admin per submission, via existing `*_notifications_sent` pattern)
- Rejected submissions soft-deleted (`status: rejected`) — email blocked from re-submitting until admin clears it
- Rate limiting on the public registration endpoint (per IP)
- Rate limiting on email verification endpoint
- Audit log entries for: token generation, token rotation, registration submission, email verification, approval, rejection

**Out of scope:**
- Per-flat or per-entrance QR codes (existing per-flat invitation flow already covers this)
- Self-service flat claim by resident (admin assigns flat at approval, never the resident)
- Resident notification on approval/rejection (resident discovers status on next login)
- Multi-tenant / multi-community support
- CAPTCHA (rate limit + email verification considered sufficient initially)
- Bulk approval of multiple pending registrations in one click (single-row approval only in v1)
- Self-service profile editing while pending

## Approach

### Schema changes

**1. `userStatusEnum`** — new pgEnum: `pending | active | rejected`.

**2. `users` table** — add `status: userStatusEnum`, default `active` (so existing rows migrate cleanly). Keep `isActive` boolean for now; deprecate in a follow-up. Add `emailVerifiedAt: timestamp` (nullable).

**3. `registration_tokens` table** — singleton (enforced via unique constraint or app-level guard):
```
id uuid pk
token varchar(64) unique not null
is_active boolean not null default true
created_by_id uuid not null references users(id) on delete cascade
created_at timestamptz not null default now()
rotated_at timestamptz
```
Rotating = insert new row with new token, mark old row `is_active=false`. Old QR codes immediately stop accepting submissions; submissions already in queue are independent.

**4. `email_verifications` table** — short-lived tokens for email confirmation:
```
id uuid pk
user_id uuid not null references users(id) on delete cascade
token varchar(64) unique not null
expires_at timestamptz not null
verified_at timestamptz
created_at timestamptz not null default now()
```

**5. `communityNotificationKindEnum`** — extend with `pending_registration_admin` (admin notified that a new pending registration entered the queue).

### Public registration flow

1. Resident scans QR → lands on `/register/qr/{token}` (locale-prefixed, e.g. `/sk/register/qr/{token}`)
2. Server validates token: must exist + `is_active=true`. Otherwise show "this QR code is no longer valid, contact your admin" page.
3. Resident submits form: name, email, password, phone, consent checkboxes.
4. POST `/api/register/qr` (rate-limited per IP via `lib/rate-limiter`):
   - Validate token still active
   - Reject if email already exists in `users` (with status `active`, `pending`, or `rejected`) — message: "tento email je už zaregistrovaný"
   - Hash password (bcrypt, 12 rounds — match existing `register/route.ts`)
   - Insert `users` row with `status='pending'`, `role='owner'`, `flatId=null`, `emailVerifiedAt=null`
   - Insert `consent_records` rows
   - Create `email_verifications` row (24h expiry)
   - Send verification email via `lib/email.ts` (new function, localized via next-intl)
   - Return success: "skontrolujte si email"
5. Resident clicks verification link → GET `/api/register/qr/verify/{token}`:
   - Validate token + not expired + not yet verified
   - Set `users.emailVerifiedAt = now()`
   - Mark verification used (`verified_at = now()`)
   - Insert `community_notifications_sent` rows for each admin (kind: `pending_registration_admin`, dedup-key: user_id)
   - Send admin notification email(s)
   - Redirect resident to login

### Pending user gating

- Middleware / dashboard layout: if `session.user.status === 'pending'`, redirect any dashboard route except `/dashboard/community-info` (read-only landing page) to `/dashboard/community-info`.
- Read-only community info page shows: community name, address, board members (names only), and a clear "vaša registrácia čaká na schválenie" banner.
- Permissions check (`hasPermission`) returns false for everything when `status !== 'active'`.

### Admin approval UI

- New admin section at `/dashboard/owners/pending` (or under settings) listing pending registrations.
- Each row: name, email, phone, submitted at, email verified ✓.
- Per-row "approve" action opens modal: select flat (required, dropdown of all flats), select role (default `owner`, allow `tenant | admin | vote_counter | caretaker`), confirm.
- On approve: update `users.status='active'`, set `flatId`, set `role`, insert `user_flats` junction row, audit log.
- Per-row "reject" action: prompt for optional reason, set `users.status='rejected'`, audit log. Email becomes blocked from re-registration until admin clears the rejected row.

### QR token management UI

- New admin page at `/dashboard/settings/registration-qr`:
  - Show current active token + URL
  - "Print QR" button → opens print-friendly page rendering QR image (use `qrcode` npm package, server-rendered)
  - "Rotate token" button → confirmation dialog → generates new token, deactivates old
  - "Disable registration" toggle → marks current token `is_active=false` without creating a new one
- Permission: only `manageUsers` role (matches existing invitation creation).

### Rate limiting
- Submission endpoint: 5 requests / IP / hour
- Email verification endpoint: 20 requests / IP / hour
- Reuse `lib/rate-limiter.ts`

### Email copy
- Two new templates in `messages/{locale}.json` under `Email` namespace:
  - `qrRegistrationVerify` — sent to resident with verification link
  - `qrRegistrationPendingAdmin` — sent to each admin when a new pending registration is verified
- Localized per recipient (`getTranslations({ locale, namespace: "Email" })`), follows the email function contract from CLAUDE.md.

### Audit log events
- `registration_token.generated`
- `registration_token.rotated`
- `registration_token.disabled`
- `registration.submitted` (user_id, ip)
- `registration.email_verified` (user_id)
- `registration.approved` (user_id, by_admin_id, flat_id, role)
- `registration.rejected` (user_id, by_admin_id, reason)

## Acceptance Criteria

### QR token management
- [ ] Admin with `manageUsers` permission can generate the first registration token from `/dashboard/settings/registration-qr`
- [ ] Only one `registration_tokens` row has `is_active=true` at any time
- [ ] Admin can view a print-friendly page rendering the current token's URL as a QR code
- [ ] Admin can rotate the token; old token immediately stops accepting new submissions
- [ ] Admin can disable registration; QR URL returns "no longer valid" page
- [ ] Non-admin user attempting to access registration QR settings receives 403

### Public registration
- [ ] Scanning QR opens registration form with name/email/password/phone fields and consent checkboxes
- [ ] Submission with invalid/disabled token returns clear error
- [ ] Submission with email already in `users` (any status) is rejected with "už zaregistrovaný" message
- [ ] Submission without `data_processing` consent is rejected
- [ ] Successful submission creates `users` row with `status=pending`, `emailVerifiedAt=null`, `role=owner`, `flatId=null`
- [ ] Successful submission triggers verification email to the resident (Slovak default, English if accept-language matches)
- [ ] Submission endpoint rate-limited to 5/IP/hour; 6th request returns 429

### Email verification
- [ ] Clicking verification link within 24h sets `emailVerifiedAt` and notifies admins
- [ ] Expired or already-used verification links return clear error
- [ ] Each admin with `manageUsers` permission receives one notification per pending registration (deduped via `community_notifications_sent`)
- [ ] Verified pending users can log in but cannot access voting, owners, settings, or any feature pages

### Pending user experience
- [ ] Pending user logging in lands on `/dashboard/community-info` (read-only)
- [ ] Pending user attempting to navigate to any other dashboard route is redirected back to community-info
- [ ] Community-info page shows community name, address, board member names, and "awaiting approval" banner
- [ ] Pending user cannot perform any mutating action (`hasPermission` returns false for everything)

### Admin approval queue
- [ ] Admin sees a list of pending registrations ordered by submission time, showing name, email, phone, verified status
- [ ] Approval modal requires flat selection; submitting without flat shows validation error
- [ ] Approval modal defaults role to `owner` and allows changing it
- [ ] On approve: user status → `active`, `flatId` set, `user_flats` row inserted, role set, audit log written
- [ ] Approved user on next login sees full dashboard (voting, etc.)
- [ ] On reject: user status → `rejected`, audit log written with optional reason
- [ ] Rejected email cannot re-submit registration until rejected row is cleared

### Rotation and revocation
- [ ] After token rotation, residents already in the queue (verified or unverified) are unaffected
- [ ] After token rotation, an unverified user who clicks an old verification email link still completes verification successfully (verification tokens are decoupled from registration tokens)
- [ ] Disabling registration does not affect existing pending users in the queue

### i18n
- [ ] All new user-facing strings (registration form, errors, banner, admin queue UI, emails) sourced from `messages/sk.json` and `messages/en.json`
- [ ] No hardcoded Slovak or English text in components

### Audit & security
- [ ] All listed audit events emitted with correct payload
- [ ] Rate limit applied on `/api/register/qr` and `/api/register/qr/verify`
- [ ] Password hashed with bcrypt cost 12 (matches existing register flow)
- [ ] Verification token is cryptographically random (`crypto.randomBytes(32)`)

## Project Context

### Existing systems referenced
- Single-use invitations: `src/app/api/invitations/route.ts`, `src/app/api/register/route.ts`, `invitations` table — reused for per-flat targeted invites; QR flow is parallel, not a replacement
- Rate limiter: `src/lib/rate-limiter.ts`
- Email sending: `src/lib/email.ts` — new functions must be locale-aware per CLAUDE.md i18n rules
- Notifications dedup pattern: `community_notifications_sent` table + `communityNotificationKindEnum` (extend with `pending_registration_admin`)
- Permissions: `src/lib/permissions.ts` — `manageUsers` gates token management and approval
- Consent capture: `src/lib/consent.ts`, `consent_records` table — record at submission time

### Migration sequence
1. Add `userStatusEnum`
2. Alter `users` to add `status`, `emailVerifiedAt`; backfill `status='active'` for all existing rows
3. Create `registration_tokens` table
4. Create `email_verifications` table
5. Extend `communityNotificationKindEnum` with `pending_registration_admin`
6. Generated via `pnpm db:generate`, committed alongside schema changes

### UI dependencies
- QR rendering: add `qrcode` npm package (server-side SVG generation, no client lib needed for print page)

## Notes

### Open questions
- Should `users.isActive` be removed in this spec or left for follow-up? (Leaning: leave for follow-up to keep blast radius small)
- Print page format: HTML print stylesheet vs PDF generation? (Leaning: HTML print stylesheet — simpler, browser handles it) - just PDF image, and link under it 
- Should the admin be able to manually clear a `rejected` row to allow re-registration with the same email, or is rejection permanent until DB intervention? (Leaning: add a "clear rejection" action in admin UI for completeness — small addition, large UX win) it can be possible after rejection o admin to refgister with same email - coulb be miss click 


### Decisions made during discussion (2026-05-05)
- One QR per community (not per entrance/flat); per-flat path stays via existing invitation system
- Submission collects full registration data (name+email+password+phone) — no claimed-flat field
- Pending storage = `users` row with `status` enum (option A from discussion), not a separate registrations table
- Approval defaults role to `owner`, requires flat assignment
- Rejected submissions soft-deleted with email blocked
- Rotation invalidates QR but preserves in-flight queue submissions
- Pending users see read-only community info page (name, address, board members)
- Admin notified on new submission; resident not notified — discovers status on next login
