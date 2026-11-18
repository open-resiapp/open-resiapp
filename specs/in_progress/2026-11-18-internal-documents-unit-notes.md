---
spec_id: BYT-20261118-005
title: "Board-internal documents, owner folder & internal unit notes"
status: in_progress
created: 2026-11-18
updated: 2026-11-18
author: Filip
owner: filipvnencak
last_verified: 2026-11-18
project_type: node
depends_on:
  - BYT-20260512-006   # document library (audience tiers, canSeeDocPath) — implemented
  - BYT-20260608-001   # document attachments + projects — implemented
  - BYT-20261117-002   # UX simplification (IA: Vlastníci, Dokumenty, Dom) — in progress
related_handoffs: []
tags:
  - documents
  - owners
  - privacy
  - gdpr
  - audit
  - email
  - schema-change
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Give the board a safe place for **internal** paperwork and memory:

1. documents marked **"Len výbor"** that are attached to the building, a unit or a
   specific owner — the owner never sees, downloads, or gets notified about them, and
   this is enforced server-side on every read path;
2. an **owner folder** — documents that belong to one person (contract, correspondence,
   a reminder letter), visible to that person and the board only;
3. one **internal note per unit** that outlives a change of owner, edited by the board,
   with "naposledy upravil / kedy";
4. optional **"Poslať e-mailom"** of a document to an owner (attachment under a size
   limit, link above it), the document staying in their folder;
5. an **audit trail** of who uploaded a document, changed its visibility, or sent it.

### Problem statement

