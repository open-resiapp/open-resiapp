---
spec_id: BYT-20260512-006
title: "Document upload (HOA documents library)"
status: in_progress
created: 2026-05-12
updated: 2026-06-08
author: Filip
owner: Filip
last_verified: 2026-06-08
project_type: node
depends_on: []
related_handoffs: []
tags: [documents, uploads, client-feedback, storage, gdpr, legal]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

HOAs need a central, access-controlled library to upload and share documents
(contracts, budgets, settlements, minutes, insurance, revisions). This is not
just convenience — Slovak law **mandates** it:

- **§8b/§9 zák. 182/1993 Z.z.** — the správca/predseda must keep the full
  documentation of house administration: vendor/employment/insurance contracts,
  accounting records, building technical documentation, service settlements,
  fund (FPÚO) settlements, and all owner minutes & decisions.
- **§11 ods. 6–7 zák. 182/1993 Z.z.** — every owner has the **right to inspect**
  documents about house administration and use of the FPÚO fund, and to take
  copies. The predseda/správca must enable this **while protecting personal data**.
- **§9 ods. 5** — all owner decisions, assembly minutes and written-vote results
  (incl. voting lists) must be recorded and retained.

Concrete driver (client, 2026-06): a building project — e.g. balcony
reconstruction — produces a vendor/works contract plus budgets and expense
docs. Owners want to see all of it. The law agrees (§11). The app must let an
admin upload such documents and have them automatically visible to the owners
they legally belong to, without a bespoke ACL per file.

Today there is no documents library; uploads exist only for community-post
photos and paper-vote scans, on local disk only.

## Scope

**IN scope (v1):**
- Enrich the existing (stub) `documents` table: storage key, mime, size,
  document **type**, **audience**, original filename, retention + soft-delete.
- **Document type taxonomy** grounded in §8b/§9/§11 (full enumeration in AC).
- **Audience/visibility model**: doc anchors to an entity + carries an
  `audience` tier; visibility resolves as a union of *authority-from-above* and
  *audience-broadcast-into-subtree* (see Approach — this is the core mechanic).
- Storage via the already-built `src/lib/storage.ts` driver (local default; S3
  driver covers AWS S3 **and** Hetzner Object Storage).
- Upload endpoint, list/view UI grouped by type with filter + filename search.
- Auth-gated **proxy download** route (not signed URLs — GDPR/private docs).
- Delete = soft delete (retention), permission-gated (admin OR uploader).
- Server-side mime allowlist + per-type size cap.
- **Access audit** — each document view/download logged (supports §11 +
  personal-data accountability).
- i18n keys in `sk.json` + `en.json`.

**OUT of scope (v1) — candidate Phase 2:**
- **Project/dossier grouping** (bundle balcony contract + budgets + expenses
  under one "investičná akcia"). v1 ships flat, typed docs; grouping is the
  first fast-follow. See Notes — open decision.
- Per-user sharing (share one file with 3 named owners, not a role tier).
- Versioning / supersession chains (renewal of a contract). v1 = re-upload.
- E-signing / signed-PDF workflow.
- Expiry reminders (contract `validUntil` → notification).
- Full-text/OCR search inside documents; automated retention enforcement
  (cron purge after `retainUntil`).
- Encryption at rest beyond what the storage backend already provides.
- Redaction tooling for personal data in scanned docs.

## Approach

### Storage (already landed)
`src/lib/storage.ts` provides a driver abstraction with `local` (default) and
`s3` backends; the S3 driver serves both AWS S3 and Hetzner Object Storage via
endpoint/region env. Documents store a **storage key**, not a URL, and are
served by streaming `getStorage().get(key)` through an auth-gated route. This
**supersedes** the old spec note "do NOT introduce a separate storage provider"
— that note is obsolete as of 2026-06-08.

Key layout for tenant isolation + lifecycle:
`documents/<rootId>/<entityId>/<uuid>.<ext>`.

