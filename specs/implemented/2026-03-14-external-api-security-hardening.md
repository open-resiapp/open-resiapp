---
spec_id: BYT-20260314-001
title: "External API security hardening"
status: implemented
created: 2026-03-14
updated: 2026-03-14
author: "bytove-druzstvo"
owner: ""
last_verified: 2026-04-13
project_type: other
depends_on: []
related_handoffs: [bytove-druzstvo-to-byt-app-20260314-001]
tags: [security, external-api, rate-limiting, audit]
---

## Goal

Harden the external API (`/api/external/v1/*`) against brute-force attacks, abuse, and unauthorized data access. OpenResiApp instances are self-hosted by independent building communities — the external API is exposed to the public internet and must be resilient against malicious actors.

## Scope

### In scope

1. **Rate limiting** on all external API endpoints
2. **Brute-force protection** on the pairing endpoint
3. **Audit logging** for all external API access
4. **Input validation** on pairing endpoint (appName, partA format, partB entropy)
5. **Health endpoint hardening** (remove information disclosure)
6. **Failed attempt tracking** and alerting
7. **Key rotation** mechanism

### Out of scope

- Changes to the pairing cryptographic flow (HMAC-SHA256 derivation stays)
- Changes to response shapes on existing GET endpoints
- Changes to permission hierarchy
- Internal API security (separate concern)

## Approach

### 1. Rate Limiting (CRITICAL)

Add IP-based rate limiting using in-memory store (or Redis for multi-instance deployments).

**Limits:**

| Endpoint | Limit | Window |
|----------|-------|--------|
| `POST /pair` | 5 requests | per hour per IP |
| `GET /health` | 30 requests | per minute per IP |
| All other external endpoints | 100 requests | per minute per IP |

**Implementation:**
- Middleware that runs before auth validation
- Returns `429 Too Many Requests` with `Retry-After` header
- Consider `@upstash/ratelimit` or simple in-memory Map with TTL
- For Next.js: middleware.ts or per-route wrapper

**Response on rate limit:**
```json
{
  "error": "Too many requests",
  "retryAfter": 60
}
```

### 2. Brute-Force Protection on Pairing (HIGH)

**Failed attempt tracking:**
- Track failed pairing attempts per pairing request ID (by partA prefix)
- After 5 failed attempts, lock the pairing request (set status to `"locked"`)
- Locked requests cannot be completed — admin must create a new one
- Log each failed attempt: IP, timestamp, partA prefix (NOT the full token)

**Part B validation:**
- Minimum length: 32 characters
- Must contain alphanumeric characters only (hex or base64)
- Reject empty, whitespace-only, or trivially short values

**Part A format validation:**
- Must start with `orai_`
- Must be exactly 69 characters (`orai_` + 64 hex chars)
- Reject before bcrypt comparison to save CPU

### 3. Audit Logging (HIGH)

New database table:

```
external_api_logs
  id              UUID PK
  connection_id   UUID FK → external_connections.id (nullable — null for failed auth)
  endpoint        VARCHAR(255)
  method          VARCHAR(10)
  ip_address      VARCHAR(45)     — supports IPv6
  user_agent      VARCHAR(500)
  status_code     INTEGER
  auth_result     VARCHAR(20)     — success | invalid_key | insufficient_permission | rate_limited
  response_time_ms INTEGER
  created_at      TIMESTAMP WITH TZ
```

**What gets logged:**
- Every request to `/api/external/v1/*`
- Failed authentication attempts (with IP, user agent)
- Rate limit hits
- Successful requests (with connection_id)

**What does NOT get logged:**
- API keys (never, not even prefixes longer than 4 chars)
- Request/response bodies
- Part A or Part B tokens

**Retention:** 90 days, with a cleanup cron job.

**Admin visibility:**
- New section in Settings → Connections showing recent external API activity
- Alert badge if failed auth attempts exceed threshold (e.g. 10 in 1 hour)

### 4. Input Sanitization on Pairing (MEDIUM)

**`appName` validation:**
- Max length: 100 characters
- Strip HTML tags and control characters
- Allow: alphanumeric, spaces, hyphens, underscores, dots
- Reject if empty after sanitization

**`partA` pre-validation (before bcrypt):**
- Must match regex: `^orai_[a-f0-9]{64}$`
- Reject immediately if format is wrong — saves bcrypt CPU

