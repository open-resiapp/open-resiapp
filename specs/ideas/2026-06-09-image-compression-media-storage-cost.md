---
spec_id: BYT-20260609-001
title: "Image compression & media storage cost"
status: idea
created: 2026-06-09
updated: 2026-06-09
author: Filip
owner: Filip
last_verified: 2026-06-09
project_type: node
depends_on: [BYT-20260512-006]
related_handoffs: []
tags: [storage, images, compression, cost, infra, aws, hetzner]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Cut storage cost as photo volume grows by compressing images at upload and
leveraging the cheaper storage backend the app already supports. This is
**cross-cutting infra** — it applies to every image upload path (project /
community photos, paper-vote scans), not just projects. A single phone photo
(3–8 MB) compresses to a few hundred KB — roughly a **90% reduction** — which
compounds fast on an instance hosted on the author's own AWS cloud, where the
S3 bill is paid directly.

## Scope

**IN scope:**
- Server-side **compress-at-upload**: a `compressImage(buffer, mime)` step
  invoked **before** `storage.put` (in `src/lib/storage` / the upload routes).
- `sharp` (libvips): resize to ~2048px longest side, re-encode to **WebP ~80%**,
  strip EXIF.
- **Images only** (`image/jpeg`, `image/png`, `image/webp`). PDFs / docx /
  scanned legal records are left untouched (originals kept).
- **Keep only the compressed** version for images (no original) — that is the
  saving; lossy and irreversible, acceptable for community / project photos.
- Applies across `/api/documents` (image-type docs) **and** the legacy
  `/api/uploads` (community photos, paper-vote scans).
- Optional small **thumbnail** generation for a future gallery (the gallery UI
  itself is OUT).

**OUT of scope:**
- Photo gallery UI.
- Compressing non-image documents.
- Client-side compression.

## Approach

- **Integration point:** the storage abstraction from BYT-20260512-006
  (`src/lib/storage.ts`, local + S3 + Hetzner). Compression is a pre-processing
  step before `put` — one helper, called from every image upload path.
- **Native dependency:** `sharp` is a native (libvips) module → the Docker image
  must build it in for the target arch. Deploy/build consideration, not just an
  `npm i`.
- **Two cost prongs** (the second already partly available):
  1. **Compression** (this spec) — less data per image.
  2. **Cheaper backend** — the storage driver already supports **Hetzner Object
     Storage** for bulk media (far cheaper than S3); plus S3
     **lifecycle / Intelligent-Tiering** for cold files (infra, related but
     separate).
- **Originals decision:** do not retain originals for images (the saving is the
  point). Keep originals for non-image legal records.

## Acceptance Criteria

- [ ] Images are compressed server-side, before being stored, on every upload path.
- [ ] Non-image documents (PDF/docx/etc.) are stored untouched — originals preserved.
- [ ] A multi-MB photo lands in storage as a few hundred KB (measured reduction).
- [ ] EXIF metadata is stripped from stored images.
- [ ] Paper-vote scans remain legible after compression (legal-evidence quality).
- [ ] The Docker image builds with `sharp` available at runtime.
- [ ] No original is retained for image uploads.

## Project Context

**project_type: node.** Depends on BYT-20260512-006 (storage abstraction:
local + S3 + Hetzner). Integration in `src/lib/storage.ts` + the upload routes
(`/api/documents`, `/api/uploads`). Hosting context: the instance runs on the
author's AWS cloud, so storage cost is borne directly.

## Notes

- **Legal records keep originals.** Contracts, minutes, and scans of legal
  documents MUST NOT be downsampled — only community / project photos get
  compressed (CLAUDE.md legally-regulated-content caution). Paper-vote scans are
  borderline: compress but verify legibility; if in doubt, keep originals for the
  `paper-votes` category. Revisit per-template later.
- Open questions: WebP vs keep-original-format (WebP gives the best ratio with
  near-universal support now); target quality/max-dimension are starting points
  to tune; whether to generate a thumbnail now (cheap) or defer with the gallery.
- Relates to: BYT-20260512-006 (storage abstraction), and the deferred photo
  gallery in BYT-20260608-001's "Project workspace" section.
