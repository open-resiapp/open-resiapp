---
spec_id: RES-20260506-001
title: "Multi-platform deployment portability"
status: idea
created: 2026-05-06
updated: 2026-05-06
author: open-resiapp
owner: ""
last_verified: 2026-05-06
project_type: other
depends_on: []
related_handoffs: []
tags: [deployment, ops, oss, portability]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal
Make open-resiapp deployable on every common hosting platform with minimal friction so any HOA, technician, or volunteer can stand up an instance regardless of host preference. Today the app deploys cleanly on self-hosted Docker Compose and (with manual setup) on Railway-style PaaS. Wider OSS adoption requires platform-specific templates, storage/cron abstractions that survive ephemeral filesystems, and one-click deploy buttons.

## Scope

### In scope
- Storage adapter: pluggable backend for `/app/uploads` (`local`, `s3`, `r2`, `b2` — anything S3-compatible). Selected via `STORAGE_DRIVER` env var.
- Backup destination adapter: same pattern for `/app/backups` (`local`, `s3`). Selected via `BACKUP_DRIVER`.
- Internal cron toggle: `node-cron`-based in-process scheduler activated by `ENABLE_INTERNAL_CRON=true` for single-instance hosts that lack sidecars.
- Boot-time env validation via `zod` schema in `src/env.ts` with clear failure messages.
- Per-platform deployment templates under `deploy/<platform>/`:
  - Railway (`railway.toml` + README)
  - Render (`render.yaml` + README)
  - Fly.io (`fly.toml` + README)
  - DigitalOcean App Platform (`.do/app.yaml` + README)
  - Heroku (`heroku.yml` + `app.json` + Deploy button)
  - Coolify / Dokploy (compose snippet + README)
  - Hetzner / generic VPS (adapt existing `setup.sh` + README)
- Optional: Kubernetes Helm chart under `deploy/kubernetes/` (lower priority).
- `docs/deployment/` with platform comparison matrix and a per-platform guide.
- One-click deploy buttons in root `README.md`.

### Out of scope
- **Vercel / serverless-only hosts.** Background cron, persistent uploads, and pre-migration backups don't fit the model cleanly. Revisit only if storage + cron are 100% externalized and there is real demand.
- AWS CDK / Terraform / Pulumi modules — too much surface area to maintain. Users wrap the Docker image themselves.
- Database provisioning automation. Document compatibility (Neon, Supabase, Railway PG, Fly PG, RDS, Hetzner-hosted PG 16) and let the operator set `DATABASE_URL`.
- Multi-region or HA topologies. Single-region single-instance is the supported baseline.

## Approach

1. **Storage adapter** (`src/lib/storage/`): define `StorageAdapter` interface (`put`, `get`, `delete`, `signedUrl`). Implement `LocalAdapter` (current behavior) and `S3Adapter` (uses `@aws-sdk/client-s3`, works with R2/B2/MinIO via `S3_ENDPOINT`). Routes that touch uploads (`/api/uploads/*`, posts attachments) read the adapter from a single factory, never `fs` directly.
2. **Backup adapter**: similar pattern in `docker-entrypoint.sh` — `BACKUP_DRIVER=s3` pipes `pg_dump` straight to `aws s3 cp -` (install `aws-cli` in runner stage when needed, or use `mc` from MinIO).
3. **Internal cron**: small wrapper in `src/lib/cron/internal.ts` that registers `node-cron` jobs at server start (guarded by `ENABLE_INTERNAL_CRON`). Same handlers the external `/api/cron/community` endpoint already calls.
4. **Env validation**: `src/env.ts` exporting a `zod`-parsed `env` object. Imported once at server start. Lists every required + optional var with descriptions. Replaces scattered `process.env.X!` reads.
5. **Templates**: each `deploy/<platform>/` folder is self-contained — config file + README with environment variable list, volume/cron caveats, and a deploy button URL. No platform-specific code in the main app.
6. **README deploy buttons**: render after templates exist and have working repo URLs.

## Acceptance Criteria

- [ ] `STORAGE_DRIVER=local` matches current behavior bit-for-bit (no regression for self-hosters).
- [ ] `STORAGE_DRIVER=s3` with R2 credentials uploads, retrieves, and deletes files in an automated test against MinIO in CI.
- [ ] `BACKUP_DRIVER=s3` produces a restorable `pg_dump` in an S3-compatible bucket; documented restore command works end-to-end.
- [ ] App refuses to boot with a clear, single-screen error if any required env var is missing or malformed.
- [ ] `ENABLE_INTERNAL_CRON=true` triggers the same community job that the external webhook does, on the same schedule, on a single-instance deployment.
- [ ] Each platform template under `deploy/` has been used at least once to deploy a working instance, with the test instance URL or screenshot recorded in its README.
- [ ] `docs/deployment/README.md` contains a comparison matrix (cost, persistent disk, cron support, TLS, build time) for every supported platform.
- [ ] At least three deploy buttons in root `README.md` route to working templates (Railway, Render, DO minimum).
- [ ] Existing Docker Compose path (`docker-compose.prod.yml`) continues to work without changes.

## Project Context

Project type: full-stack Next.js 16 app, deployed today as a single Docker image. Background work runs via a sidecar `cron` container hitting `/api/cron/community` with `X-Cron-Secret`. Persistent state lives in three places: PostgreSQL, `/app/uploads` (user attachments), `/app/backups` (pre-migration `pg_dump` files). NextAuth v5 requires `AUTH_TRUST_HOST=true` behind every PaaS proxy. Healthcheck endpoint already exists at `/api/external/v1/health`.

The OSS distribution target is HOA boards and small property managers — operators who range from "I have a Hetzner VPS and use compose" to "I clicked a button on Railway." Both ends must work without reading source code.

## Notes

- 2026-05-06: Spec captured during a "is this Railway-ready?" conversation. User confirmed the current focus is breadth (deploy anywhere) over depth (any one platform). Implementation deferred — created so the work is discoverable when someone asks for it later.
- Order of implementation when picked up: storage adapter → backup adapter → env validation → internal cron → templates (Railway / Render / Fly first, others as demand emerges) → deploy buttons. Helm chart last, only if k8s users surface.
- Open question: which S3 SDK — official `@aws-sdk/client-s3` (heavy, ~2MB) vs `minio` client (lighter, less idiomatic). Decide at implementation time based on bundle impact in Next standalone output.
- Open question: should `BACKUP_DRIVER=s3` install `aws-cli` in the runner image (image bloat) or use a Node-based uploader inside the entrypoint? Node-based avoids alpine package churn.