- Chairmen keep the real memory of the house ("v byte 12 tečie stúpačka, kľúč má
  suseda", "dlh splácaný dohodou od 3/2026") in notebooks and personal e-mail. When the
  chairman changes, it is lost; when the owner changes, it is unclear what belongs to
  the unit and what to the person.
- The library already supports a board-only tier, but nothing ties a document to a
  **person**, nothing records who **changed** visibility, there is no UI to change it
  after upload, and two read paths bypass or leak around the visibility rule (see
  "What already exists").
- Competitor Resitech ships "internal docs only for admins on owner/unit", "internal
  note per unit (survives owner change)" and "send document as e-mail attachment
  (≤ 20 MB)". Seniors-first boards ask for exactly this.

## Scope

**IN scope:**

- Close the two existing visibility gaps (local-storage uploads route, project document
  count) before adding anything new.
- Change visibility after upload (`audience`), board only, audited.
- Optional `subject_user_id` on documents → owner folder; visibility rule extended.
- Unit internal note (one per unit entity), create / edit / clear, audited.
- `document_audit_log` for upload / visibility change / subject change / delete / send.
- "Poslať e-mailom" for a document the recipient may already see; attachment ≤ limit,
  link above it; dedupe via the shared `*_notifications_sent` table.
- Negative tests for list, download, feed attachments, project views, MCP, storage
  bypass, and notification/e-mail paths.
- i18n `sk` / `en` / `cs` for every new string, incl. error codes and the e-mail.

**OUT of scope:**

- Full GDPR DSAR export (separate spec, see BYT-20260609-006 Out-of-scope) — this spec
  only records the decision what DSAR must include (Notes → Decisions).
- Note history / versioning (only last-edited-by/at + audit event).
- Sending to non-users / arbitrary e-mail addresses, bulk send to all owners, ZIP bundles.
- Per-owner internal notes (note is per **unit**, by request).
- Faults/poruchy internal notes (no faults module yet).
- Retention auto-purge (still informational, as in BYT-20260512-006).

## What already exists (verified 2026-11-18)

- **Board-only tier exists.** `documentAudienceEnum` = `admin | owner | resident`
  (`src/db/schema.ts:200`); `admin` is labelled "Len výbor" (`messages/sk.json:211`).
  `AUDIENCE_ROLES.admin = ["admin"]` (`src/lib/documents.ts:85`), resolved by the single
  pure resolver `canSeeDocPath` (`src/lib/documents.ts:115`).
- **Server-side enforcement on the main paths** — all go through `canSeeDocPath`:
  list `listVisibleDocuments` (`src/lib/documents.server.ts:56`), download
  `getViewableDocument` (`:89`) used by `GET /api/documents/[id]`
  (`src/app/api/documents/[id]/route.ts:18`, 404 for forbidden, access logged), project
  docs `listProjectDocuments` (`:267`), post attachments `listTargetDocuments` (`:378`),
  feed attachments (`src/lib/feed.server.ts:273`), MCP `search_documents` /
  `get_document_text` (`src/lib/mcp/tools/core.ts:188`, `:236`).
- **Signed URLs:** `StorageDriver.signedUrl` exists (`src/lib/storage.ts:49`, S3 impl
  `:281`) but has **no caller** today; document downloads are proxied. Keep it that way.
- **Documents anchor to an entity only** (`documents.entityId`, `src/db/schema.ts:447`)
  — building root, entrance or unit. No person link → no owner folder today.
- **Uploader is recorded** (`documents.uploadedById`), no visibility-change history.
  `PATCH /api/documents/[id]` (`route.ts:86`) only assigns a project; there is no way to
  change `audience` after upload.
- **Read trail exists:** `document_access_log` (`src/db/schema.ts:490`).
- **Entity mutation audit:** `entity_audit_log` + `entity_audit_action` enum
  (`src/db/schema.ts:343`, `:162`).
- **No document notifications exist** — no e-mail or push is sent on upload. Post push
  sends only the post title (`src/lib/posts.ts:157`); `onPostCreate` hook payload has
  no attachments.
- **Notification dedupe tables:** `community_notifications_sent` with `kind` enum
  (`src/db/schema.ts:1046`, enum `:122`), plus module-local
  `mod_accounting_notifications_sent` (`modules/accounting/src/db/schema.ts:868`).
- **E-mail pattern to copy:** `sendSettlementPublishedNotification`
  (`src/lib/email.ts:551`) — `getTranslations({ locale, namespace: "Email.…" })`,
  optional `locale`. No e-mail in the codebase sends attachments yet (nodemailer
  supports `attachments`).
- **No unit note** anywhere (`grep note src/db/schema.ts` → only `fundingNote`,
  `directoryEntries.note`). No unit detail page; units are shown in owner detail
  (`src/components/owners/OwnerDetail.tsx`, page `src/app/[locale]/(dashboard)/owners/[id]/page.tsx`)
  and the unit ledger `src/app/[locale]/(dashboard)/accounting/karta/[unitId]/page.tsx`.
- **Permissions:** `uploadDocument: ["admin","caretaker"]`, `deleteDocument: ["admin"]`
  (`src/lib/permissions.ts:30-31`).
- **User delete guard** already blocks delete when the user uploaded documents
  (`src/app/api/users/[id]/route.ts:422`).

### Gaps found while verifying (fix in Phase A)

- **G1 — storage bypass (local driver).** The local driver stores documents under
  `getUploadsDir()` (`src/lib/storage.ts:115`), the same root that
  `GET /api/uploads/[...path]` (`src/app/api/uploads/[...path]/route.ts:14`) serves to
  **any logged-in user** without a visibility check. A "Len výbor" PDF at
  `documents/<entityId>/<uuid>.pdf` is downloadable by anyone who learns the key. Only
  the random UUID protects it today.
- **G2 — count leak.** `listVisibleProjects` counts all non-deleted documents in a
  project, incl. board-only ones (`src/lib/documents.server.ts:250-256`). An owner sees
  "5 dokumentov" and opens 3.
- **G3 — uploader override.** `DELETE` / `PATCH /api/documents/[id]` allow the uploader
  regardless of role; a caretaker who uploads with `audience=admin` can then neither see
  it nor be stopped from re-managing it. (Decision below.)

## Approach

### Visibility model (extend the one resolver, no second rule)

`canSeeDocPath(memberships, path, audience)` gains a fourth input `subjectUserId` and the
viewer's `userId`:

```
visible =
  (viewer has ADMIN membership on the doc's root-to-leaf line)          // board: always
  OR (
    audience != 'admin'
    AND subjectUserId IS NULL  → existing rule (audience role + path line)
    AND subjectUserId IS NOT NULL → viewer.id == subjectUserId AND existing rule
  )
```

- `audience = 'admin'` ⇒ only board. Subject owner never sees it (incl. when the owner is
  a co-owner of the unit).
- Owner-folder doc (`subjectUserId` set, `audience = owner`) ⇒ that owner + board; **not**
  the co-owners of the same unit, not the next owner of the unit.
- Stays pure in `src/lib/documents.ts` (client-safe), every call site already passes
  through it — the change is the signature + callers in `documents.server.ts`,
  `feed.server.ts`, MCP.
- Board member who is also the subject owner sees their own internal docs (admin role
  wins). Decision below.

### Read paths that must honour it (each gets a negative test)

| Path | Where | Change |
|---|---|---|
| Library list | `listVisibleDocuments` | new resolver |
| Download | `GET /api/documents/[id]` → `getViewableDocument` | new resolver, 404 |
| Project docs + count | `listProjectDocuments`, `listVisibleProjects` | count only visible (G2) |
| Post attachments / feed | `listTargetDocuments`, `feed.server.ts:273` | new resolver |
| MCP | `search_documents`, `get_document_text` | via helpers; `audience`/`subject` never surfaced to non-board |
| Raw storage | `/api/uploads/[...path]` | reject any key under `documents/` (G1) — only image categories it uploads itself |
| Signed URLs | `storage.signedUrl` | guard: throws for keys under `documents/`; documents stay proxy-only |
| Notifications | new `sendDocumentToOwner`, any future upload notice | recipient must pass the resolver; board-only ⇒ zero sends |

### Changing visibility

- `PATCH /api/documents/[id]` accepts `{ audience?, subjectUserId? }` in addition to
  `projectId`. Board (`admin` membership on the doc line) only — the uploader shortcut
  does **not** apply to visibility.
- Narrowing (owner → admin) is immediate. Widening (admin → owner/resident) shows a
  confirm dialog naming who will gain access ("Uvidí ho: Ján Novák" / "všetci vlastníci").
  Widening does **not** notify anyone automatically.
- Every change writes a `document_audit_log` row (before/after).

### Owner folder (UI)

- **Vlastníci → detail vlastníka** (board): new section "Dokumenty vlastníka" — list of
  docs with `subjectUserId = owner` plus docs on their units, each with a visible chip
  "Len výbor" (lock icon **with text**) or "Vidí vlastník". One primary "Nahrať
  dokument" pre-fills subject = this owner, anchor = their unit (or root if several),
  audience = `admin` (safe default).
- **Dokumenty** (board): upload form gains "Komu patrí" — Celý dom / Byt / Vlastník
  (searchable select); filter chip "Interné". Library table shows the chip.
- **Dom → Dokumenty** (owner): a "Moje dokumenty" block on top (subject = self, plus own
  unit docs) above the building library. Owners with none see nothing (no empty card).
- Senior baseline from BYT-20261117-002: ≥16 px, every icon labelled, one primary
  button per screen.

### Internal unit note

- One row per unit entity in `unit_notes`. Board edits in a card "Interná poznámka k
  bytu" on (a) each unit block in Vlastníci → detail vlastníka, (b) the board view of
  `accounting/karta/[unitId]` (collapsed). Shows "Naposledy upravil Peter K., 12. 11. 2026".
- Edit = textarea + "Uložiť"; **clear** = "Vymazať poznámku" with confirm → row
  deleted (undo path). Optimistic concurrency: save sends the `updatedAt` it loaded; on
  mismatch the server returns code `unit_note.conflict` and the UI shows the newer text.
- Survives owner change by construction: keyed on `entity_id`, not membership/user.
  Archiving a unit keeps the note; hard-deleting a unit cascades.
- **Never** rendered to non-board roles, never in owner-facing pages, MCP tools, CSV/PDF
  exports, `entities.data` (deliberately a separate table — `entities.data` feeds the
  import wizard and per-kind editors).

### Send document by e-mail (optional, Phase D)

- Action "Poslať e-mailom" on a doc row (board). Recipients: the subject owner, or
  active owners of the anchor unit. Optional short message (≤ 500 chars).
- Precondition: each recipient must pass the visibility resolver for this doc. A
  board-only doc returns code `document.send.board_only`; UI offers "Najprv sprístupniť
  vlastníkovi" (a visibility PATCH, audited) — never auto-widens.
- `sizeBytes ≤ DOCUMENT_EMAIL_ATTACHMENT_MAX` (default 10 MB, env-overridable) ⇒
  attach; above ⇒ link to `/documents?doc=<id>` (login required, proxied download).
  Shell owners without login get attachment only; over limit ⇒ code
  `document.send.too_large_no_account`.
- New `sendDocumentToOwner({ recipientEmail, recipientName, documentName, message?,
  attachment?, linkUrl?, locale? })` in `src/lib/email.ts`, strings from
  `Email.documentSent` in all three catalogs, owner's locale. Not the SK-hardcoded
  pattern.
- Dedupe: one send per (document, recipient) per 10 minutes via
  `community_notifications_sent` kind `document_sent`. Each send → audit row
  `document.email_sent` with mode `attachment|link`. Sending is irreversible; the
  confirm dialog says so.
- The document stays where it is (owner folder); sending does not copy or change it.

### Schema sketch (via `drizzle-kit generate`, migration committed with schema)

```ts
// documents — new column
subjectUserId: uuid("subject_user_id").references(() => users.id, {
  onDelete: "set null",   // matches uploadedById; user-delete guard blocks first
}),
// + index documents_subject_idx (subject_user_id)

// unit_notes — one per unit entity
export const unitNotes = pgTable("unit_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityId: uuid("entity_id")
    .references(() => entities.id, { onDelete: "cascade" })   // owned child of unit
    .notNull(),
  body: text("body").notNull(),            // app-capped 5 000 chars
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  updatedById: uuid("updated_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({ entityUnique: uniqueIndex("unit_notes_entity_idx").on(t.entityId) }));

// document_audit_log — mutations only (reads stay in document_access_log)
export const documentAuditActionEnum = pgEnum("document_audit_action", [
  "document.upload", "document.set_audience", "document.set_subject",
  "document.delete", "document.email_sent",
]);
export const documentAuditLog = pgTable("document_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: documentAuditActionEnum("action").notNull(),
  beforeJson: jsonb("before_json"),   // { audience, subjectUserId } — never file content
  afterJson: jsonb("after_json"),     // + { recipientUserId, mode } for email_sent
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({ docIdx: index("document_audit_document_idx").on(t.documentId) }));

// entity_audit_action — add "unit_note.update", "unit_note.clear"
//   (entityId = unit; before/after hold only { length, updatedAt }, NOT the text)

// community_notification_kind — add "document_sent";
// community_notifications_sent — add nullable
//   documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" })
//   + index (document_id, recipient_id, kind)
```

- Backfill: one `document.upload` audit row per existing document from
  `uploadedById/createdAt` — hand-written SQL migration per CLAUDE.md pattern.
- No runtime DDL, no background job. All reads are query-time over indexed columns.
- Enum additions only (no rename / enum→text), so no string-literal sweep needed beyond
  the new values.
- Error codes (i18n-mapped in UI, never prose): `document.forbidden`,
  `document.audience.invalid`, `document.subject.not_owner`, `document.send.board_only`,
  `document.send.too_large_no_account`, `document.send.no_email`,
  `document.send.throttled`, `unit_note.too_long`, `unit_note.conflict`.

### Phasing

- **A** — G1 + G2 fix, resolver signature, `document_audit_log` + backfill, visibility
  PATCH + UI chip/filter. Ships alone; closes the leaks.
- **B** — `subject_user_id`, owner folder UI (board + owner "Moje dokumenty").
- **C** — `unit_notes` + entity audit actions.
- **D** — e-mail send.

## Acceptance Criteria

**Visibility — negative tests (owner = subject owner of the doc; co-owner = other active owner of the same unit; neighbour = owner of another unit; caretaker; tenant)**

- [x] A doc with `audience=admin` on (a) building root, (b) a unit, (c) with subject =
      owner is absent from `GET /api/documents` for owner, co-owner, neighbour, tenant,
      caretaker; the response contains **only** docs the resolver allows (assert full id
      set, not presence).
- [x] `GET /api/documents/[id]` for that doc returns **404** (not 403) to each of those
      roles and writes **no** `document_access_log` row.
- [x] `GET /api/uploads/documents/<entityId>/<file>` returns 400/404 for every role,
      including board (documents are served only via `/api/documents/[id]`).
- [x] `storage.signedUrl("documents/…")` throws; a unit test asserts no caller in `src/`
      or `modules/` passes a document key.
- [x] A board post with an attached board-only doc: the owner's feed item, post detail
      and `listTargetDocuments` show zero attachments for that doc; the board sees it.
- [x] Project with 3 visible + 2 board-only docs: owner sees `documentCount = 3` and
      exactly 3 docs; board sees 5.
- [x] MCP `search_documents` as owner returns no board-only or other-subject docs (full
      set assertion); `get_document_text` returns `not_found` for them.
- [x] Owner-folder doc (`subject = A`, `audience = owner`, anchor = unit of A and B):
      visible to A and board; absent for co-owner B, neighbour, tenant; after A's unit
      is sold and C becomes owner, C does not see it.
- [x] Uploading or changing visibility never sends e-mail or push (spy on transporter +
      `sendPushToAll`: zero calls).

**Visibility change + audit**

- [x] Board can change `audience` and `subject` after upload; each change writes one
      `document_audit_log` row with before/after; non-board (incl. caretaker uploader)
      gets `document.forbidden`.
- [x] Widening shows a confirm naming who gains access; narrowing is immediate.
- [x] Upload writes `document.upload`; soft delete writes `document.delete`; existing
      documents have a backfilled `document.upload` row.
- [x] Board sees the audit trail on the document ("Nahral … · Zmenil viditeľnosť na Len
      výbor … · Poslal e-mailom …"); owners never see it.

**Unit note**

- [x] Board can create, edit and clear the note of a unit; clear deletes the row; the
      card shows last-edited-by name and date.
- [x] After the unit's owner membership is archived and a new owner added, the note is
      unchanged and still shown to the board.
- [x] Owner, co-owner, tenant, caretaker: no note text in any page, API response, MCP
      tool output or export of their unit (assert response bodies do not contain the
      note text).
- [x] Concurrent edit returns `unit_note.conflict` and the newer text is displayed.
- [x] Each create/edit/clear writes `entity_audit_log` (`unit_note.update` /
      `unit_note.clear`) without the note body.

**E-mail send (Phase D)**

- [x] Doc ≤ limit arrives as an attachment; doc > limit arrives as a link that requires
      login and downloads through `/api/documents/[id]` (access logged).
- [x] Sending a board-only doc is refused with `document.send.board_only`; no e-mail,
      no `community_notifications_sent` row.
- [x] Recipient without e-mail → `document.send.no_email`; second send within 10 min →
      `document.send.throttled`.
- [x] E-mail subject/body come from `Email.documentSent` in `sk`/`en`/`cs`, chosen by the
      recipient's locale; `sendDocumentToOwner` accepts optional `locale`.
- [x] Each successful send writes one `community_notifications_sent` row
      (`kind = document_sent`) and one `document.email_sent` audit row.

**i18n / UX**

- [x] All new strings and every error code above exist in `messages/sk.json`,
      `en.json`, `cs.json`.
- [ ] New screens sit in the BYT-20261117-002 IA: board — Dokumenty, Vlastníci (owner
      detail), Financie (karta bytu); owner — Dom → Dokumenty. No new nav item.

## Project Context

- Schema: `src/db/schema.ts` (documents `:447`, audience enum `:200`, entity audit
  `:162`/`:343`, access log `:490`, community notifications `:122`/`:1046`)
- Resolver: `src/lib/documents.ts:85-124`
- Server helpers: `src/lib/documents.server.ts` (`:56`, `:89`, `:228`, `:267`, `:378`)
- Routes: `src/app/api/documents/route.ts`, `src/app/api/documents/[id]/route.ts`,
  `src/app/api/uploads/[...path]/route.ts`, `src/app/api/users/[id]/route.ts:422`
- Storage: `src/lib/storage.ts` (`signedUrl` `:49`/`:281`, local root `:115`)
- Feed: `src/lib/feed.server.ts:226-273`; posts push: `src/lib/posts.ts:157`
- MCP: `src/lib/mcp/tools/core.ts:188`, `:236`; `src/lib/mcp/tools/owners.ts`
- E-mail: `src/lib/email.ts` (pattern `:551`)
- UI: `src/components/documents/DocumentUploadForm.tsx`, `DocumentCard.tsx`,
  `src/components/owners/OwnerDetail.tsx`, `src/app/[locale]/(dashboard)/dom/page.tsx`,
  `src/app/[locale]/(dashboard)/accounting/karta/[unitId]/page.tsx`
- Permissions: `src/lib/permissions.ts:29-31`
- Specs: `specs/implemented/2026-05-12-document-upload.md`,
  `specs/implemented/2026-06-08-document-attachments-projects.md`,
  `specs/specs/2026-06-09-gdpr-selfhost-toolkit.md`,
  `specs/in_progress/2026-11-17-ux-simplification.md`

## Notes

### Decisions to confirm before `in_progress`

1. **GDPR Art. 15 (legal).** A unit note or an internal doc that names or concerns the
   owner is personal data about them; the right of access likely covers it (limited
   exceptions, e.g. rights of others, legal claims). Proposed: notes/internal docs stay
   out of every owner-facing view and self-service export, **but** the future DSAR spec
   must decide whether the board's DSAR export includes (a) unit notes for units the
   subject owned during the note's lifetime and (b) `audience=admin` docs with
   `subject = them`. Needs a lawyer/DPO answer; add a UI hint on the note card: "Píšte
   len fakty — vlastník môže požiadať o prístup k údajom o sebe."
2. **Board member as subject.** If the subject owner is also on the board, they see
   their own internal docs/notes (admin role wins). Accept, or hide subject-self from
   board members (conflict of interest)?
3. **G3 caretaker uploads.** Disallow `audience=admin` for caretaker uploads, or allow
   and treat caretaker as uploader-only (can't see afterwards)? Proposed: disallow.
4. **Audit store.** Dedicated `document_audit_log` (proposed — needs `document_id` index)
   vs. reusing `entity_audit_log` with `document.*` actions and doc id in JSON.
5. **Dedupe table.** Extend `community_notifications_sent` with `document_id` +
   `document_sent` kind (CLAUDE.md "one table" rule) — accept the table name drift, or
   rename to `notifications_sent` in a separate refactor?
6. **Attachment limit.** 10 MB default (base64 ≈ +33 %, many SMTP relays cap at 10–25
   MB) vs. Resitech's 20 MB.
7. **Note on karta bytu.** Show the note on the unit ledger too, or only in Vlastníci?
8. **`subject_user_id` on user delete:** `set null` + existing delete guard (proposed),
   or `restrict`? With `set null` an owner-folder doc would fall back to unit-wide
   visibility — proposed: delete guard also blocks when the user is a subject.

### Deferred

- Note history (versions, diff) and per-owner notes.
- Send to non-users / ZIP / bulk send; send notices by e-mail (Resitech has it).
- Owner notification on newly shared owner-folder doc (opt-in, later; would also use
  `community_notifications_sent`).
- Full DSAR export and erasure workflow (separate GDPR specs).
- Retention auto-purge of internal docs.

## Implementation notes (2026-11-18)

Implemented in one pass (phases A–D). Migration NOT generated — coordinator runs
`pnpm db:generate`; the `document.upload` backfill is a hand-written migration
(SQL in the implementer report).

- **G1** `/api/uploads/[...path]` now serves only an explicit category allowlist
  (`src/lib/uploads-access.ts`: `paper-votes` → recordPaperVote, `community-posts`
  → any member); everything else (documents/, accounting…, branding/) is 404.
  `signedUrl` refuses proxy-only prefixes (`src/lib/storage-keys.ts`).
- **G2** `listVisibleProjects` counts per-viewer visible docs.
- **G3** DELETE/PATCH: board (admin on the doc line) or the uploader only while
  they can still see the doc; audience/subject changes are board-only. Caretaker
  uploads with `audience=admin` or a subject are refused (`document.forbidden`).
- Resolver `canSeeDocPath(mems, path, audience, subject)` — subject arg is
  required (null only for projects) so TS forces every call site.
- Owner folder: `documents.subject_user_id`, `/api/documents/folder`,
  `/api/documents/subjects`, `OwnerDocumentsSection` (board + "Moje dokumenty"
  on /documents). Shell merge moves `subject_user_id`; user delete guard blocks
  when the user is a subject (Notes #8).
- Unit note: `unit_notes`, `/api/unit-notes/[entityId]`, `UnitNoteCard`
  (self-contained, renders nothing for non-board). Mount points in OwnerDetail
  and karta bytu belong to other streams — coordinator mounts.
- Audit: `document_audit_log` + history dialog; unit notes →
  `entity_audit_log` (`unit_note.update` / `unit_note.clear`, length+updatedAt only).
- E-mail send: `sendDocumentToOwner` (`Email.documentSent`), dedupe/throttle
  via `community_notifications_sent` (kind `document_sent`, `document_id`) under
  a transaction-scoped advisory lock (multi-replica safe).
- Negative checks: `pnpm test:documents-visibility` (pure resolver full-set
  assertions, upload allowlist, signedUrl policy, source scans). DB-level ACs
  (404 + no access-log row, response bodies, e-mail spy) are manual.

### Decisions taken (TODO(decision) in code)
1. Notes #2 — board member who is the subject sees own internal docs (admin wins).
2. Notes #3 — caretaker may not upload `audience=admin` / file under an owner.
3. Notes #4 — dedicated `document_audit_log`.
4. Notes #5 — extend `community_notifications_sent` (no rename).
5. Notes #6 — 10 MB default, `DOCUMENT_EMAIL_ATTACHMENT_MAX` env override.
6. Notes #7 — `UnitNoteCard` supports `defaultCollapsed` for karta bytu.
7. Notes #8 — `set null` + delete guard also blocks subject users.
8. Paper-ballot photos readable only by admin / vote_counter (was: any member).
9. E-mail locale = instance default (users have no stored locale yet).
