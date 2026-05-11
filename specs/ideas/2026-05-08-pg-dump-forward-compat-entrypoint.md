---
spec_id: BYT-20260508-001
title: "Make pre-migration pg_dump tolerant of forward-compatible client/server skew"
status: idea
created: 2026-05-08
updated: 2026-05-08
author: Filip
owner: Filip
last_verified: 2026-05-08
project_type: node
depends_on: []
related_handoffs: []
tags: [docker, entrypoint, migrations, pg_dump, reliability]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

`docker-entrypoint.sh` runs `pg_dump` as a pre-migration backup step. When the client's major version is older than the server's, `pg_dump` refuses to run and the entrypoint aborts startup (`exit 1`). On 2026-05-07 this caused a customer-visible outage on `34a3df70.resiapp.cloud`: cloud RDS was upgraded to PostgreSQL 17, but the instance image shipped `postgresql-client-16` — every restart attempt crashed the container before migrations could run, and ALB returned 504 until the image was rebuilt with `postgresql17-client`.

The image-version fix is the right long-term answer (always match server major), but the entrypoint should also be defensive: a future server upgrade should never silently brick all customer instances. Make the backup step degrade gracefully when the dump itself can't run, while still preserving the "no migrations on a corrupt-able DB" safety net for the cases that genuinely warrant it.

## Scope

**IN scope:**
1. Detect the specific case "pg_dump client major < server major" before invoking pg_dump and emit a clear warning. Do not abort on this case alone.
2. When the safe-to-skip case is detected, set `DISABLE_PREMIGRATION_BACKUP=1` for the rest of the entrypoint and proceed to migrations. Log the decision prominently with the rationale.
3. Keep aborting on genuine pg_dump failures (disk full, auth error, network error, dump produces 0 bytes, etc.).
4. Update `docker-entrypoint.sh` to surface both versions (client + server) at startup regardless of skew, so the version state is always visible in CloudWatch.
5. Document the new behavior in a comment block in the entrypoint and (briefly) in the project CLAUDE.md operational notes.

**OUT of scope:**
- Building images with multiple postgres-client versions (one per major) and choosing at runtime. The image's client major should match the server. Use the well-known PGDG repo pattern for builds.
- Replacing `pg_dump` with logical replication snapshots or wal-based backups. Out of scope for an entrypoint backup; that's a platform-level concern (already handled separately by per-DB S3 backups).
- Adding application-side migration-rollback logic. Forward-only migrations stay forward-only; backup is for restore-from-disaster, not rollback.

## Approach

**Detection logic (Bash):**
```bash
SERVER_MAJOR=$(psql "$DATABASE_URL" -tAc "SHOW server_version_num" | cut -c1-2 | sed 's/^0//')
CLIENT_MAJOR=$(pg_dump --version | grep -oE '[0-9]+' | head -1)

echo "pg_dump version: ${CLIENT_MAJOR}.x"
echo "PostgreSQL server version: ${SERVER_MAJOR}.x"

if [ "$CLIENT_MAJOR" -lt "$SERVER_MAJOR" ]; then
  echo "WARNING: pg_dump client (${CLIENT_MAJOR}) older than server (${SERVER_MAJOR})."
  echo "WARNING: Skipping pre-migration backup. Migrations will still run."
  echo "WARNING: Rebuild the image with postgresql${SERVER_MAJOR}-client to restore backups."
  DISABLE_PREMIGRATION_BACKUP=1
fi
```

**Why skip is safe in this specific case:**
- Forward-incompatibility means the dump file would be incomplete or refused. The DB itself is fine.
- Migrations applied via drizzle don't need a backup to *run*; the backup is purely for "if a migration corrupts data, restore from this dump."
- The platform already takes per-DB S3 backups on a schedule (separate spec). The pre-migration backup is the *last* line of defense, not the only one.
- Crashing the entire instance because we can't take an extra defensive snapshot is worse than running migrations without that snapshot, especially when the customer has lost their service entirely.

