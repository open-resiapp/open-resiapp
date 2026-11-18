---
spec_id: BYT-20261118-001
title: "Enable Banking connector — live PSD2 bank feed for any SK/CZ bank (GoCardless replacement)"
status: in_progress
created: 2026-11-18
updated: 2026-11-18
author: byt-app
owner: filipvnencak
last_verified: 2026-11-18
project_type: other
depends_on:
  - BYT-20260512-002   # accounting module (bank import pipeline, Fio connector, reconciliation)
related_handoffs: []
tags:
  - accounting
  - bank
  - psd2
  - integration
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Let a treasurer connect the dom's bank account at **any SK/CZ bank** (Tatra,
SLSP, VÚB, ČSOB, 365.bank, Prima, mBank, Fio, …) once, via the bank's own
login, and then pull owner payments with one click — the same way the Fio
token works today, but for every bank.

### Problem statement

Today live sync exists only for Fio (per-account REST token). Every other bank
means exporting a CAMT.053 XML from internet banking and uploading it. GoCardless
Bank Account Data (ex-Nordigen), the usual free PSD2 aggregator, stopped taking
new customers. Becoming our own PSD2 AISP (NBS licence, PII insurance, eIDAS
QWAC/QSealC, per-bank Berlin Group quirks) is months of regulatory work, not
code. **Enable Banking** (Finland, licensed AISP) is the practical replacement:
one API, SK + CZ coverage, a free *restricted* mode for the app owner's own
accounts, volume-priced production.

## Scope

**In scope (this spec)**
- New bank provider `enable_banking` beside `fio`, using the shared
  `importNormalizedLines()` pipeline (dedupe, VS matching, auto-post,
  reconciliation queue) unchanged.
- App-level credentials: one Enable Banking application per instance.
  Resolution order: env (`ENABLE_BANKING_APP_ID` + `ENABLE_BANKING_PRIVATE_KEY`
  / `_FILE`) → admin-entered row in `mod_accounting_bank_app_credentials`.
  - **Self-host**: the HOA registers its own app in the Enable Banking control
    panel (restricted mode, free), links its own account there, and the admin
    enters app id + private key in Pokročilé → Prepojenie s bankou (2026-11-18
    owner decision: "aby si to človek vedel napísať sám").
  - **Cloud**: open-resiapp-cloud injects our production app's credentials as
    per-instance secrets (`config_service.get_env_vars_for_ecs()`). Cloud-side
    change is a follow-up handoff, not this spec.
- Connect flow: pick bank → redirect to bank login (SCA) → callback → session
  stored → account picked (auto by IBAN, else treasurer chooses).
- Manual "Synchronizovať teraz" (same UX as Fio).
- Consent status in UI: valid-until date, warning ≤ 14 days, "Obnoviť" (renew)
  re-runs the connect flow.
- Disconnect (undo path): revokes the Enable Banking session and deactivates
  the connection; imported payments stay (they are booked money).
- Error **codes** from the connector, mapped to i18n in sk/en/cs.

**Out of scope (follow-ups)**
- Scheduled auto-sync via the existing `CRON_SECRET` cron pattern (one external
  call per instance — never a per-node loop). Phase 2.
- Email reminders before consent expiry. `mod_accounting_notifications_sent`
  dedupes on `(kind, settlement_id, recipient_id)`; a per-connection reminder
  needs a dedupe key decision first. Phase 2.
- More than one bank account per dom (fond opráv on a separate account). The
  ledger has one `221 banka`; multi-account needs an accounting decision.
- Outgoing payments (PIS). Read-only only.
- Cloud handoff (inject credentials, register redirect URL per custom domain).

## Approach

### Enable Banking API (verified 2026-11-18 against docs)
- Auth: RS256 JWT signed with the app private key; header `kid` = app id;
  claims `iss: "enablebanking.com"`, `aud: "api.enablebanking.com"`, `iat`,
  `exp` (≤ 24 h). Signed with `node:crypto` — no new dependency.
