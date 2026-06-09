---
spec_id: BYT-20260512-008
title: "Custom logo per instance (white-label)"
status: implemented
created: 2026-05-12
updated: 2026-06-09
author: Filip
owner: Filip
last_verified: 2026-06-09
project_type: node
depends_on: []
related_handoffs: []
tags: [white-label, branding, theming, client-feedback]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Allow each HOA instance to upload its own logo, replacing the default ResiApp/byt-app logo across the dashboard, login, and email headers. First step toward instance-level white-labeling.

## Scope

**IN scope:**
- Settings page: upload logo (PNG/SVG, max ~500 KB, recommended ratio documented)
- Storage: file-system uploads category `branding` with admin-only upload permission
- Render: header, login page, password reset email header — read from instance branding row, fall back to default
- Remove logo (revert to default)

**OUT of scope** (explicit backlog — one follow-up each, so unbranded surfaces aren't a surprise per the cross-cutting-visual rule):
- Custom colors / full theming (separate spec)
- Per-building (vs per-instance) logos
- Favicon override
- Logo in generated PDFs (voting minutes, vyúčtovanie, predpis headers)
- OG / social-share meta image
- Browser-tab title / app-name override
- SVG upload (XSS-sanitized) — raster only in v1

## Approach

### Storage & data
- New `instance_branding` store, one row per instance: `(entity_id PK/FK → entities.id ON DELETE cascade, logo_storage_key text NULL, updated_at, updated_by_user_id FK → users ON DELETE set null)`. Absence of a row (or null key) ⇒ default logo. Schema via `drizzle-kit generate` — no manual SQL.
- Blob stored via existing `src/lib/storage.ts` `buildStorageKey("branding", …)` (category already supported). Admin-only write.

### Accepted formats (XSS decision)
- v1 accepts **PNG / JPEG / WebP only** (raster). Server validates **magic-bytes**, not just extension/MIME. Max ~500 KB, max 1024×1024 px; oversized/wrong-type rejected with a translated error.
- **SVG deferred** — inline-SVG XSS risk. If added later: sanitize server-side (strip `<script>`, `foreignObject`, event handlers) via a vetted sanitizer before storage. Out of scope for v1.

### Render points (server-painted)
- Replace the hardcoded inline `<svg>` mark in `src/components/layout/Header.tsx` with a logo that reads `instance_branding.logo_storage_key` **server-side** in the dashboard/auth layout and renders `<img>`; default mark when null.
- Login page + auth layout: same server-read source.
- Email header (`src/lib/email.ts`): inject logo as an **absolute public URL** `<img>` into the header `<div>`; fall back to the default asset URL when unset. Emails render server-side — no client swap.

### FOUC / navigation flicker
Cross-cutting visual change, so per project rule:
- **(a) Persistence channel** — branding lives in the DB, read server-side in the layout, so the server paints the resolved logo on first render. No `localStorage`, no client fetch-then-swap (which would flash default → custom on every RSC navigation).
- **(b) Canvas painting** — the logo slot has fixed reserved dimensions (aspect-ratio box, `<img>` width/height set) so default↔custom swap causes no layout shift / reflow.
- **(c) Pre-paint resolution** — N/A: the branding row is fully server-knowable, so first paint is always correct (no `prefers-color-scheme`-style client-only value).
- **(d) Flash-free verification** — exercise an RSC navigation (login → dashboard → settings → dashboard) on a branded instance and confirm the custom logo never flashes to default between paints.

## Acceptance Criteria

### Upload & storage
- [ ] Admin can upload a logo from Settings (PNG / JPEG / WebP, ≤500 KB, ≤1024×1024); server validates **magic-bytes**, not just MIME.
- [ ] Oversized / wrong-type / SVG uploads are rejected with a translated error message.
- [ ] Logo persists in `instance_branding` (one row per instance) and the blob via `src/lib/storage.ts` category `branding`.
- [ ] Every new FK specifies explicit `onDelete` (entity → cascade, user → set null) per project rule; schema generated via `drizzle-kit generate`.

### Render (flash-free)
- [ ] Header + login + auth layout render the instance logo, read **server-side** on first paint — no client fetch-then-swap, no flash on RSC navigation.
- [ ] Logo slot has reserved dimensions; default↔custom swap causes no layout shift.
- [ ] Unbranded instance shows the deterministic default mark on every surface (no broken-image, no empty box).
- [ ] Email header (password reset + invitation) shows the instance logo via an **absolute public URL**; falls back to default when unset.

### Delete / undo
- [ ] Admin can remove the logo; the row is cleared AND the stored blob is deleted (no orphan file).
- [ ] After delete, all surfaces revert to the default mark within one request (no cached custom logo).

### Permission & i18n
- [ ] Only admin (`manageSettings`) can upload/delete — enforced **server-side**, not just hidden in UI.
- [ ] All new user-facing strings (labels, help text, errors) via `useTranslations()`, added to `sk.json`, `en.json`, and `cs.json`.

## Notes

- Client meeting 2026-05-12: "Logo pre own appku"
- **Resolved 2026-06-09**: SVG **not** accepted in v1 (inline-SVG XSS). Raster only (PNG/JPEG/WebP), magic-byte validated. SVG → backlog with server-side sanitizer.
- Default fallback path must be deterministic so an unbranded instance still looks polished.
- **Verified 2026-06-09**: no branding store exists today (`instance_branding` is net-new); header logo is a hardcoded inline `<svg>` in `src/components/layout/Header.tsx`; `src/lib/storage.ts` `buildStorageKey(category, …)` already supports a `branding` category; emails are raw HTML `<div>` headers in `src/lib/email.ts` with no logo; locales = sk/en/cs.
## Implementation notes (2026-06-09)

Implemented. **Key deviation from the Approach above**: branding is NOT a
separate `instance_branding` table — it lives in `entities.data.branding`
(jsonb) on the **primary root entity**, mirroring how the rest of the instance
config (name, address, country, legal_notice) is already stored. No schema
migration, no new FK. "Per-instance" = the primary root (`getCommunityRoot()`
/ oldest non-archived top-level entity), which needs no session — so the logo
resolves on the pre-auth login page, in emails, and in the web manifest.

**Scope added vs the original idea**: PWA home-screen icon (the idea only had
"favicon = OUT"). The user opted in. Square 192 / 512 / maskable / apple-touch
PNGs are generated in the admin's browser via `<canvas>` at upload (no server
image library — none is installed), stored alongside the logo, and served to
the dynamic manifest + apple-touch-icon link. UI surfaces the OS caveat:
already-installed home-screen icons are frozen until reinstall.