**What still aborts:**
- pg_dump runs but fails (disk, auth, network) — abort. The DB might be in trouble; don't apply migrations on top.
- pg_dump runs but outputs 0 bytes / size below threshold (e.g. 1KB) — abort. Treat as failure.
- Server unreachable when checking version — abort. Can't migrate anyway.

**Override env var:**
- `FORCE_PREMIGRATION_BACKUP=1` overrides the auto-skip and re-enables the original abort-on-mismatch behavior. For environments that want the strict guarantee even at the cost of downtime.
- `DISABLE_PREMIGRATION_BACKUP=1` (already exists) continues to work — manual full skip.

## Acceptance Criteria

- [ ] Entrypoint logs both client and server postgres major versions on every startup.
- [ ] When `CLIENT_MAJOR < SERVER_MAJOR`, entrypoint logs a WARNING block, sets `DISABLE_PREMIGRATION_BACKUP=1` internally, and proceeds to migrations.
- [ ] When `CLIENT_MAJOR == SERVER_MAJOR`, entrypoint runs pg_dump normally.
- [ ] When `CLIENT_MAJOR > SERVER_MAJOR` (server downgrade — unusual), entrypoint runs pg_dump normally (forward-compatible direction).
- [ ] When pg_dump runs but the resulting file is < 1KB, entrypoint treats it as failure and aborts.
- [ ] `FORCE_PREMIGRATION_BACKUP=1` env var disables the auto-skip and restores strict-abort behavior.
- [ ] Manual test: simulate the 2026-05-07 incident by building an image with `postgresql16-client` against a 17.x server. Verify entrypoint warns + proceeds + migrations apply + Next.js serves.
- [ ] CLAUDE.md (or `docs/` equivalent) gains a brief note about the env vars and when to use each.

## Project Context

**Touched files:**
- `docker-entrypoint.sh` — version detection + degrade logic.
- `Dockerfile` — already updated to `postgresql17-client` on 2026-05-07; no change here, but document in the entrypoint comment that the *expected* state is matched majors and the skip path is a fallback, not the norm.
- `CLAUDE.md` — short ops note about `FORCE_PREMIGRATION_BACKUP` / `DISABLE_PREMIGRATION_BACKUP`.

**Discovery context:** 2026-05-07 incident on customer instance `34a3df70.resiapp.cloud`. Image built with `postgresql16-client`, RDS upgraded to 17.6. Entrypoint aborted with "pg_dump: error: aborting because of server version mismatch" → 5 stopped tasks in ECS over ~1 hour → 504s on customer domain → manual recovery required (rebuild image with v17 client + push to Docker Hub + force ECS to pull). The image fix is correct, but a graceful entrypoint would have meant the same RDS upgrade was a no-op for customers instead of a multi-customer outage.

## Notes

- **Why not always skip the backup?** It's a defense-in-depth layer for migration-induced corruption. We want it present in the normal case. Only skip when the alternative is "instance won't start at all."
- **Should we email/alert on the skip path?** Probably yes, but that's a separate logging-pipeline concern. For now CloudWatch + a manual check is fine. Future spec.
- **Concern: customer's data is now slightly more exposed during the affected restart cycle.** True. Mitigation: per-DB S3 backups (separate, scheduled) cover the wider safety net. The pre-migration dump is the "fast restore for THIS migration only" layer; losing it for one cycle is acceptable when the alternative is total downtime.
- **Why not pin client to PGDG and auto-track server major?** PGDG repo can be added at build time, but the client major is still locked at image-build time. Customer-instance image only gets a new client major when we rebuild and push. The proper long-term fix is a build-time variable (`POSTGRES_CLIENT_MAJOR`) so the Dockerfile takes a single version arg from CI, matching whatever cloud-side RDS major we publish. Track as a separate idea.