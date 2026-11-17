---
spec_id: BYT-20261117-001
title: "MCP server — OAuth, board tools (treasurer + chairman), MCP Apps confirmations, ballot confirmation"
status: spec
created: 2026-11-17
updated: 2026-11-17
author: byt-app
owner: filipvnencak
last_verified: 2026-11-17
project_type: other
depends_on:
  - RES-20260428-002   # plugin module system (mcp ships as a core module, disabled by default)
  - RES-20260505-001   # voting module
  - BYT-20260609-008   # multi-item ballot (ballot confirmation commits a whole ballot)
  - BYT-20260512-002   # accounting module (karta, reconciliation, inbox, závierka)
  - BYT-20260512-006   # document library (visibility rules)
related_handoffs: []
tags:
  - mcp
  - oauth
  - ai
  - accounting
  - voting
  - security
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Let a community's **treasurer (pokladník) and chairman (predseda)** run their
monthly work from an AI chat (Claude, ChatGPT, any MCP host): "who hasn't paid?",
"match these bank lines", "post the invoices in the inbox", "will FPÚO cover the
roof in 2028?", "draft a vote on the lift", "approve the závierka". Owners get one
tool in this round: **request a ballot confirmation** that they finish by clicking
the confirmation email.

Every write is **confirmed by a human click**, never by the model. On hosts that
support **MCP Apps** the click happens in an inline view in the chat; elsewhere it
happens on a confirmation page in the app.

### Problem statement

Board members are volunteers without accounting training. The month-end routine
(reconcile, post expenses, chase debtors, check deadlines) is many screens deep.
They already use AI chats; the app has no way in. The existing external API
(`src/app/api/external/v1/*`, API keys) has no user identity, so it cannot apply
the board-role and membership rules the app depends on.

## Scope

**In scope**
- MCP endpoint on **each instance** (`https://<instance>/api/mcp`), Streamable HTTP.
- OAuth 2.1 authorization server inside the app (login = existing NextAuth).
- `mcp` core module, **disabled by default**; admin enables it in Settings → Modules.
- `Principal` refactor so lib functions run without a NextAuth session.
- 22 read tools + 9 write tools for treasurer / chairman / admin (tables below).
- Generic **pending action → human confirm** framework, rendered as an MCP App
  view, with an in-app fallback page.
- **Pending ballot + email confirmation** (`request_ballot_confirmation`) for owners.
- MCP audit log, per-user "Connected AI apps" list with revoke.

**Out of scope (this spec)**
- Central `mcp.resiapp.cloud` proxy (per-instance only).
- Tools for tenants / caretakers / vote counters; community (burza, pomoc, udalosti).
- `publish_vyuctovanie`, fee-schedule publish, opening balance, bank import / Fio
  sync, any void, role/membership changes, settings, exports — UI only.
- `create_expense` with a new file upload (inbox posting covers scanned invoices).
- Passkey ballot confirmation (passkey module is unbuilt; WebAuthn in a host
  sandbox iframe would also fail the RP-ID check).
- Fixing the **web** ballot flow's missing confirmation (see Notes → found gaps).

## Approach

### 1. Protocol & transport