### Schema changes (`src/db/schema.ts`, migration via `drizzle-kit generate`)
Enrich `documents` (today: `name`, `fileUrl`, `uploadedById`, `entityId`,
`createdAt`):
- `storageKey text not null` — replaces `fileUrl`; resolved via storage driver.
- `mimeType varchar`, `sizeBytes integer`, `originalName varchar`.
- `type` — `document_type` enum (taxonomy below).
- `audience` — `document_audience` enum (`admin | owner | resident`).
- `retainUntil date null` — legal retention horizon (informational in v1).
- `deletedAt timestamp null` — soft delete.
- Fix FK `onDelete` (CLAUDE.md rule — current `uploadedById` has none):
  `uploadedById → set null` (keep doc if uploader removed),
  `entityId → restrict` (legal retention forbids cascade-on-entity-delete).
- New enums `document_type`, `document_audience` enumerated **fully** before any
  seed/use (CLAUDE.md catalog rule).

### Visibility model — the core mechanic
A document anchors to one entity (`entityId`) and carries an `audience` tier.
Two resolution directions, **unioned**:

```
rolesForAudience(audience):
  admin    -> { admin }
  owner    -> { admin, owner }
  resident -> { admin, owner, tenant, caretaker, vote_counter }   # everyone

canView(user, doc):
  Q = rolesForAudience(doc.audience)
  # (a) authority FROM ABOVE — board/manager anchored above the doc
  eff = getEffectiveRole(user, doc.entityId)        # nearest-ancestor role
  if eff in Q: return true
  # (b) audience BROADCAST INTO SUBTREE — the owners/residents below the anchor
  return listSubtreeMemberships(doc.entityId)
           .some(m => m.userId == user && m.role in Q)
```

Why **both** clauses (verified against `getEffectiveRole` +
`listSubtreeMemberships` in `src/lib/entity-tree.ts`):
- **(a) alone fails the balcony case.** A root-anchored doc with `audience=owner`:
  a flat owner has a membership at their *flat*, which is a *descendant* of root,
  not an ancestor — so `getEffectiveRole(owner, root)` is `null`. Authority
  flows down, not up.
- **(b) alone fails unit-level docs for the board.** A lease anchored at one
  flat: `listSubtreeMemberships(flat)` is just that flat's owner; the board
  admin (membership at root, *above* the flat) isn't in the subtree. Clause (a)
  catches the admin via ancestor walk.
- Union = "managers above the anchor" ∪ "the audience at/under the anchor".
  Anchor placement controls reach; `audience` sets the floor.

`document_audience` is a **dedicated** enum, not the 5-value `membership_role`
rank — operational roles (`caretaker`, `vote_counter`) don't sit on a single
visibility axis. The §11 owner-inspection categories map to `audience=owner`;
personal-data-heavy categories (employment, raw accounting) stay `admin`.

### Permissions (`src/lib/permissions.ts` + `permissions-entity.ts`)
- `uploadDocument`, `deleteDocument` — admin (+ uploader for own deletes).
- Viewing uses `canView` above, not a flat permission, because it is
  entity+audience scoped. Management endpoints use
  `requireEntityPermission(userId, entityId, "uploadDocument")`.

### Serving & restrictions
- Proxy route `app/api/documents/[id]/route.ts`: load doc → `canView` → stream
  bytes via storage driver → `Content-Disposition: attachment; filename=…`.
  No signed S3 URLs for private legal docs (matches existing
  `/api/uploads/[...path]` proxy + GDPR posture).
- **Retention**: never hard-delete on the management path; soft-delete sets
  `deletedAt`. Accounting docs + minutes carry `retainUntil = year+10`
  (§431/2002, §9 ods. 5). Auto-purge is OUT of v1.
- **Access audit**: log each download to `entity_audit_log` (or a dedicated
  `document_access_log`) — actor, doc, entity, timestamp — to evidence §11
  fulfilment and personal-data access.
- **GDPR / tenant nuance**: the §11 inspection right is the **owner's**;
  tenants (`audience=resident`) get only docs explicitly marked resident-wide
  (notices, house rules). Employment/accounting stay `admin`.
- **Mime allowlist**: pdf, png/jpg/webp, docx, xlsx, csv. **Size**: 25 MB
  default, raise per-type if needed.

### UI
- `/[locale]/dashboard/documents` — list grouped by `type`, filter by type +
  audience, filename search, upload modal (type + audience + entity picker,
  with type → sensible default audience/anchor), detail/download.
