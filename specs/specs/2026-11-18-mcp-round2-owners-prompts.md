---
spec_id: BYT-20261118-012
title: "MCP round 2 — owner & tenant tools, community, prompts, governing-document resources"
status: spec
created: 2026-11-18
updated: 2026-11-18
author: byt-app
owner: filipvnencak
last_verified: 2026-11-18
project_type: other
depends_on:
  - BYT-20261117-001   # specs/implemented/2026-11-17-mcp-server-oauth-apps.md (MCP server, OAuth, confirmation framework)
  - BYT-20261117-002   # Moje platby read model + merged feed (owner-payments.ts, feed.server.ts)
  - BYT-20261118-001   # owners' meeting RSVP (voting module attendance.ts)
  - BYT-20260512-002   # accounting module (karta, vyúčtovanie, right to inspect)
  - BYT-20260512-006   # document library (types + visibility)
related_handoffs: []
tags:
  - mcp
  - owners
  - community
  - prompts
  - resources
feature_branch: "feat/mcp-round2-owners"
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Round 1 (BYT-20261117-001) made the MCP server useful for the board. Round 2 makes it
useful for **every resident**: an owner asks "koľko dlžím a kam to mám poslať?", "čo mi
vyšlo vo vyúčtovaní?", "na čo išiel fond opráv?"; a tenant asks "kto v dome predáva
bicykel?" or "prihlás ma na grilovačku". Plus **prompts** (ready-made routines for the
treasurer, the chairman and owners) and **resources** (stanovy, domový poriadok).

Same rules as round 1: reads reuse the web's lib functions and access rules (no parallel
permission logic), every write is a proposal the human confirms, all user-written text is
data, not instructions.

### Problem statement

- Owners and tenants get almost nothing from the connector: round 1 gives owners
  `get_unit_ledger` (raw postings), `list_debtors` (disclosure view), `submit_meter_reading`
  and the ballot request. No "how much do I pay, to which IBAN, with which VS", no
  settlement, no right to inspect, nothing for tenants.
- The round-1 Notes → Deferred list: owner/tenant community tools, owner finance, prompts
  ("Mesačná kontrola pokladníka", "Príprava schôdze"), resources (stanovy, domový poriadok).
- Community writes (`/api/community/*`) are inline in route handlers — an MCP tool could
  only copy them (parallel logic). They must move to a lib first.

## Scope

**In scope**
- 4 owner finance read tools, 3 community read tools, 7 community write actions (§3–§5).
- New scope `community:write` (§2).
- 3 prompts (§6), governing-document resources (§7).
- Lib extraction so web routes and MCP share one code path (§8).
- Housekeeping: round-1 spec moved to `specs/implemented/`.

**Out of scope**
- **Web ballot confirmation** (branch `feat/web-ballot-confirmation`) and voting-draft
  visibility (other branch). The per-unit / community / directory / inspect leaks found
  while writing this spec ARE fixed here (Notes → Leak fixes); the rest is listed under
  Remaining gaps.
- Responding to a neighbours' post (`community_responses`) via MCP — see Decisions 3.
- Photos / document attachments on community posts via MCP.
- Fault reports (`modules/faults`, BYT-20261118-004, in progress) and utility outages
  (BYT-20261118-008) — separate specs, own MCP round when they ship.
- Meter self-reading rounds (`getOwnerReadingsView`, BYT-20261118-006) — round-1
  `submit_meter_reading` stays the only meter write.
- CZ vyúčtování template (accounting Phase 6) — `get_my_settlement` answers
  `not_found {reason: country_not_supported}` on CZ until it ships.
- Multi-root principal (`community_id` argument).

## Approach

### 1. What exists on main (verified 2026-11-18)