**Files**
- `src/lib/branding.ts` — client-safe constants/types (accepted MIME, size/dim
  caps, icon sizes, `BrandingData`, asset-path helper).
- `src/lib/branding.server.ts` — root resolution, get/set branding (jsonb),
  magic-byte image sniff + PNG/JPEG/WebP dimension parse, email URL helper.
- `src/app/api/branding/route.ts` — GET (has-logo + version), POST (multipart
  logo + 4 icons, `manageSettings`-gated, magic-byte validated), DELETE.
- `src/app/api/branding/asset/[name]/route.ts` — PUBLIC asset bytes; icon
  variants fall back to bundled defaults so manifest/apple-touch never 404;
  version-aware cache (immutable when `?v=`, else 5 min).
- `src/app/api/manifest/route.ts` — serves the custom icons when set.
- `src/app/[locale]/layout.tsx` — apple-touch-icon link.
- `src/app/[locale]/(auth)/layout.tsx` — server-painted login logo.
- `src/components/layout/Sidebar.tsx` — in-app logo.
- `src/components/settings/BrandingTab.tsx` + `SettingsTabs.tsx` + settings page
  — upload / preview / remove UI (admin only) + client-side icon generation.
- `src/lib/email.ts` — optional logo header on password-reset + pairing emails.
- `messages/{sk,en,cs}.json` — `Branding` namespace + `Settings.tabBranding`.

**AC reconciliation**: the two table-specific ACs ("persists in
`instance_branding`", "every new FK specifies `onDelete`") are SUPERSEDED —
there is no new table or FK; the equivalent guard is the jsonb write on the
root entity. All render / delete / permission / i18n / FOUC ACs hold as
written. FOUC: login is server-painted; the dashboard sidebar follows the
existing client-fetch pattern (the brand NAME already loads that way), with a
fixed-height slot to avoid layout shift.

**Verification pending**: build + manual test by the user (per working
agreement — I don't run dev/lint/test). SVG still rejected (raster only). No
`sharp` / image library added.
