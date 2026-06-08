---
spec_id: BYT-20260608-001
title: "Document attachments & projects (posts + voting)"
status: in_progress
created: 2026-06-08
updated: 2026-06-08
author: Filip
owner: Filip
last_verified: 2026-06-08
project_type: node
depends_on: [BYT-20260512-006]
related_handoffs: []
tags: [documents, attachments, projects, posts, voting, storage]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Let posts and votings carry documents, reusing the storage driver + document
library + visibility resolver from BYT-20260512-006 (no new storage path):

- **Posts** (board `posts` AND community `communityPosts`) attach **individual
  documents** — an announcement can carry the PDF it references.
- **Votings** link a **document Project** (a named dossier — the deferred
  BYT-20260512-006 Phase-2 grouping, now activated). Voters see all contracts /
  budgets behind the vote in one place — the §11 transparency case (a vote about
  the balcony works contract shows the contract + budgets).

This activates document **Projects** as a first-class concept and wires
attachments across the three surfaces.

## Scope

**IN scope:**
- **Document Projects**: `document_projects` table + `documents.projectId`;
  library UI to create a project, assign docs, view a project with its docs.
- **Post attachments** (board + community): attach **both** ways — pick from
  the library AND upload-new-inline. Visibility **inherits the post's reach**
  (decision a): upload-new sets `audience = resident`; pick-from-library warns
  if the chosen doc is narrower than the post's reach.
- **Voting ↔ Project**: a voting links **one** Project (voting level, **not**
  per-vote). Voting detail renders the project's docs (canView-gated).
- Render download links (reuse `/api/documents/[id]` proxy) on post cards +
  voting detail.
- i18n sk + en.

**OUT of scope:**
- Per-vote (ballot) attachments — explicitly excluded (votes already carry
  `paperPhotoUrl`).
- Multiple projects per voting (one for v1).
- Versioning / e-signing (inherited OUT from parent spec).
- Replacing the community `photoUrl` image path — attachments are additive.

## Approach

### Schema — core (`src/db/schema.ts`, migration via `drizzle-kit generate`)
- `document_project_status` enum: `planned | active | done`.
- `document_projects`:
  `id`, `entityId` (FK → entities, **restrict**), `title`, `description?`,
  `audience` (`document_audience`, default `owner`), `status`
  (default `active`), `createdAt`.
- `documents.projectId` — `uuid null` FK → `document_projects`
  **onDelete set null** (docs survive project deletion; revert to standalone).
- `document_links` (polymorphic, posts only):
  `id`, `documentId` (FK → documents, **cascade**),
  `targetType` enum (`board_post | community_post`), `targetId uuid`,
  `createdAt`. `targetId` has **no FK** (polymorphic) — per CLAUDE.md every
  `references()` needs `onDelete`, so the only FK (`documentId`) is cascade;
  target-side cleanup is explicit in the post DELETE handlers (see below).
  Index on `(targetType, targetId)`.

### Schema — voting module (`modules/voting/src/db/schema.ts`)
- `votings.documentProjectId` — `uuid null` FK → core `document_projects`
  **onDelete set null**. (The voting schema already FKs core `users` /
  `entities`, so a cross-module FK to `document_projects` follows the established
  pattern — verify before generating.)

### Visibility (reuses `canSeeDocPath` — no new resolver)
- **Post attachments — inherit (decision a):**
  - *upload-new* → create the doc with `audience = resident` (posts are visible
    to all entity members via `viewPosts`), anchored at the post's entity, then
    link. Everyone who sees the post can download it.
  - *pick-from-library* → don't mutate the existing doc's audience; if it's
    narrower than `resident`, show a warning ("some viewers won't see this") and
    surface the audience badge. Download stays gated by the doc's own audience
    (link may dead-end — transparent, not silent).
- **Project (voting):** `project.audience` (default `owner`) governs its docs;
  voting voters are owners, so owner-tier docs resolve via the existing
  authority/broadcast union. Voting detail lists the project's docs filtered by
  `getViewableDocument` per viewer.

