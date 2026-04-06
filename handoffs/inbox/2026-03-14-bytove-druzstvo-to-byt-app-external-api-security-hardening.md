---
handoff_id: bytove-druzstvo-to-byt-app-20260314-001
from: bytove-druzstvo
to: byt-app
status: agreed
created: 2026-03-14
updated: 2026-03-14
related_specs: [BDR-20260313-001]
---

## Request

### What we need
The external API (`/api/external/v1/*`) needs security hardening before bytove-druzstvo can safely connect to OpenResiApp instances in production. Specifically: rate limiting, brute-force protection, audit logging, and input validation on the pairing and API key validation flows.

### Why we need it
Bytove-druzstvo connects to **self-hosted, community-run** OpenResiApp instances. These instances are open source and run by independent building communities. Our app must trust that the OpenResiApp instance it connects to is secure. Without these protections:

- An attacker who intercepts Part A from email can brute-force the pairing endpoint with no rate limit
- There is no way to detect or alert on failed authentication attempts
- No audit trail exists for who accessed resident data via the external API
- The health endpoint leaks whether the instance has active connections

This is a **blocker for production deployment** of bytove-druzstvo's building management features.

### Constraints from our side
- The pairing flow contract (Part A + Part B → HMAC-SHA256 → API key) must stay the same — we've already built our side around it
- API key header format (`X-API-Key`) must stay the same
- Response shapes from existing GET endpoints must not change (we validate against strict schemas)
- Permission hierarchy (`read`, `read_write`, `full`) must stay the same

### How we imagine it — open to challenge

**1. Rate limiting (CRITICAL)**
- Global rate limit on all external API endpoints (e.g. 100 req/min per IP)
- Stricter limit on `/pair` endpoint (e.g. 5 attempts/hour per IP)
- Return `429 Too Many Requests` when exceeded

**2. Brute-force protection on pairing (HIGH)**
- Lock pairing request after N failed attempts (e.g. 5)
- Log failed pairing attempts with IP and timestamp
- Enforce minimum Part B length/entropy (e.g. min 32 chars)

**3. Audit logging (HIGH)**
- Log every external API request: endpoint, method, connection_id, IP, timestamp, response status
- Log failed authentication attempts separately with more detail
- Retention policy (e.g. 90 days)

**4. Input sanitization (MEDIUM)**
- Validate `appName` on pairing: max length, strip HTML/control chars
- Validate `partA` format (must start with `orai_`, correct length)
- Validate `partB` minimum length

**5. Health endpoint hardening (LOW)**
- Remove `paired` boolean from health response (information disclosure)
- Add try/catch for DB errors → return `{ status: "unhealthy" }` instead of 500

**6. Key rotation (MEDIUM)**
- Ability to rotate an API key without full re-pairing
- Endpoint to invalidate current key and generate new one

These are suggestions based on our security audit — the byt-app team knows their codebase better and should implement what makes sense.

---

## Discussion

<!-- Each reply follows this format — append, never edit previous entries -->

### 2026-03-14 — byt-app

We agree with all six points from the security audit. Our spec `BYT-20260314-001` covers everything requested. Key decisions:

- **Rate limiting:** In-memory Map with TTL for single-instance deployments (our current target). Redis adapter can be added later for multi-instance. Limits match your suggestions: 5 req/hr on `/pair`, 100 req/min on other endpoints, 30 req/min on `/health`.
- **Brute-force protection:** 5 failed attempts → lock pairing request. Part A format validated before bcrypt to save CPU. Part B minimum 32 chars enforced.
- **Audit logging:** New `external_api_logs` table, 90-day retention with cleanup cron. Admin UI in Settings → Connections. API keys never logged.
- **Input sanitization:** `appName` max 100 chars with HTML/control char stripping. `partA` regex validation before hash comparison. `partB` length + charset validation.
- **Health endpoint:** `paired` field removed. DB errors return `{ status: "unhealthy" }` instead of 500.
- **Key rotation:** Admin-triggered rotation with 24-hour grace period for old key. No full re-pairing needed.

All your constraints are respected — no changes to pairing flow, `X-API-Key` header, GET response shapes, or permission hierarchy.

---

## Decision Summary
<!-- Filled in when status moves to "agreed" — distilled from the discussion above -->

**What will be built:**
Rate limiting (IP-based, in-memory), brute-force protection on pairing (5-attempt lock), audit logging (`external_api_logs` table, 90-day retention, admin UI), input validation on pairing fields, health endpoint hardening, key rotation with 24-hour grace period.

**What will NOT be built (and why):**
Multi-instance Redis rate limiting (not needed yet — single-instance deployments only for now). IP blocklisting (can be added later based on audit log data).

**Constraints agreed:**
- Pairing flow (Part A + Part B → HMAC-SHA256 → API key) unchanged
- `X-API-Key` header format unchanged
- GET endpoint response shapes unchanged
- Permission hierarchy (`read`, `read_write`, `full`) unchanged

**Each party's responsibilities:**

| Project         | Responsibility                                               | Target     |
|-----------------|--------------------------------------------------------------|------------|
| byt-app         | Implement all 6 hardening areas per spec BYT-20260314-001    | 2026-03-28 |
| bytove-druzstvo | Handle 429 responses with backoff, update Part B generation to meet 32-char minimum if needed | 2026-03-28 |

---

## Resolution
<!-- Filled in when status moves to "resolved" -->
**Resolved on:**
**Outcome:**
**Related specs/PRs:**