- `GET /aspsps?country=SK|CZ` → bank list incl. `maximum_consent_validity`
  (seconds) and `psu_types`.
- `POST /auth` `{ access: { valid_until }, aspsp: { name, country }, state,
  redirect_url, psu_type }` → `{ url }`.
- Callback `GET <redirect_url>?code=…&state=…` (or `error`,
  `error_description`).
- `POST /sessions { code }` → `{ session_id, accounts[], access.valid_until }`.
- `GET /accounts/{uid}/transactions?date_from=…&continuation_key=…` →
  `{ transactions[], continuation_key }`; loop until no key.
- `DELETE /sessions/{id}` revokes.
- Rate limits undocumented (429 everywhere) → manual sync only in this phase,
  `429` maps to `EB_RATE_LIMITED`.

### Data model
- `mod_accounting_bank_provider` enum += `enable_banking`.
- `mod_accounting_payment_source` enum += `enable_banking_api`.
- `mod_accounting_bank_connections` += `config jsonb` (nullable) and
  `valid_until timestamp` (nullable).
  - For `enable_banking`: `token` = Enable Banking `session_id`;
    `config` = `{ aspspName, aspspCountry, accountUid | null,
    accounts: [{ uid, iban, name, currency }] }`.
  - Fio rows unchanged (`config` null).