- Reuse shared card patterns; no bespoke card without justification
  (CLAUDE.md UI rule).

### Document type taxonomy (default anchor + audience + retention)
Audience default encodes the §11 mapping; admin can override within their rights.

| type (slug)       | SK label                                   | default anchor | default audience | retention basis            |
|-------------------|--------------------------------------------|----------------|------------------|----------------------------|
| `statutes`        | Zmluva o spoločenstve / Stanovy            | root           | owner            | permanent                  |
| `house_rules`     | Domový poriadok                            | root           | resident         | until superseded           |
| `minutes`         | Zápisnica zo schôdze / zhromaždenia        | root           | owner            | 10y (§9 ods. 5)            |
| `vote_result`     | Výsledok hlasovania (hlasovacia listina)   | root           | owner            | 10y (§9 ods. 5)            |
| `vendor_contract` | Dodávateľská zmluva                        | root           | owner (§11)      | 10y after expiry           |
| `works_contract`  | Zmluva o dielo                             | root / entity  | owner (§11)      | 10y after expiry           |
| `insurance`       | Poistná zmluva                             | root           | owner (§11)      | duration + 10y             |
| `revision`        | Revízna správa (revízie)                   | root / entity  | owner (§11)      | per revision cycle         |
| `budget`          | Rozpočet / cenová ponuka                   | root / entity  | owner            | per project                |
| `settlement`      | Vyúčtovanie úhrad za plnenia               | root / unit    | owner (§11)      | 10y (§431/2002)            |
| `fund_statement`  | Vyúčtovanie fondu prevádzky, údržby a opráv| root           | owner (§11)      | 10y (§431/2002)            |
| `accounting`      | Účtovný doklad / faktúra                   | root           | admin            | 10y (§431/2002)            |
| `employment`      | Pracovná zmluva (správca/údržbár)          | root           | admin            | personal data — admin only |
| `technical`       | Technická dokumentácia domu                | root           | owner            | building lifetime          |
| `maintenance`     | Protokol o údržbe / oprave                 | entity         | owner            | 10y                        |
| `notice`          | Oznam vlastníkom                           | root / entity  | resident         | n/a                        |
| `other`           | Iné                                        | any            | admin            | n/a                        |

## Acceptance Criteria

- [ ] `documents` table enriched with `storageKey`, `mimeType`, `sizeBytes`,
      `originalName`, `type`, `audience`, `retainUntil`, `deletedAt`; `fileUrl`
      removed; both FKs carry explicit `onDelete` (`uploadedById` set null,
      `entityId` restrict).
- [ ] `document_type` enum lands the **full** taxonomy above (17 slugs) and
      `document_audience` enum lands (`admin`, `owner`, `resident`) **before**
      any seed/use; migration generated via `drizzle-kit generate`.
- [ ] Admin can upload pdf/png/jpg/webp/docx/xlsx/csv to an entity, choosing
      type + audience; type pre-fills a sensible default audience/anchor.
- [ ] Server enforces mime allowlist + per-type size cap (default 25 MB).
- [ ] `canView` resolves the union model: a root-anchored `audience=owner` doc
      is visible to **every owner in the building** (subtree broadcast) and to
      the board (authority from above); a flat-anchored doc is visible to that
      flat's owner + the board, not other owners.
- [ ] Tenants see only `audience=resident` docs; `employment`/`accounting`
      never surface to non-admins.
- [ ] Documents served via auth-gated proxy `app/api/documents/[id]`; `canView`
      enforced; no public/signed URLs.
- [ ] Each download is recorded to an access audit (actor, doc, entity, ts).
- [ ] Delete is soft (`deletedAt`), permission-gated (admin OR uploader);
      deleted docs disappear from listings but remain stored for retention.
- [ ] Document list page at `/[locale]/dashboard/documents`, grouped by type,
      with type/audience filter + filename search.
- [ ] All new strings in `sk.json` + `en.json`; no hardcoded UI text.
- [ ] Storage works with `STORAGE_DRIVER=local` and `STORAGE_DRIVER=s3`
      (verified against one S3 target — AWS or Hetzner).

## Project Context

**project_type: node** (Next.js App Router + Drizzle + next-intl).