### API
- Projects: `GET/POST /api/documents/projects`, `PATCH /api/documents/projects/[id]`
  (title/status/audience), assign doc → `PATCH /api/documents/[id]` body
  `{ projectId }`.
- Post attachments: extend post create/edit payloads to accept
  `documentIds: string[]` (link existing) and reuse `POST /api/documents` for
  upload-new (returns id → then link). `GET /api/<post>/[id]/documents` lists a
  post's attachments. Detach on `DELETE` of the link or post.
- Voting: extend voting create/edit to accept `documentProjectId`.
- **Cleanup:** board-post and community-post DELETE handlers remove their
  `document_links` rows (polymorphic, no cascade). Document/project deletes are
  already handled by FK (`cascade` / `set null`).

### UI
- **Library** (`/documents`): a "Projects" view — create project (title,
  audience, status), assign docs, expand a project to its docs.
- **Board post form** (`components/nastenka/NewPostModal` / `EditPostModal`):
  attachment control — multi-pick from library + upload-new (reuse
  `DocumentUploadForm` storage POST). Render attachments on `PostCard`.
- **Community `PostForm`**: same attachment control, alongside the existing
  single `photoUrl`.
- **Voting create/edit** (`modules/voting/src/ui` / dashboard): Project picker
  (select existing or create one). Voting detail renders the linked project's
  docs.

### Phasing
- **Phase A** — Projects: schema (`document_projects` + `documents.projectId`),
  projects API, library Projects UI. *(Foundation — voting depends on it.)*
- **Phase B** — Post attachments: `document_links`, both post forms + cards,
  attach/upload/detach, inherit-visibility + warning.
- **Phase C** — Voting ↔ Project: `votings.documentProjectId`, voting form +
  detail render.
Run `/phase-complete` at each boundary.

## Acceptance Criteria

- [ ] `document_projects` + `document_project_status` enum + `documents.projectId`
      (set null) land; migration generated.
- [ ] `document_links` (polymorphic `board_post | community_post`,
      `documentId` cascade, indexed) lands; migration generated.
- [ ] `votings.documentProjectId` (set null) lands; voting-module migration.
- [ ] Library: create a project, assign docs, view a project with its docs.
- [ ] Board post: attach existing docs AND upload-new; card renders download
      links; upload-new docs are `audience = resident`.
- [ ] Community post: same attachment control alongside the photo.
- [ ] Voting: link exactly one project; voting detail lists the project's docs,
      each gated by `getViewableDocument`.
- [ ] Pick-from-library of a narrower-audience doc onto a post shows a
      reach warning.
- [ ] Deleting a board/community post removes its `document_links`; the
      documents and projects survive.
- [ ] All new strings in `sk.json` + `en.json`.

## Project Context

**project_type: node.** Depends on BYT-20260512-006 (document library, storage
driver, `canSeeDocPath`, `/api/documents`).

Verify against current code before implementing (CLAUDE.md):
- `posts` table `src/db/schema.ts` (no attachment field today).
- `communityPosts.photoUrl` `src/db/schema.ts` (single image, additive).
- `votings` `modules/voting/src/db/schema.ts` (FKs core `users`/`entities`).
- Visibility resolver + serving: `src/lib/documents.ts` / `documents.server.ts`,
  `/api/documents/[id]`.

## Notes

**Locked decisions (2026-06-08, from chat):**
1. Both post types (board `posts` + community `communityPosts`).
2. Both attach modes (pick-from-library + upload-new-inline).
3. Visibility = inherit post reach (a).
4. Voting links a document **Project** (dossier), at the voting level, not per
   vote.

**Open / deferred:**
- Multiple projects per voting (one for v1).
- Whether assigning a doc to a project should re-anchor/raise its audience to the
  project's audience (v1: independent; project audience governs the project view,
  doc keeps its own audience for the library).
- Post-delete link cleanup is app-level (polymorphic `targetId` has no FK) —
  must be added to both post DELETE handlers, not left to the DB.