- `mod_accounting_bank_app_credentials` (migration 0088): `provider`
  (unique), `app_id`, `private_key_enc`, `key_fingerprint`, `updated_by_id`
  (→ users, `set null`), `created_at`, `updated_at`. Instance-level (keyed by
  provider, not dom): the registered redirect URL is the instance origin.
  - `private_key_enc` = AES-256-GCM (`src/lib/secret-box.ts`), key =
    HMAC-SHA256(AUTH_SECRET‖NEXTAUTH_SECRET, "open-housing/secret-box/v1/
    <purpose>"), purpose bound as AAD, format `v1.<iv>.<tag>.<ct>`. No new env
    var; every replica derives the same key. Rotating AUTH_SECRET → row
    unreadable → page shows "zadajte kľúč znova" (`keyUnreadable`), connector
    treats it as not configured.
  - The key is normalized (RSA only, re-exported PKCS#8) and **verified
    against Enable Banking `GET /application` before anything is stored**
    (401/403 → `EB_CREDENTIALS_REJECTED`). The response's `active` and
    `redirect_urls` drive non-blocking warnings (app not yet activated,
    callback URL not registered).
  - Never returned to any client; UI shows masked app id + 16-hex SHA-256
    fingerprint of the public key. Audit log row on save/delete (fingerprint,
    masked id — never the key).
- Every place that lists bank sources (`inArray(payments.source, …)`, TS
  unions, MCP accounting actions, PaymentsList label) gains
  `enable_banking_api` in the same PR as the migration (CLAUDE.md enum rule).

### Mapping (pure, `enable-banking-format.ts`)
- Only `status === "BOOK"` (or missing) lines; pending lines are skipped so a
  pending→booked transition never double-imports.
- `externalTxId` = `eb:{transaction_id ?? entry_reference}`; when both are
  missing, a synthetic `eb:h:{sha-free stable key}` from booking date, amount,
  direction, counterparty IBAN and remittance text.
- Direction from `credit_debit_indicator` (`CRDT`/`DBIT`), fallback to amount
  sign. Amount decimal string → integer cents (no float).
- Counterparty = `debtor` / `debtor_account.iban` on credits, `creditor` on
  debits.
- VS/ŠS/KS via the CAMT parser's `extractSymbols()` (SBA slash notation) over
  `reference_number`, then each `remittance_information` line; fallback
  `VS123` / `VS:123` free-text pattern.
- Currency per line → `assertLedgerCurrency`.
- Errors are codes (`EnableBankingError.code`), never prose.

### Connect flow / security
- `state` = 32 random bytes, stored in an httpOnly, `SameSite=Lax`, 10-min
  cookie together with the UI locale; callback rejects a missing/mismatched
  state (`EB_STATE_MISMATCH`). No pending row in the DB.
- Callback re-checks the treasurer guard (session must still be a writer).
- `redirect_url` = public origin (`NEXTAUTH_URL` → `APP_URL`) +
  `/api/accounting/enable-banking/callback`. Must be registered in the
  Enable Banking app.
- Consent length = `min(ASPSP maximum_consent_validity, 180 days)`.
- psu_type: `business` if the ASPSP lists it, else `personal`.
- Account pick: the account whose IBAN equals `accounting_settings.bank_iban`
  (spaces / case ignored); else the only account — unless its known IBAN
  differs from a configured `bank_iban`; else `accountUid = null` and UI asks.
- IBAN guard (same rule as the camt.053 upload): when `bank_iban` is set and
  the selected account's IBAN is known and differs, account pick and sync
  refuse with `EB_IBAN_MISMATCH`. An account without a reported IBAN cannot
  be checked and is allowed.
- `lastSyncAt` belongs to one account: picking a different account (pick or
  consent renewal landing on another account) resets it → fresh backfill.
- Session id never leaves the server (masked like the Fio token).
- Audit log row on connect, account pick, disconnect.

### Sync
- `from` = `lastSyncAt − 7 days` (overlap). First sync 90 days back, but never
  before the latest `receivedAt` of non-voided payments already imported for
  the dom by another bank channel (camt.053 upload, Fio) — that day itself
  is included. Dedupe is idempotent via `external_tx_id`.
- Cross-source content dedupe (shared pipeline, all bank sources): a line
  with the same dom + booking day + amount cents + VS (+ counterparty IBAN
  when both sides have one) as a non-voided payment from a DIFFERENT bank
  source is inserted UNMATCHED (never auto-posted), `raw_payload.
  possibleDuplicateOf` = the other payment, counted in
  `ImportSummary.possibleDuplicates` (and `needsReview`). The treasurer
  dismisses or confirms it in reconciliation. Not skipped: two identical
  real payments on one day must not vanish silently.
- Page cap (50 pages): when the bank still returns a `continuation_key`,
  `lastSyncAt` is NOT advanced; `config.syncCursor = { dateFrom,
  continuationKey }` is stored and the next sync resumes from it. A failing
  resume clears the cursor (next sync refetches from `lastSyncAt − 7 d`).
  Renewal clears the cursor (keys are session-bound).
- `valid_until` passed → `EB_CONSENT_EXPIRED` without calling the API.
- HTTP 401/403 from Enable Banking on transactions → `EB_CONSENT_EXPIRED`
  (bank revoked); 429 → `EB_RATE_LIMITED`; other → `EB_API_ERROR`.

### API routes (treasurer/admin, `withModuleEnabled("accounting")`)
| Route | Method | Purpose |
|---|---|---|
| `/api/accounting/enable-banking` | GET | state (configured?, connected, bank, IBAN, validUntil, lastSyncAt, accounts if pick needed) |
| `/api/accounting/enable-banking` | DELETE | disconnect |
| `/api/accounting/enable-banking/aspsps` | GET | banks for the dom's country |
| `/api/accounting/enable-banking/connect` | POST | `{ aspspName, locale }` → `{ url }` + state cookie |
| `/api/accounting/enable-banking/callback` | GET | bank redirect target → session → redirect to Platby page with `?eb=connected|<code>` |
| `/api/accounting/enable-banking/account` | POST | `{ accountUid }` pick |
| `/api/accounting/enable-banking/sync` | POST | manual sync → `ImportSummary` |
| `/api/accounting/enable-banking/credentials` | PUT | **admin only** (writer + `manageSettings`): `{ appId, privateKey }` → verify → store encrypted → `{ check: { appActive, redirectRegistered, environment } }` |
| `/api/accounting/enable-banking/credentials` | DELETE | **admin only**: remove stored credentials (undo path); connection row stays |

### UI
**Pokročilé → Prepojenie s bankou** (`/settings/advanced/bank`) — the setup
home. Listed in the Pokročilé hub only while the accounting module is
enabled. Page gate = accounting writer (treasurer / admin), same as the API;
treasurers (no access to the admin-only hub) reach it via the Platby link.
- **Setup guide** (`EnableBankingSetupGuide`), expanded while the instance is
  not configured, collapsible once it is (status badge with masked app id):
  1. create an Enable Banking account (link to control panel),
  2. register a Production application + the exact redirect URL with a copy
     button (error if `NEXTAUTH_URL`/`APP_URL` is missing),
  3. create the key (in-browser in the control panel, or the `openssl`
     command with copy button), never share the private key,
  4. enter the application ID + private key (paste or upload .pem) — "Overiť
     a uložiť" verifies against Enable Banking, then stores encrypted; after
     that only masked id + fingerprint + date with "Zmeniť kľúč" /
     "Odstrániť kľúč" (confirm). Env vars are a collapsed alternative; when
     env is set the step is read-only ("nastavené v prostredí servera"). A
     treasurer sees only status + "ask the admin",
  5. link the HOA account in the control panel (activates restricted mode),
  6. connect the bank on this page.
  Footer: restricted mode is free for own accounts; multi-community operators
  need a paid contract; cloud has it pre-configured.
- **Connection** (`EnableBankingConnection variant="settings"`), only when
  configured: bank picker + connect, account pick, valid-until with warning
  ≤ 14 days / expired, renew, sync, disconnect (confirm dialog). The bank
  callback lands here with `?eb=connected|EB_*` (one-shot notice).

**Platby → "Z banky"** (`variant="compact"`): not connected → one line + link
"Prepojiť banku" to the settings page; connected → bank, IBAN, last sync,
valid-until badge, "Synchronizovať teraz", and a link to settings when the
consent needs renewal or an account must be picked.

## Acceptance Criteria

1. With `ENABLE_BANKING_APP_ID` + `ENABLE_BANKING_PRIVATE_KEY` unset, GET state
   returns `configured: false`; the settings page shows the expanded setup
   guide and no connection card; the Platby card shows only the settings link.
1a. Pokročilé hub lists "Prepojenie s bankou" only while accounting is
   enabled; the page 404s with accounting disabled and redirects non-writers
   to /settings.
1b. The guide shows the exact redirect URL from `NEXTAUTH_URL`/`APP_URL`
   (copyable) or a clear error when neither is set.
1c. Admin saves app id + private key: an invalid PEM / non-RSA key →
   `EB_INVALID_KEY`, malformed id → `EB_INVALID_APP_ID`, pair refused by
   Enable Banking → `EB_CREDENTIALS_REJECTED`; in all three cases nothing is
   stored. On success the DB holds only ciphertext (no `PRIVATE KEY` text in
   `private_key_enc`), the page shows masked id + fingerprint and the
   connection card appears; the key is never returned by any route.
1d. Non-admin writer (treasurer) gets 403 `EB_FORBIDDEN` on PUT/DELETE
   credentials. With `ENABLE_BANKING_APP_ID` set in env, PUT/DELETE return
   `EB_CREDENTIALS_FROM_ENV` and the UI shows the read-only env notice.
1e. Undo: "Odstrániť kľúč" deletes the row (audit logged); state flips to
   `configured: false`, the bank connection row and imported payments stay;
   re-entering the same app's key resumes syncing without reconnecting.
1f. After AUTH_SECRET changes, the page shows `credentialsUnreadable` and the
   form; sync returns `EB_NOT_CONFIGURED` (no crash).
2. Treasurer picks a bank and is redirected to the bank's login; non-writers
   get 403 on every Enable Banking route.
3. Callback with a wrong/missing `state` creates no connection and lands on the
   bank settings page with the `EB_STATE_MISMATCH` message.
4. Successful callback stores the session (masked in API output), the consent
   `valid_until`, the account list, and auto-picks the account matching
   `bank_iban` (or the only one, unless its IBAN differs from `bank_iban`).
5. With several accounts and no IBAN match, the UI asks to pick one; sync is
   refused (`EB_ACCOUNT_NOT_SELECTED`) until then.
6. Sync imports booked credits through `importNormalizedLines` with source
   `enable_banking_api`; re-running the sync imports 0 new rows.
7. Pending (`PDNG`) transactions are never imported.
8. VS from SBA end-to-end notation and from free-text remittance both match.
9. Expired consent → sync refused with `EB_CONSENT_EXPIRED`, UI shows renew.
10. Disconnect revokes the Enable Banking session (best effort), sets
    `is_active = false`, keeps imported payments, writes an audit row; the
    panel returns to the "not connected" state.
11. Enable Banking payments appear everywhere Fio/CAMT payments do
    (dashboard, vyúčtovanie, reconciliation, MCP match tool, list label).
12. All new strings exist in sk, en, cs; connector errors render translated.
14. With `bank_iban` set, picking / syncing an account whose IBAN differs
    (spaces / case ignored) is refused with `EB_IBAN_MISMATCH`; picking a
    different account resets `lastSyncAt`.
15. First sync after months of camt.053 / Fio imports starts at the latest
    such payment's day, not 90 days back; a same-day line equal by date +
    amount + VS (+ IBAN) to a payment of another source is imported
    unmatched and counted as `possibleDuplicates`, never auto-posted.
16. A sync that hits the 50-page cap leaves `lastSyncAt` unchanged and the
    next sync continues from the stored continuation key.
13. `pnpm test:accounting-enable-banking` covers the mapper (booked-only,
    direction, cents, id fallback, VS extraction, counterparty side) and the
    JWT shape, with no network.

## Open questions
- Enable Banking production pricing for cloud (quote form) — blocks cloud
  rollout, not self-host.
- Which SK banks return `entry_reference` / `transaction_id` and where they
  put the VS — verify in sandbox per bank, extend the golden check with real
  (anonymised) samples.
- Multi-account doms (separate fond opráv account).

## Progress
- [x] Spec
- [x] Schema + migration (enum values, `config`, `valid_until`)
- [x] Pure mapper + golden check
- [x] Connector (JWT, aspsps, auth, session, sync, disconnect)
- [x] API routes
- [x] UI: settings page + setup guide (Pokročilé), compact card on Platby
- [x] i18n sk/en/cs
- [x] `.env.example`
- [x] `pnpm db:generate` → `drizzle/0084_enable_banking_connector.sql`
- [x] `tsc --noEmit` clean (whole repo)
- [x] Review fixes (2026-11-18): IBAN guard `EB_IBAN_MISMATCH`, lastSyncAt
      reset on account change, first-sync floor at other sources, cross-source
      content dedupe (`possibleDuplicates`), page-cap cursor (AC 14–16)
- [x] i18n for `EB_IBAN_MISMATCH` + `summaryPossibleDuplicates` (present in
      sk/en/cs as of 2026-11-18)
- [x] Admin-entered credentials in DB (encrypted, verified via
      `GET /application`), migration `0088_bank_app_credentials`, secret-box +
      key-normalize golden checks, AC 1c–1f
- [ ] Integration tests for AC 14–16 (DB-backed; golden check only covers
      `pickAccountUid`)
- [ ] `pnpm test:accounting-enable-banking` (owner runs)
- [ ] Manual verification against Enable Banking sandbox (owner)
- [ ] Phase 2: cron auto-sync, consent-expiry email, cloud handoff