Legal basis (cite in code comments where audience defaults / retention are set,
per CLAUDE.md "legally regulated content" caution — note these are *uploaded*
docs, so statutory-template restrictions don't bind, but retention/access
semantics do):
- §8b, §9 ods. 5, §11 ods. 6–7 zák. 182/1993 Z.z. (správa, evidencia, právo
  nahliadať, ochrana osobných údajov).
- §35 zák. 431/2002 Z.z. o účtovníctve — 10-year retention of accounting records.
- zák. 395/2002 Z.z. o archívoch a registratúrach — registratúrny poriadok.

Storage env (already documented in `.env.example`): `STORAGE_DRIVER`,
`UPLOADS_PATH` (local), `S3_*` (shared, AWS vs Hetzner via `S3_ENDPOINT`/
`S3_REGION`).

Verified against current code (CLAUDE.md "verify lists against code" rule):
- `membership_role` enum = `admin, owner, tenant, vote_counter, caretaker`
  (`src/db/schema.ts:146`) — `document_audience` deliberately a separate enum.
- `documents` table current shape `src/db/schema.ts:359`.
- `getEffectiveRole` / `listSubtreeMemberships` `src/lib/entity-tree.ts`.
- entity-aware permission API `src/lib/permissions-entity.ts`.

## Notes

**Resolved decisions (2026-06-08):**
1. **Project/dossier grouping → Phase 2.** v1 ships flat typed docs; `type`
   filter recovers most value and satisfies §11. `document_projects` grouping
   is the first fast-follow, not in v1.
2. **Per-user sharing → no.** Role-tier audience (`admin/owner/resident`)
   covers every legal case; no named-owner sharing. Revisit only if a real
   case appears.
3. **Retention enforcement → manual.** v1 stores `retainUntil` (informational)
   and soft-deletes; no auto-purge cron. Auto-deleting legally-required docs is
   too risky for launch.
4. **Access-audit → dedicated table.** `document_access_log` (separate from
   `entity_audit_log`) — read events are high-volume with a different lifecycle
   than entity mutations.

**History:**
- Client meeting 2026-05-12: "Nahranie dokumentov".
- 2026-06-08: storage driver (`src/lib/storage.ts`, local + S3/Hetzner) built
  ahead of this spec; spec rewritten from stub to legally-grounded design with
  document taxonomy, union visibility model, and retention/GDPR restrictions.
  Old "no separate storage provider" constraint dropped.
- 2026-06-08: code-complete. Backend (schema/migration 0038, `documents.ts` +
  `documents.server.ts`, permissions, `GET/POST /api/documents`,
  `GET/DELETE /api/documents/[id]`) and UI (`/documents` page, upload form,
  document card, Sidebar nav, i18n sk+en — 44 keys each, full parity). All ACs
  code-complete; **pending end-to-end verification** (`pnpm db:migrate` +
  manual click-through) before promotion to `implemented` and setting
  `last_verified`.
  - v1 limitation: uploads anchor at the user's current root entity
    (`resolveCurrentEntityId`); per-unit / per-entrance anchoring from the UI is
    deferred (the resolver already supports any anchor — only the form is
    root-only). Audience tiers still control who sees each doc.

**Sources (research 2026-06-08):**
- [Zákon 182/1993 Z.z. (slov-lex, aktuálne znenie)](https://static.slov-lex.sk/static/SK/ZZ/1993/182/20250101.html)
- [Nahliadanie do dokladov — právo vlastníka, povinnosť správcu](https://www.spravcabudov.sk/clanky/vseobecne/nahliadanie-do-dokladov-pravo-vlastnika-povinnost-spravcu)
- [Archivácia dokumentov bytového domu](https://spravcabudov.sk/clanky/vseobecne/archivacia-dokumentov-bytoveho-domu)
- [Uchovávanie a archivácia účtovných dokladov (JASPIS)](https://jaspis.sk/aktuality/uchovavanie-archivacia-ochrana-uctovnych-dokladov)
- [Právo vlastníka nahliadať do dokladov (ASB.sk)](https://www.asb.sk/stavebnictvo/sprava-budov/pravo-vlastnika-nahliadat-do-dokladov-suvisiacich-so-spravou-domu)