| Area | Web surface | Lib already shared? |
|---|---|---|
| Moje platby (balance, predpis + IBAN/VS/PAY by square, overdue, settlement years) | `/moje-platby` page | `getOwnerPaymentSummary`, `listOwnershipWindows`, `syncDuePostings` (`modules/accounting/src/lib/owner-payments.ts`) — access resolution was inline in the page |
| Vyúčtovanie per unit | `GET /api/accounting/karta/[unitId]/vyuctovanie-pdf` | `getVyuctovaniePdfData`, `listSettlementYearsForUnit` (`vyuctovanie.ts`, SK only) |
| Meter history | `GET /api/accounting/meters?unitId=` | `listReadingsForUnit`, `canEnterReading` (`meters.ts`) |
| Right to inspect (§ 11 ods. 6 zák. 182/1993) | `/accounting/inspect` → `GET /api/accounting/inspect` | `listInspectExpenses` (`attachments.ts`); the access check `isDomMember` was private in the route |
| Burza / pomoc / udalosti | merged feed `/board?typ=predaj|pomoc|udalosti` (the `/komunita/*` pages redirect there) | `loadFeed` (`src/lib/feed.server.ts`) — visibility rule; writes inline in `/api/community/posts*` |
| Event RSVP | `POST/DELETE /api/community/posts/[id]/rsvp` | owners' meetings: `setMeetingRsvp` (voting module); social events inline |
| Adresár | `/komunita/adresar` → `/api/community/directory` | inline |
| Document types | `document_type` enum: `statutes`, `house_rules`, `minutes`, … | `listVisibleDocuments`, `getViewableDocument`, `logDocumentAccess` |

Debtor disclosure (SK 500 € name rule) is already served by round-1 `list_debtors` via
`getDebtorListForPrincipal` — unchanged.

### 2. Scope `community:write`