**`partB` validation:**
- Minimum length: 32 characters
- Maximum length: 256 characters
- Must match: `^[a-zA-Z0-9+/=_-]+$` (alphanumeric + base64 chars)

### 5. Health Endpoint Hardening (LOW)

**Current response:**
```json
{ "status": "ok", "paired": true }
```

**New response:**
```json
{ "status": "ok" }
```

- Remove `paired` field (information disclosure)
- Wrap in try/catch — return `{ "status": "unhealthy" }` on DB errors instead of 500
- Rate limit: 30 req/min per IP

### 6. Key Rotation (MEDIUM)

New internal API endpoint (admin-only, NOT on external API):

```
POST /api/external-connections/{id}/rotate-key
```

**Flow:**
1. Admin triggers rotation from Settings → Connections UI
2. Server generates new Part A, sends to admin
3. Admin shares with external app admin
4. External app calls `/pair` with new Part A + their Part B
5. Old key is invalidated, new key is stored
6. Grace period: old key works for 24 hours after rotation to avoid sync failures

This avoids full un-pair/re-pair and maintains the connection record.

### 7. Failed Attempt Alerting

**Thresholds:**
- 10+ failed auth attempts from same IP in 1 hour → flag in admin UI
- 5+ failed pairing attempts on same request → auto-lock request
- 3+ rate limit hits from same IP in 5 minutes → temporary IP block (15 min)

**Admin notification:**
- Red badge on Settings → Connections tab
- Log entry visible in the external API activity log

## Acceptance Criteria

### Rate Limiting
- [ ] All external API endpoints are rate limited
- [ ] `/pair` endpoint limited to 5 requests/hour per IP
- [ ] Other endpoints limited to 100 requests/min per IP
- [ ] Rate-limited requests return 429 with `Retry-After` header
- [ ] Rate limit state is not bypassable by changing headers

### Brute-Force Protection
- [ ] Pairing request is locked after 5 failed attempts
- [ ] Locked pairing requests cannot be completed
- [ ] Part B must be at least 32 characters
- [ ] Part A format is validated before bcrypt comparison
- [ ] Failed attempts are logged with IP and timestamp

### Audit Logging
- [ ] Every external API request is logged in `external_api_logs`
- [ ] Failed auth attempts are logged with `auth_result` detail
- [ ] API keys never appear in logs
- [ ] Logs are visible to admin in Settings → Connections
- [ ] Logs older than 90 days are cleaned up automatically

### Input Sanitization
- [ ] `appName` is limited to 100 chars, HTML stripped
- [ ] `partA` format is validated before hash comparison
- [ ] `partB` minimum length of 32 is enforced

### Health Endpoint
- [ ] `paired` field is removed from health response
- [ ] DB errors return `{ status: "unhealthy" }` instead of 500

### Key Rotation
- [ ] Admin can trigger key rotation from the UI
- [ ] Old key has 24-hour grace period after rotation
- [ ] Rotation does not require full un-pair/re-pair

## Project Context

**Tech stack:** Next.js (App Router) + Drizzle ORM + PostgreSQL

**Files affected:**
- `src/lib/external-auth.ts` — add audit logging middleware
- `src/lib/api-keys.ts` — add failed attempt logging
- `src/lib/pairing.ts` — add Part B validation, attempt locking, Part A format check
- `src/app/api/external/v1/pair/route.ts` — input sanitization, rate limit
- `src/app/api/external/v1/health/route.ts` — remove `paired`, add error handling
- `src/db/schema.ts` — new `external_api_logs` table
- New: rate limiting middleware or utility
- New: audit log cleanup cron
- New: key rotation endpoint and UI

**Related handoff:** `bytove-druzstvo-to-byt-app-20260314-001`

## Notes

- Rate limiting approach depends on deployment: single instance → in-memory Map with TTL; multi-instance → Redis or Upstash
- The 24-hour grace period for key rotation needs careful implementation to avoid two valid keys allowing double access — consider marking the old key as "rotation_grace" with a separate permission level
- Consider adding CSP headers to the external API responses to prevent any browser-based abuse
- The audit log table will grow fast — ensure proper indexing on `created_at` and `connection_id`
- This spec was triggered by a security audit from the bytove-druzstvo project