- Target MCP **2026-07-28** (stateless: no `initialize`, no `Mcp-Session-Id`;
  capabilities in each request's `_meta`). Also accept **2025-11-25** clients —
  hosts upgrade slowly. Use the official TS SDK; the server is stateless, so any
  replica can serve any request.
- `src/app/api/mcp/route.ts` exports only `POST` (and `GET`/`DELETE` returning 405)
  per the route-handler rule. Server construction, tool registry and handlers live
  in `src/lib/mcp/*` (`server-only`).
- No websocket, no subscriptions, no `listChanged` push. Tools are pull-only.

### 2. Authorization (OAuth 2.1, per MCP 2026-07-28)

| Requirement | Implementation |
|---|---|
| Protected Resource Metadata (RFC 9728) — MUST | `GET /.well-known/oauth-protected-resource` → `{resource: "<origin>/api/mcp", authorization_servers: ["<origin>"], scopes_supported}`. 401 from `/api/mcp` carries `WWW-Authenticate: Bearer resource_metadata=…, scope="…"`. |
| AS metadata (RFC 8414) | `GET /.well-known/oauth-authorization-server` with `authorization_response_iss_parameter_supported: true`, `code_challenge_methods_supported: ["S256"]`, `client_id_metadata_document_supported: true`. |
| Client registration | **CIMD first** (client_id is an HTTPS URL; fetch + validate + cache the metadata document, exact-match `redirect_uris`). **DCR (RFC 7591) as deprecated fallback** for older hosts. No pre-registration UI. |
| PKCE | S256 required; plain rejected. |
| Resource indicators (RFC 8707) | `resource` required on authorize + token; token `aud` bound to `<origin>/api/mcp`; `/api/mcp` rejects any other audience. |
| `iss` in authorization response (RFC 9207) | Always sent, incl. error responses. |
| Tokens | Opaque random tokens; DB stores SHA-256 only. Access 1 h, refresh 30 d with rotation + reuse detection (reuse revokes the family). |
| Step-up | Missing scope → 403 `insufficient_scope` with **all** scopes the call needs in one challenge. |
| Consent | `/[locale]/oauth/authorize`: NextAuth login → screen showing client name + logo (from CIMD), requested scopes in plain language, the data-leaves-the-instance warning, "Povoliť / Zamietnuť". Pending/rejected users cannot grant. |
| Revoke | Profile → "Pripojené AI aplikácie": list grants (client, scopes, last used), revoke = delete token family. Admin can revoke all on the instance; disabling the module revokes all. |

**Scopes** (scope only narrows; role/board role always decides):

| Scope | Allows |
|---|---|
| `read` | context, announcements, votings, documents |
| `finance:read` | accounting reads (still needs treasurer/chairman/admin, or own unit) |
| `finance:write` | accounting pending actions (still needs treasurer, or chairman for závierka) |
| `governance:write` | announcement + voting drafts (pending actions) |
| `vote` | `request_ballot_confirmation` |

`scopes_supported` advertises `read` only; the rest are requested by step-up.

### 3. Principal & lib extraction (prerequisite)

`type Principal = { userId; role /* users.role, read live */; status; entityId; boardRoles: BoardRole[]; scopes: Scope[]; clientId }`

- Built per request from the token. `role` is the flat `users.role` (what
  `hasPermission` uses), **not** `getUserPrimaryRole` (that returns `owner` for a
  user with no memberships). `status !== "active"` → 403 for every tool.
- `entityId` = `getCommunityRoot().id` in v1 (one community per instance). Every
  tool takes no `community_id`; `whoami` returns the community so the model can say
  where it is. Multi-root is a follow-up.
- New assert helpers on top of the existing pure checks
  (`canReadAccounting` / `canWriteAccounting` / `canApproveAccounting` in
  `modules/accounting/src/lib/authz.ts:36-67`, `canReadUnitLedger` in
  `karta-bytu.ts:52`): `assertReader(p)`, `assertWriter(p)`, `assertApprover(p)`,
  `assertBoard(p)` — throw `McpError(code)`, never `NextResponse`.
- `isModuleEnabled("accounting" | "voting")` checked inside each tool (routes do it
  via `withModuleEnabled`; tools bypass routes).
- **Extract into lib** (route handlers then call the same function — one code path):
  - visible-posts query + `createPost` incl. push + `dispatchHook` (`src/app/api/posts/route.ts:18-134`)
  - votings list / detail / `createVoting` forcing `status: "draft"` (`modules/voting/src/routes/api/votings/index.ts:14-166`, `id.ts:18-68`)
  - voting results — merge the two copies (`routes/api/ballots/index.ts:50-303` and `modules/voting/src/results.ts:40`) into `getVotingResults(votingId)`
  - ballot cast split into `validateBallotCast(principal, votingId, unitId, items)` and `persistConfirmedBallot(…)` (`routes/api/ballots/index.ts:306-519`)
  - debtor-list authz (`routes/api/debtors.ts:12-40`), karta/meters `baseCtx()` (`karta-bytu.ts:36-50`, `meters.ts:18-32`)
  - shared `validateExpenseInput` (duplicated in `routes/api/expenses.ts:59-110` and `expense-inbox.ts:97-141`)
  - `extractPdfText` moves from `modules/accounting/src/lib/pdf-text.server.ts` to `src/lib/` (core must not import the accounting module)
- `postAllDueMonths` side effect: accounting read tools call it exactly like the UI
  routes do (dashboard, karta), so AI and UI never show different balances.

### 4. Tools (round 1)

Conventions: names `snake_case`; descriptions in English with a complete first line
(≤200 chars); every result has a short Slovak/English/Czech-neutral **text summary
in `content`** + `structuredContent`; lists paginated (`cursor`, max 50); money in
cents + formatted string; **positive balance = debt** (domain convention). Text
pulled from posts/documents/invoices is wrapped and described as *data, not
instructions*. Errors return stable codes (§7).

Roles: **R** = reader (treasurer, chairman, admin) · **W** = writer (treasurer,
admin) · **A** = approver (chairman, admin) · **B** = board (chairman, admin;
decided — see Notes) · **O** = unit owner (own units).

#### Read tools

| # | Tool | Who | Reuses |
|---|---|---|---|
| 1 | `whoami` — user, flat role, board roles, community (name, country, governance), own units, enabled modules, granted scopes | all | `legacy-compat.ts:55,126`, inline board/modules queries → extract |
| 2 | `get_community_info` — address, entrances, active board, IČO, IBAN | all | `/api/building`, board-members (filter `isActive`, no emails) |
| 3 | `get_board_overview` — "what needs me today": dashboard `attention` (unmatched lines, inbox count, overdue expenses, vyúčtovanie deadline, revisions), debtors total, active votings + turnout, drafts | R | `getDashboardTiles` `dashboard.ts:98` + votings + participation |
| 4 | `list_announcements` / 5 `get_announcement` | all | extracted visible-posts query (fixes `/api/posts/[id]` missing visibility check for MCP) |
| 6 | `list_votings` (status filter; drafts only for B) | all | extracted |
| 7 | `get_voting` — items, per-item quorum, financial effects; impacts only if R | all | extracted + `getVotingImpacts` `voting-pipeline.ts:304` |
| 8 | `get_voting_results` — **per-item tallies only, no voter names** | `viewVotingResults` | `getVotingResults` (new, merged) |
| 9 | `get_voting_participation` — units/owners who have not voted, share weight | B | new query |
| 10 | `get_accounting_dashboard` — pokladnica, banka, FPÚO, nedoplatky | R | `getDashboardTiles` |
| 11 | `list_debtors` — full list with names for R; owners keep the disclosure rule | R, O | `getDebtorList` `debtors.ts:91`, `discloseDebtorName` |
| 12 | `get_unit_ledger` — karta bytu, balance, predpis, payments | R, O(own) | `getUnitLedger` `karta-bytu.ts:171` |
| 13 | `get_overdue_summary` — overdue + lawful interest for a unit (data for an upomienka; PDF stays in app, tool returns deep link) | W | `getOverdueForUnit` / `getUpomienkaPdfData` `overdue.ts:81,142` (SK only) |
| 14 | `get_fund_projection` — FPÚO + služby cash-flow | R | `getCashflowProjection` `projection.ts:71` |
| 15 | `list_upcoming_deadlines` — revisions + vyúčtovanie deadline | R | `listRevisions`, `vyuctovanieDeadline` |
| 16 | `list_unmatched_payments` — bank lines + match suggestions | W | `listUnmatchedBankLines` `bank-import.ts:488` |
| 17 | `list_expense_inbox` — pending scans with OCR hints | W | `listInbox` `expense-inbox.ts:106` |
| 18 | `list_expenses` — filter period/okruh/supplier | R | expenses lib |
| 19 | `get_vyuctovanie_preview` (year) | R | `getVyuctovaniePreview` `vyuctovanie.ts:288` |
| 20 | `get_zavierka_status` (year) | R | `getZavierkaStatus` `zavierka.ts:32` |
| 21 | `search_documents` (type, name contains, year) | all, per-doc visibility | `listVisibleDocuments` + new name filter |
| 22 | `get_document_text` — text-layer PDFs only, truncated, logs access | all, per-doc visibility | `getViewableDocument` + `extractPdfText` + `logDocumentAccess` |
| 32 | `list_units` — every unit (entrance/block, floor, area, share) with owners (owner share, account status); contacts only for admin; totals + share-sum checks; for admin per owner `linkable` (shell merge accepts it) + `accountMatch` (inbox name suggestion pointing at it) | admin (`manageUsers`) or B | `loadUnitRoster` (statuses + matches via `loadOwnersBoard`) |
| 35 | `list_pending_registrations` — the owners inbox: pending self-registrations (name, e-mail, phone, registered at, e-mail verified, linked units) + suggested owner record (id, name, units, `name_similarity` score) | admin (`manageUsers`) | `loadOwnersBoard().inbox` (same population + `rankCandidates` suggestion as the web inbox) |

#### Write tools (all go through §5 — the model only *proposes*)

| # | Tool | Who | Commits via |
|---|---|---|---|
| 23 | `match_payment` (paymentId, unitId) | W | `confirmBankLineMatch` `bank-import.ts:559` |
| 24 | `record_payment` (unit, amount, date, bank/cash) | W | `createManualPayment` `payments.ts:203` |
| 25 | `post_expense_from_inbox` (inbox id + supplier/amount/VAT/okruh fields) | W | `postInboxItemAsExpense` `expense-inbox.ts:200` |
| 26 | `dismiss_inbox_item` | W | `dismissInboxItem` `expense-inbox.ts:139` |
| 27 | `submit_meter_reading` | W, O(own) | `createReading` `meters.ts:73` |
| 28 | `approve_zavierka` (year, votingItemId) | A | `approveZavierka` `zavierka.ts:76` |
| 29 | `create_announcement` (title, content, category, pinned, entrance) | B (+caretaker) | extracted `createPost` (push to all) |
| 30 | `draft_voting` (title, type, dates, items w/ quorum + financial effect) | B | extracted `createVoting`, `status` forced `draft`; result links to the voting in the app — **activation stays UI-only** |
| 31 | `request_ballot_confirmation` (voting, unit, item choices) | O, scope `vote` | §6 |
| 33 | `import_owners` (structure, rows in the import column schema; community columns from the current root) | admin (`manageSettings`), scope `governance:write` | `validateImport` + `seedImport` append mode; units that already exist **with** owners are dropped with their rows (the seeder alone would add duplicate owner records) |
| 34 | `assign_unit_owner` (unitId, userId \| newOwner, share) | admin (`manageUsers`), scope `governance:write` | `addUnitOwner` (existing person) / `createShellOwner` (new, no login) |
| 36 | `approve_registration` (registrationId, linkToOwnerId?) | admin (`manageUsers`), scope `governance:write` | plain = inbox "Schváliť": `approvePendingRegistration` {flatId null, role owner} (extracted from `POST /api/registrations/[id]/approve`); with linkToOwnerId = inbox "Spojiť": `mergeShellIntoUser` then approve. No e-mail to the person |
| 37 | `reject_registration` (registrationId) — web flow takes no reason | admin (`manageUsers`), scope `governance:write` | `rejectPendingRegistration` (extracted from `POST /api/registrations/[id]/reject`). No e-mail |
| 38 | `link_owner_account` (ownerId = shell without login/e-mail, accountUserId = active or pending account in the community) | admin (`manageUsers`), scope `governance:write` | `mergeShellIntoUser` (ShellMergeDialog); pending account also approved like `mergeAndApprove` |

**Never via MCP:** activate/close a voting, cast a ballot directly, paper ballots,
mandates, any void, publish vyúčtovanie / predpis, opening balance, bank import,
Fio, settings, modules, roles, exports, API keys, deleting anything.

### 5. Confirmation framework (MCP Apps)

Uses the MCP Apps extension (`io.modelcontextprotocol/ui`, SEP-1865) and the TS
helpers `registerAppTool` / `registerAppResource` from
`@modelcontextprotocol/ext-apps`.

Flow for every write tool:

1. Model calls e.g. `match_payment`. Handler runs **all** authz + validation, builds
   a human preview (before → after, amounts, unit, consequences e.g. "push to all
   residents"), and inserts a `mcp_pending_actions` row: `{id, userId, clientId,
   kind, payload, previewHash, tokenHash, expiresAt (10 min), status: pending}`.
2. Result: text summary ("Čaká na tvoje potvrdenie") + `_meta.ui.resourceUri =
   "ui://resiapp/confirm"`; the view gets `{actionId, confirmToken, preview,
   locale}`. Nothing is written yet.
3. View shows the preview with **Potvrdiť / Zrušiť** (big buttons, both states
   explicit). Click → `app.callServerTool("confirm_action" | "cancel_action")`.
4. `confirm_action` / `cancel_action` are registered with
   `_meta.ui.visibility: ["app"]` — hosts must hide them from the model and reject
   model calls. Server **also** requires the single-use `confirmToken`
   (`UPDATE … SET status='confirmed' WHERE id=$1 AND token_hash=$2 AND
   status='pending' AND expires_at>now() RETURNING` — atomic, replay-safe), same
   `userId`, then **re-runs authz + validation** (state may have changed) and
   commits through the lib function. Result goes back into the view and, via
   `ui/update-model-context`, to the model.
5. **Fallback** (host without MCP Apps, or app tools disabled): the text result
   contains a deep link `/<locale>/mcp/confirm/<actionId>`; that page requires a
   NextAuth session of the **same user** and shows the same preview + buttons. No
   model-visible confirm path exists anywhere.

View: one bundled single-file HTML (`ui://resiapp/confirm`), no external domains
(`_meta.ui.csp` empty → `connect-src 'none'`), all data via `callServerTool`,
i18n sk/en/cs from the locale in the payload, follows Claude style variables,
works at phone width. `_meta.ui.domain` for Claude = first 32 hex of
SHA-256(instance MCP URL) + `.claudemcpcontent.com`, computed at runtime per
instance. Tool definitions are constant (no per-call text) so "Always allow" on
read tools stays stable.

Undo/delete path: pending actions expire or are cancelled (row kept,
`status=cancelled|expired`). Committed writes are undone only in the app UI with
the existing void flows (payments, readings, expenses) — never via MCP.

### 6. Ballot confirmation (`request_ballot_confirmation`)

Today `POST /api/ballots` writes a final ballot on session alone — the domain rule
(`docs/domain/voting.md:30-33`) is not implemented. The MCP path must not inherit
that gap.

1. Tool: `validateBallotCast(principal, …)` (voting active, electronic allowed via
   `isElectronicVotingBlocked`, owner of unit, unit in scope, valid items/choices),
   compute `ballotHash` (`engine/index.ts:422`), show the ballot in the confirm view
   (§5) — the model's proposed choices are visible to the owner item by item.
2. View button **"Poslať potvrdzovací email"** (app-only tool) → insert
   `mod_voting_pending_ballots {votingId, unitId, ownerId, items, ballotHash,
   tokenHash, expiresAt (30 min), usedAt, source: 'mcp', clientId}`; any older
   pending row for the same (voting, unit, owner) is invalidated (no-resend rule,
   `voting.md:107`). Send email (new i18n `Email.ballotConfirm.*`, pattern of
   `sendQrRegistrationVerify` `email.ts:357`) listing every item + choice + short
   `ballotHash`.
3. Email link → `GET /[locale]/voting/confirm/<token>`: shows the ballot again,
   requires login as the same owner, button "Potvrdzujem hlas" → `POST` consumes the
   token atomically and calls `persistConfirmedBallot` with
   `confirmationKind='email'`. Only this route writes `mod_voting_ballots` for MCP.
   Rate-limited (`checkRateLimit`, 20/h).
4. Pending ballots are a **separate table** so no results/participation/external
   query can count them.
5. Owner can cancel a pending ballot from the confirm page or the view; expired
   rows stay for audit.

Legal: the email body and confirm page are statutory content (§14a zák. 182/1993,
§1206 NOZ) → **legal-copy sign-off before release** (see AC).

### 7. Errors, i18n, audit, limits

- Tools return `isError: true` + stable codes: `forbidden`, `scope_required`,
  `module_disabled`, `not_found`, `validation.<field>`, `conflict.state_changed`,
  `action_expired`, `voting_not_active`, `electronic_blocked`, … Lib errors
  (Slovak strings in core/voting routes, `"accounting: …"` English in accounting
  libs) are mapped to codes in `src/lib/mcp/errors.ts`; never surface raw.
  All UI strings (consent page, confirm view, fallback page, email, Profile list)
  in `sk.json`, `en.json`, `cs.json`.
- `mcp_audit_log`: every call `{userId, clientId, tool, argsRedacted, resultCode,
  durationMs, pendingActionId?}`; retention 90 d like `externalApiLogs`.
  Accounting writes additionally keep their `mod_accounting_audit_log` row with
  `actorId = principal.userId` and justification `"MCP: <client name>"`.
- Rate limits: per token 60 calls/min, 10 pending actions/10 min, 3 ballot emails/
  voting/hour; rate-limit **before** token hash lookup (pattern of
  `external-auth.ts:26-107`).
- Output caps: lists ≤50/page, `get_document_text` ≤ 40k chars with a `truncated`
  flag; no tool returns whole journals or all owners' personal data.

### 8. Schema additions (via `pnpm db:generate`, every FK with `onDelete`)

| Table | Notes |
|---|---|
| `oauth_clients` | CIMD cache or DCR row: `clientId` (URL or random), name, logo, `redirectUris`, `source: cimd\|dcr`, `fetchedAt` |
| `oauth_authorization_codes` | `codeHash`, client, user (cascade), `codeChallenge`, `redirectUri`, `resource`, scopes, `expiresAt` (60 s), `usedAt` |
| `oauth_tokens` | `accessHash`, `refreshHash`, `familyId`, client, user (cascade), scopes, `resource`, expiries, `revokedAt`, `lastUsedAt` |
| `mcp_pending_actions` | §5; user cascade |
| `mcp_audit_log` | §7; user `set null` |
| `mod_voting_pending_ballots` | §6; voting/unit/owner cascade |

No runtime DDL; migrations run in `docker-entrypoint.sh` as usual.

## Acceptance Criteria

Auth & module
- [ ] With the `mcp` module disabled, `/api/mcp` and both `/.well-known/*` return 404 and no grant can be created; disabling it revokes all tokens.
- [ ] Claude (web) adds the instance as a custom connector via CIMD, and a DCR-only client also connects; both get PKCE-S256 tokens bound to `<origin>/api/mcp`.
- [ ] A token with another `aud`, an expired token, or a revoked family gets 401 with `WWW-Authenticate … resource_metadata=`; a reused refresh token revokes its whole family.
- [ ] The authorization response carries `iss`; `plain` PKCE and missing `resource` are rejected.
- [ ] A pending/rejected user cannot complete consent; an active owner without board role sees `finance:write` / `governance:write` tools fail with `forbidden` even if the scope was granted.
- [ ] Calling a tool without its scope returns 403 `insufficient_scope` listing every missing scope at once.
- [ ] Profile → Connected AI apps lists each grant (client, scopes, last used) and revoke makes the next call 401.

Tools
- [ ] `tools/list` for each persona returns **exactly** the tools in §4 that the persona may use (≤31 model-visible; app-only `confirm_action`/`cancel_action` never in the model list) — test asserts the full name set, not presence only.
- [ ] Each read tool returns the same numbers as the corresponding UI page for the same user (dashboard, karta, debtors, projection, vyúčtovanie preview).
- [ ] Treasurer and chairman who are not owners get the full debtor list; an owner still gets only the disclosure-threshold view; a tenant gets `forbidden`.
- [ ] `get_voting_results` contains no voter names or ballot hashes for any role.
- [ ] `get_document_text` returns `not_found` for a document the user cannot see (same as missing) and writes a `document_access_log` row on success.
- [ ] Accounting tools return `module_disabled` when accounting is off; voting tools likewise.

Confirmation
- [ ] No write tool changes any business table before confirmation — verified by row counts around a propose call.
- [ ] `confirm_action`/`cancel_action` carry `visibility: ["app"]` and are absent from the model tool list in Claude; a direct `tools/call` without a valid single-use token is rejected.
- [ ] A token is single-use: a second confirm returns `action_expired`; a confirm after 10 min returns `action_expired`; confirm by a different user returns `forbidden`.
- [ ] If state changed between propose and confirm (payment already matched, inbox item handled, voting no longer draft), confirm returns `conflict.state_changed` and writes nothing.
- [ ] On a host without MCP Apps the result contains the `/mcp/confirm/<id>` link; the page requires the same user's session and commits identically.
- [ ] `create_announcement` confirm triggers the same push + `onPostCreate` hook as the UI; `draft_voting` can only produce `status=draft`.
- [ ] A chairman without flat `admin` role can create an announcement and a draft voting in both the UI and MCP; an owner without board role cannot.
- [ ] A treasurer/chairman who owns no unit gets the full debtor list with names (UI and MCP).
- [ ] `approve_zavierka` is refused for the treasurer (separation of duties) and allowed for the chairman.

Ballot
- [ ] `request_ballot_confirmation` never writes `mod_voting_ballots`; only the email-link confirm route does, with `confirmationKind='email'`.
- [ ] The email lists every item + choice + short ballot hash; the confirm page shows the same; the stored ballot hash equals the emailed one.
- [ ] A new request invalidates the previous pending ballot for the same (voting, unit, owner); an expired link cannot be resent — the owner starts over.
- [ ] Pending ballots never appear in results, participation, turnout, external API or audit bundle.
- [ ] Meeting votings and (SK) owners-quarter votings return `electronic_blocked`.
- [ ] **Legal-copy sign-off** on the ballot email + confirm page (SK + CZ) is recorded before release; plumbing-green is not sufficient.

Cross-cutting
- [ ] Every tool call writes one `mcp_audit_log` row; accounting writes also write `mod_accounting_audit_log` with the real user as actor.
- [ ] All new user-facing strings exist in `sk.json`, `en.json`, `cs.json`; no raw lib error string reaches a tool result.
- [ ] Confirm view renders at 360 px width in light and dark, no external network requests.

## Project Context

- **Existing integration:** API keys (`src/lib/api-keys.ts`, `external-auth.ts`) — no user identity; keep for system integrations, do not reuse for MCP. Mirror its rate-limit-before-verify + log-every-outcome shape.
- **Three authz models** the Principal must carry: flat `users.role` → `hasPermission` (`src/lib/permissions.ts`); `board_members` role → accounting (`modules/accounting/src/lib/authz.ts`); memberships/paths → visibility (`src/lib/permissions-entity.ts`, `documents.ts:115`).
- **Single-root coupling:** `getCommunityRoot()` (`src/lib/legacy-compat.ts:55`) returns the oldest root with no user argument; documents alone use the cookie-based `resolveCurrentEntityId`.
- **Accounting reads write:** dashboard/karta call `postAllDueMonths` (`fee-schedule-publish.ts:265`).
- **Push:** `sendPushToAll` (`src/lib/push.ts:56`) is not entity-scoped — entrance posts notify everyone (pre-existing).

## Notes

### Decided (Filip, 2026-11-17)
1. **Chairman powers — yes.** Tools 29–30 use `assertBoard` = admin OR active chairman (+ caretaker for announcements). The same check replaces `hasPermission(…,"createPost"|"createVoting")` in the UI routes (`src/app/api/posts/route.ts`, `modules/voting/src/routes/api/votings/index.ts`) in this spec, so AI and UI agree. AC: a chairman without flat `admin` can create an announcement and a draft voting in both UI and MCP.
2. **Debtor list for board — yes.** Readers (treasurer, chairman, admin) get the full list with names regardless of unit ownership; owners keep the disclosure-threshold rule. Fix lives in the extracted debtor authz used by both route and tool.
3. **Ballot confirm page requires login — yes.** The token binds the ballot, the session binds the person; both must match the same owner.
4. **Expiry windows — yes.** Pending action 10 min, ballot email link 30 min.

### Still open
- **ChatGPT:** verify its MCP Apps support for `visibility: ["app"]` before claiming parity; the fallback page covers it either way.

### Found gaps (outside this spec, file separately)
- Web ballot cast has **no confirmation step** (`routes/api/ballots/index.ts:306-519` writes final on session); `sendVoteConfirmation` is dead code; `ballots.signature` never written. Conflicts with `docs/domain/voting.md:30-33`. Legal priority — needs its own spec reusing §6.
- `GET /api/posts/[id]` and `GET /api/votings/[id]` skip the visibility check (any session reads any id).
- `list_votings` route returns drafts to owners.
- `normalizeItems` silently falls back to `simple_all` on an invalid `quorumType` (`items.ts:88-90`); `POST /api/votings` honours a client-sent `status:'active'`.
- `board-members` GET exposes member emails to every session and ignores `isActive`.
- `hasBoardRole` ignores `termEndsAt`.

### Deferred
- Community tools for owners/tenants (burza, pomoc, RSVP, directory) and owner finance (own karta, settlement, FPÚO inspect) — round 2.
- `create_expense` with file upload; upomienka PDF generated server-side.
- MCP prompts ("Mesačná kontrola pokladníka", "Príprava schôdze") and resources (stanovy, domový poriadok).
- Multi-root principal (`community_id` argument).
- Passkey ballot confirmation once RES-20260428-003 ships (opened in a new tab on the instance origin via `ui/open-link`, not in the sandbox).

### References
- MCP authorization 2026-07-28 — https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- MCP Apps (SEP-1865) — https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- Claude MCP Apps / app tools — https://claude.com/docs/connectors/building/mcp-apps/app-tools.md