New OAuth scope `community:write` ("propose your posts to neighbours, event answers and
your directory entry — you confirm each one"), added to `MCP_SCOPES`, so it is advertised
and granted by default like the others (`oauth/scopes.ts`). Consent screen + Profile →
Connected AI apps get the label in sk/en/cs. **Existing grants do not carry it**: the first
community write returns 403 `insufficient_scope`; the user revokes and reconnects (Claude
does not re-authorize by itself — see round-1 `scopes.ts` comment). Reads need only `read`
(community) or `read finance:read` (owner finance).

### 3. Owner finance read tools (`src/lib/mcp/tools/owner-finance.ts`, module `accounting`)

One access rule for all four, shared with the Moje platby page:
**`resolveOwnerUnit(userId, role, rootId, requestedUnitId?)`** (new, `owner-payments.ts`):
a unit the user owns or owned → that unit limited to the user's **ownership windows**
(a buyer never sees the seller's months, a seller keeps their own); any other unit → only
whole-dom readers (`canReadUnitLedger`: admin / treasurer / chairman), full history;
nothing requested → the user's first own unit. The page now calls the same function.

| Tool | Who | Returns | Reuses |
|---|---|---|---|
| `get_my_payments` (unitId?, includeLedger?, cursor, limit) | owner of a unit, or reader | balance (+ `balanceState` debt/overpaid/settled), preplatok, overdue months + open total, last 3 payments, payment instruction (amount, IBAN, VS, period, PAY by square / SPAYD payload — current owner only), settlement years + latest difference, own units list; postings only with `includeLedger` (window-filtered, newest first, ≤50/page) | `resolveOwnerUnit`, `syncDuePostings` (lock-timeout safe, failure = read without fresh postings, as the page), `getOwnerPaymentSummary`, `getUnitLedger` + `ledgerRowsInWindows` |
| `get_my_settlement` (unitId?, year?) | owner, reader | published vyúčtovanie of the unit: per-service prescribed / advances / cost share / difference, totals, IBAN, PAY by square for a doplatok; default latest visible year; years outside the owner's windows → `not_found` | `resolveOwnerUnit`, `listSettlementYearsForUnit` + `yearInWindows`, `getVyuctovaniePdfData` |
| `list_meter_readings` (unitId?, meterType?, cursor, limit) | owner, reader | readings newest first (type, date, value) — no `createdById` | `resolveOwnerUnit` + `canEnterReading` (same check as `GET /api/accounting/meters`), `listReadingsForUnit` |
| `inspect_expenses` (okruh?, year?, supplierContains?, cursor, limit) | admin, treasurer / chairman (term in force) or an owner today | every non-voided expense: supplier (untrusted), invoice, date, category, okruh (`fpuo` = repair fund), amount; per-okruh totals; scan link only where `attachment_visibility` allows (`board_only` / `no_scan` otherwise) | `canInspectExpenses` (moved from the route), `listInspectExpenses` |

`get_unit_ledger` (round 1) and the web karta API use the same windowed scope
(Notes → Leak fixes 1); `get_my_payments` is the owner-facing summary tool. Money: cents + formatted, positive = debt.

### 4. Community read tools (`src/lib/mcp/tools/community.ts`, no module gate)

Visibility = the board feed's rule (`viewCommunity` + entrance overlap unless
`community_cross_entrance_visible`), via `loadFeed` / the new `getVisibleCommunityPost`
(same file, same `communityVisibility` + `enrich`).

| Tool | Who | Returns | Reuses |
|---|---|---|---|
| `list_community_posts` (section `marketplace`\|`help`\|`events`, cursor) | `viewCommunity` (admin, owner, tenant) | 20 active posts/page (max 10 pages): type, title + 280-char excerpt (untrusted), author name, entrance, dates, RSVP counts + own answer for events, response count, `mine`, deep link `/board?prispevok=c-<id>` | `loadFeed` with filter `predaj` / `pomoc` / `udalosti` |
| `get_community_post` (id, cursor, limit) | `viewCommunity` | full text, responses (author name + text, untrusted, paginated), `canManage`, `meetingVotingId` for owners' meetings; missing = not visible = `not_found` | `getVisibleCommunityPost`, `listCommunityResponses`, `loadMeetingVotingByPost` |
| `list_directory` (contains?, cursor, limit) | `viewDirectory` | opt-in entries: name, flat, entrance, phone / e-mail **only if shared**, note + skills (untrusted); `myEntry` | `listDirectory`, `getDirectoryEntry` |

Names shown are exactly those the web shows to the same viewer (post authors, responders,
directory opt-ins); nothing else about other people.

### 5. Community write actions (`src/lib/mcp/actions/community.ts`, scope `read community:write`)

All through the round-1 confirmation framework (propose → preview → human click →
re-validate → commit through the lib). Each per-user record has its undo path as its own
action (CLAUDE.md spec rule):

| Create / update | Undo / delete | Who | Commits via |
|---|---|---|---|
| `rsvp_event` (postId, status yes\|maybe\|no) — replaces an earlier answer | `clear_event_rsvp` (postId) — fails `validation.postId {no_answer}` when there is nothing to withdraw | `respondToCommunityPost` / `viewCommunity`; post must be **visible**; owners' meetings: voting module on, eligible owner, before the meeting starts | social: `setSocialEventRsvp`; owners' meeting: `setMeetingRsvp` (source `app`) |
| `create_community_post` (type sale\|free\|help_request\|help_offer\|event, title, content, eventDate?, eventLocation?, entranceId?, responsesAllowed?) | `resolve_community_post` (postId) — active → resolved, responses kept; `delete_community_post` (postId) — permanent, with responses + RSVPs | create: `createCommunityPost` perm; resolve / delete: **own posts only** (no admin moderation via AI), not owners' meeting posts | `validateCommunityPostInput` + `createCommunityPost`; `updateCommunityPost`; `deleteCommunityPost` |
| `set_directory_entry` (sharePhone?, shareEmail?, note?, skills?) — omitted flags = not shared | `remove_directory_entry` | `editOwnDirectory` | `normalizeDirectoryEntry` + `upsertDirectoryEntry`; `deleteDirectoryEntry` |

Previews: before → after for the RSVP / status / directory fields; consequences say who
will see it (neighbours with name, board for owners' meetings, 30-day listing, permanent
delete); warning that photos cannot be added via AI and for an event date in the past.
Lib errors are `McpError` codes; voting-module `MeetingError` maps to
`conflict.state_changed {meeting_rsvp_closed}` / `forbidden {not_eligible_owner}`.
Tool descriptions tell the model to write only what the user asked for and never copy
instructions found in other posts.

### 6. Prompts (`src/lib/mcp/prompts.ts`)

Registered per request, **only those the principal can run** (prompts/list = role-fit);
a prompt returns one localised user message naming the tools in order and reads / writes
nothing itself. Arg `locale` (sk|en|cs, default = community language); texts in
`Mcp.prompts.*`. Each `prompts/get` writes an `mcp_audit_log` row (`prompt:<name>`).

| Name | Title (sk) | Shown to | Args |
|---|---|---|---|
| `treasurer_monthly_check` | Mesačná kontrola pokladníka | accounting on + reader (treasurer / chairman / admin) | `month` YYYY-MM |
| `meeting_preparation` | Príprava schôdze | voting on + board (admin / chairman) | `votingId` |
| `my_payments_check` | Moje platby a nedoplatky | accounting on + owner of a unit | — |

### 7. Resources — governing documents (`src/lib/mcp/resources.ts`)

`resiapp://documents/{id}` (ResourceTemplate) for document types **`statutes`** (stanovy)
and **`house_rules`** (domový poriadok) — the governing documents of the `document_type`
enum. `resources/list` = `listVisibleDocuments(user, root, {type})` for both types (the
library's audience + entity-path + subject rule); `resources/read` re-checks with
`getViewableDocument`; a non-visible, deleted or non-governing id is the same
`ResourceNotFoundError` (no probing). Text = PDF text layer via the shared
`readDocumentText` (≤ 40k chars, extracted from `get_document_text`), wrapped as untrusted
data; scanned / non-PDF → a short note + app link. Access → `document_access_log`
(`logDocumentAccess`) + `mcp_audit_log` (`resource:read_document`, `resource:list_governing`).
Other types (zápisnice, zmluvy, …) stay behind `search_documents` / `get_document_text`.

### 8. Lib extraction (one code path)

- `src/lib/community.server.ts` (new): `validateCommunityPostInput`, `createCommunityPost`
  (now also validates `entranceId` belongs to the community, forces `eventKind = social`),
  `updateCommunityPost`, `deleteCommunityPost`, `canManageCommunityPost`,
  `listCommunityResponses`, `setSocialEventRsvp`, `getMyEventRsvp`, `listDirectory`,
  `getDirectoryEntry`, `normalizeDirectoryEntry`, `upsertDirectoryEntry`,
  `deleteDirectoryEntry`. Routes switched: `POST /api/community/posts`,
  `PATCH/DELETE /api/community/posts/[id]`, social branch of `…/rsvp`,
  `GET/PUT/DELETE /api/community/directory`. These routes now answer `{ error: <code> }`
  (UI only checks `res.ok`). `GET /api/community/posts/[id]` is **not** touched (gap → other branch).
- `src/lib/feed.server.ts`: `getVisibleCommunityPost`.
- `owner-payments.ts`: `resolveOwnerUnit`, `ledgerRowsInWindows`, exported `inWindows` /
  `yearInWindows`; Moje platby page uses `resolveOwnerUnit`.
- `attachments.ts`: `canInspectExpenses` (was `isDomMember` in the route).
- `src/lib/mcp/tools/document-text.ts`: `readDocumentText` (shared by
  `get_document_text` and the resources).

No schema change: `mcp_pending_actions.kind` is varchar, scopes are jsonb. No new DB
objects, no background work, no runtime DDL; every read is a request-time query.

### 9. ChatGPT

Unchanged open item from round 1: verify ChatGPT honours `_meta.ui.visibility: ["app"]`
for `confirm_action` / `cancel_action` before claiming parity. The in-app fallback confirm
page (`/<locale>/mcp/confirm/<id>`) covers every new action either way (hosts without the
UI never get the confirm token).

## Acceptance Criteria

Tools / prompts / resources per persona (accounting + voting modules on, all scopes granted)
- [ ] `tools/list` = round-1 set for the persona **plus exactly**: owner → `get_my_payments`, `get_my_settlement`, `list_meter_readings`, `inspect_expenses`, `list_community_posts`, `get_community_post`, `list_directory`, `rsvp_event`, `clear_event_rsvp`, `create_community_post`, `resolve_community_post`, `delete_community_post`, `set_directory_entry`, `remove_directory_entry`; tenant → the 3 community reads + 7 community writes (no finance tool); treasurer / chairman without a unit → `get_my_payments`, `get_my_settlement`, `list_meter_readings`, `inspect_expenses` (+ community tools when the flat role has `viewCommunity`); caretaker / vote_counter → nothing new. Test asserts the full name set, not presence.
- [ ] `prompts/list`: treasurer → `treasurer_monthly_check` (+ `my_payments_check` if owner); chairman → `treasurer_monthly_check`, `meeting_preparation` (+ `my_payments_check` if owner); owner → `my_payments_check`; tenant → empty. Nothing else.
- [ ] `resources/list` lists exactly the `statutes` + `house_rules` documents the user sees in the web library; reading any other id (other type, other entrance, admin-only, deleted, malformed) returns the same not-found error and writes no `document_access_log` row.

Owner finance
- [ ] `get_my_payments` returns the same balance, overdue, preplatok, payment instruction and settlement years as `/moje-platby` for the same user and unit (incl. a former owner and a buyer mid-year: no row outside the user's ownership window).
- [ ] An owner passing another owner's unitId gets `forbidden`; a treasurer gets that unit with full history.
- [ ] `get_my_settlement` matches the vyúčtovanie PDF data for the year; a year outside the owner's windows → `not_found`; CZ → `not_found {country_not_supported}`.
- [ ] `list_meter_readings` = `GET /api/accounting/meters?unitId=` for the same user; foreign unit → `forbidden`.
- [ ] `inspect_expenses` = `/accounting/inspect` rows; scan links only where the web would allow the download; a tenant / non-owner board member gets `forbidden`.
- [ ] With accounting off all four return `module_disabled`; `my_payments_check` and `treasurer_monthly_check` are not listed.

Community
- [ ] `list_community_posts` / `get_community_post` show exactly what the board feed shows the same viewer (entrance overlap, cross-entrance flag, admin all); a post from another entrance → `not_found`.
- [ ] Directory output never contains a phone / e-mail the person did not share.
- [ ] Every community write changes nothing before the confirm click (row counts around the propose call); confirm re-validates (post deleted / resolved meanwhile → `conflict.state_changed` or `not_found`, nothing written).
- [ ] Undo paths: `rsvp_event` then `clear_event_rsvp` leaves no `event_rsvps` row; `create_community_post` then `delete_community_post` leaves no post, responses, RSVPs or document links; `set_directory_entry` then `remove_directory_entry` leaves no `directory_entries` row; `resolve_community_post` keeps responses.
- [ ] Owners' meeting post: an eligible owner can answer and withdraw before the start; after the start → `conflict.state_changed`; a non-eligible user / tenant → `forbidden`; with voting off → `module_disabled`. Board answers for others stay web-only.
- [ ] `resolve_community_post` / `delete_community_post` on someone else's post → `forbidden`, also for admin.
- [ ] A token without `community:write` gets 403 `insufficient_scope` on the 7 writes; reads still work.
- [ ] Web parity after the extraction: create / resolve / toggle responses / delete / RSVP / directory edit still work in the app (same lib); an invalid `entranceId` is now rejected (400 `validation.entranceId`).

Leak fixes
- [ ] Buyer from mid-year: karta API ledger, balance in the unit list, overdue, settlement years, vyúčtovanie of an earlier year (404), meters readings, home balance card and MCP `get_unit_ledger` show nothing dated before their `valid_from`; running balance starts at 0 at their first posting.
- [ ] Seller after the sale: still opens the unit (own period only), predpis-pdf → 403, cannot submit readings.
- [ ] Treasurer / chairman with a term in force: full history; after `term_ends_at` passes: owner view only (or 403).
- [ ] `GET /api/community/posts/<other-entrance id>`, RSVP and respond on it → 404 for a tenant / owner of another entrance (cross-entrance flag off); admin sees it.
- [ ] Directory hides an opted-in user who is pending / rejected or has no active membership in this community.
- [ ] `GET /api/posts/<other-entrance notice>` → 404 for a non-admin without an overlapping membership.

Cross-cutting
- [ ] Every tool call, prompt get and resource read/list writes one `mcp_audit_log` row.
- [ ] All new strings (scope labels, 7 actions, preview / consequence / warning labels, 3 prompts) exist in `sk.json`, `en.json`, `cs.json`; no raw lib string reaches a result.
- [ ] Every tool returning user-written text marks it untrusted, and its description says so.
- [ ] Lists ≤ 50 per page (feed 20), no tool returns a whole ledger or all owners' personal data.

## Project Context

- Owner read model + ownership windows: `modules/accounting/src/lib/owner-payments.ts` (BYT-20261118-007 windows).
- Feed visibility: `src/lib/feed.server.ts` (copied 1:1 from the old routes, RES-20260501-002).
- Owners' meeting RSVP: `modules/voting/src/attendance.ts` `setMeetingRsvp`, window `workflow/attendance.ts` `meetingRsvpWriteError`.
- Confirmation framework: `src/lib/mcp/actions/service.ts`; registry `ACTION_KINDS` (`actions/types.ts`), write-tool specs `tools/actions.ts`.

## Notes

### Decisions (proposed — confirm, Filip)
1. **New scope `community:write`** rather than reusing `governance:write` (that one means board powers). Cost: existing connections must reconnect once for community writes.
2. **Resolve / delete own posts only** via MCP — admin moderation of others' posts stays in the app (round-1 "never delete via MCP" spirit; deleting your own post is the undo path of creating it).
3. **No `respond_to_community_post`**: a response has no undo path for its author on the web (`DELETE …/respond/[id]` is admin-only `moderateCommunityResponse`), so per the CLAUDE.md spec rule it cannot ship until the web grows "delete own response". Also it sends an e-mail to the author.
4. **Visibility before RSVP**: MCP requires the event to be visible to the user (feed rule) — stricter than the web RSVP route today.
5. `get_unit_ledger` kept unchanged for owners; the ownership-window rule is applied in the new `get_my_payments` (see Found gaps 2).

### Still open
- **ChatGPT:** verify its MCP Apps support for `visibility: ["app"]` before claiming parity; the fallback page covers it either way.
- Spec id: 009 is taken in another worktree; 010–011 left for the parallel branches (`fix/visibility-authz-gaps`, `feat/web-ballot-confirmation`). Renumber if they did not use them.

### Leak fixes (approved by Filip 2026-11-18, same branch)
1. **Seller history.** One per-unit read rule in `karta-bytu.ts`: `getUnitReadScope` (board readers = full history; owners = own ownership windows from `ownership-windows.ts`, current or former, started), `scopeLedger`, `listScopedUnitBalances`, `listAccessibleUnitScopes`; `scopeOverdue` (`overdue.ts`); `listReadingsForViewer` (`meters.ts`). Applied in the karta API (list, ledger + settlement years, overdue, vyúčtovanie year, predpis = current owner only), meters GET, Moje platby, the owner home balance card + settlement row, MCP `get_unit_ledger`, `get_my_payments`, `list_meter_readings`, `submit_meter_reading` preview. `isUnitOwner` (reading writes) now means "owner today". MCP `submit_meter_reading` authorize = `canWriteReadingForUnit` (was the read check — a chairman could propose readings for any unit).
2. **Community visibility.** `GET /api/community/posts/[id]` (post + responses), social RSVP (`setSocialEventRsvp`) and `POST …/respond` refuse a post the viewer cannot see (`canSeeCommunityPost` → `getVisibleCommunityPost`), answered as not found. Owners' meeting RSVP keeps the voting module's eligibility gate.
3. **Directory.** `listDirectory(rootId)`: active users only, members of this community only; flat lookup inside the community.
4. **Inspect.** `canInspectExpenses` = admin OR treasurer / chairman with a board term in force OR owner today.
5. **Board term.** `boardRoleInForce()` (`user-context.ts`) — `listActiveBoardRoles` and accounting `hasBoardRole` now ignore seats whose `term_ends_at` passed.
6. **Notice by id.** `GET /api/posts/[id]` checks `getVisiblePost` (another entrance's notice = 404).

### Remaining gaps (listed, not fixed — not clearly a leak or needs a decision)
- Documents on a unit's entity path are visible to any ACTIVE member of the unit (`canSeeDocPath`), so a buyer sees unit documents uploaded before the purchase. Decide whether unit documents follow ownership windows.
- Reading rounds (`getOwnerReadingsView`): a buyer mid-round may see the seller's submission in the same open round.
- `GET /api/board-members` returns every board seat (also inactive / expired) with e-mails to any session.
- Community photos (`/api/uploads/community-posts/*`) are readable by any signed-in member regardless of entrance (unguessable names).
- `POST /api/community/posts` used to accept any enum `type` incl. `borrow` (still accepted by the lib for web parity; MCP excludes it).

### References
- MCP prompts — https://modelcontextprotocol.io/specification/2026-07-28/server/prompts
- MCP resources — https://modelcontextprotocol.io/specification/2026-07-28/server/resources
- Round 1 — `specs/implemented/2026-11-17-mcp-server-oauth-apps.md`
