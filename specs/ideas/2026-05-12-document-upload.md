---
spec_id: BYT-20260512-006
title: "Document upload (HOA documents library)"
status: idea
created: 2026-05-12
updated: 2026-05-12
author: Filip
owner: Filip
last_verified: 2026-05-12
project_type: node
depends_on: []
related_handoffs: []
tags: [documents, uploads, client-feedback]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

HOAs need a central place to upload and share documents (statutes, AGM minutes, contracts, financial reports). Today there is no dedicated documents library; uploads exist only for community posts and paper-vote photos.

## Scope

**IN scope:**
- Documents table (id, building/entity scope, uploaded_by, filename, mime, size, category, visibility)
- Upload endpoint reusing `/api/uploads` with new category `documents` and matching permission
- List/view UI (grouped by category, search by filename)
- Delete: admin or uploader
- Visibility: per-building vs per-entrance scope (mirror community-foundation pattern)

**OUT of scope:**
- Versioning (replace = new upload, no diff)
- E-signing / signed-PDF workflow
- Encryption at rest beyond what storage already provides

## Approach

TBD — file-system uploads pattern is already in place (`src/app/api/uploads/route.ts`), follow community-foundation's category-permission map.

## Acceptance Criteria

- [ ] Admin can upload a PDF/image/docx to a building
- [ ] Owners + tenants see documents scoped to their building/entrance
- [ ] File-size + mime allowlist enforced server-side
- [ ] Delete is permission-gated (admin OR uploader)
- [ ] Document list page exists under `/[locale]/dashboard/documents`

## Notes

- Client meeting 2026-05-12: "Nahranie dokumentov"
- Reuse upload infra; do NOT introduce a separate storage provider
- Open question: max file size? Default to 25 MB unless evidence otherwise
