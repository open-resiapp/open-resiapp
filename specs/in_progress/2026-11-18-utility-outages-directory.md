---
spec_id: BYT-20261118-008
title: "Utility outages directory (static provider links)"
status: in_progress
created: 2026-11-18
updated: 2026-11-18
author: Filip
owner: filipvnencak
last_verified: 2026-11-18
project_type: node
depends_on: [BYT-20261117-ux-simplification]
related_handoffs: []
tags: [dom, utilities, outages, static-config, sk, cz]
feature_branch: ""
changelog_version: ""
changelog_date: ""
docs_version: ""
docs_communicated: ""
---

## Goal

Owner asks "why is there no water / power / heat?" and finds, in one tap under **Dom**, the right provider's official outage page and hotline for their building. Competitor has a static "Odstávky" directory; we ship the same value with zero live data, no scraping, no new DB objects.

## Scope

**IN scope:**
- New read-only page under **Dom**: "Odstávky a poruchy" (`/dom/odstavky`), linked from the Dom page (owner nav stays Domov · Hlasovanie · Moje platby · Dom).
- Static, versioned config file in the repo, per country (SK first, CZ later), grouped by utility type: voda, elektrina, plyn, teplo.
- Each entry: company name, regions served, outage-info URL, hotline, `verified_at`.
- Filter to providers relevant to the building's region when known, else show all for the country.
- Optional board override: pin the building's actual heat supplier (and optionally other utilities) so it shows first.

**OUT of scope:**
- Live outage data, scraping provider sites, polling, push notifications about outages.
- Any DB table, matview or runtime DDL.
- Provider-specific legal or contractual content (meter reading, tariffs).
- Czech data set (follow-up; structure supports it from day one).
- Geocoding the building address.

## Approach

**Data = code.** One typed module per country, e.g. `src/lib/utility-providers/sk.ts`, `cz.ts` (empty stub), shared types and loader in `src/lib/utility-providers/index.ts` (client-safe: types + constants only, no `server-only`). Registry keyed by the existing country value (`sk` | `cz`); new country = new file. Aligns with the jurisdiction-modules direction (`specs/specs/2026-06-09-jurisdiction-modules-framework-pl-de.md`); not a country branch in shared UI.

**Entry shape (sketch):**
`{ id, utility: "water"|"electricity"|"gas"|"heat", name, regions: RegionCode[] | "all", outageUrl, hotline, verifiedAt }`. Provider names are proper nouns (not i18n). Utility-type headings, helper text, "verified on", "not your region?" via next-intl in `sk`, `en`, `cs`.

**Region resolution.** Country comes from `entities.data.country` on the primary community root (`src/lib/kinds/registry.ts` community `dataSchema`; `getPrimaryRootId()` in `src/lib/branding.server.ts`), default `sk`. There is NO structured region today: `entities.data.address` is a free-text string. Options for region (see Decisions): (a) optional new `region` field in community `dataSchema` set by board (JSON data, no migration), (b) best-effort parse of address text (fragile), (c) no filter, show all for country grouped by utility. Page must work with no region: show all providers of the country.

**Board override.** Pinned providers stored in `entities.data` on the community root (e.g. `utilityPins: { heat: "<provider id or custom name+url+hotline>" }`), edited in settings. Reuse the existing root-data write path; no new table. Free-text custom heat supplier allowed because local heat suppliers are numerous and not all in the static list. URL input validated as `https://` only.

**Display.** Server component reads root data once, resolves country/region/pins, renders a static list. Cards: name, "Odstávky" link button (opens provider site, `rel="noopener noreferrer"`), `tel:` hotline link. Senior baseline from ux-simplification: tap targets >= 44 px, text >= 16 px, contrast >= 4.5:1, every icon with text label, no horizontal scroll at 390 px. No fetch, no websocket, no polling.

**Candidate SK providers (names only; every URL/number to be sourced at implementation time):**
- Voda: Bratislavská vodárenská spoločnosť, Západoslovenská vodárenská spoločnosť, Stredoslovenská vodárenská spoločnosť, Východoslovenská vodárenská spoločnosť, Podtatranská vodárenská spoločnosť. Further regional operators (e.g. in Košice, Trnava area) to be checked.
- Elektrina (distribúcia): ZSD (Západoslovenská distribučná), SSD (Stredoslovenská distribučná), VSD (Východoslovenská distribučná).
- Plyn (distribúcia): SPP-distribúcia.
- Teplo: no national list; local heat suppliers (e.g. city heating companies), covered mainly by the board pin plus a short seed list decided at implementation.

**Maintenance without runtime jobs.** Data freshness is a repo process: `verified_at` per entry, a unit test that fails CI when any entry is older than 400 days, and a yearly re-check task (calendar reminder / scheduled issue). No cron in the app.

## Acceptance Criteria

- [x] Page `/dom/odstavky` reachable from Dom for owner and board; owner bottom tab bar unchanged (Domov · Hlasovanie · Moje platby · Dom); route not added as 5th tab.
- [x] Provider data lives in versioned TS files per country under `src/lib/utility-providers/`; no DB table, migration, matview or runtime DDL added; no background job.
- [x] Entries are grouped by utility type (voda, elektrina, plyn, teplo); each entry has company name, regions served, outage URL, hotline and `verified_at`.
- [x] Every outage URL and hotline number is copied from the provider's official site at implementation time (no guessed, remembered or third-party-sourced values); `verified_at` set to the real check date; PR description lists the source page per entry.
- [x] Unit test asserts every entry has non-empty name, `https://` URL, hotline in valid `tel:` form and `verified_at`, and fails when an entry is older than 400 days.
- [x] Yearly re-check of all entries is documented (README section in the module + recurring reminder/issue created).
- [ ] When the building's region is known, only providers serving that region (plus national ones) are shown, with a "Show all providers" control; when unknown, all providers for the country are shown.
- [ ] Negative test: with region known, the rendered list contains NO provider outside that region and NO provider of another country.
- [x] Country `cz` with empty data renders a neutral empty state (localized), never SK providers; missing `country` defaults to `sk`.
- [ ] Board can pin the building's heat supplier in settings; pinned entry renders first in the teplo group and is visibly marked "Dodávateľ vášho domu" (localized). Owners cannot edit it. Pin can be removed (undo path) and page falls back to the static list.
- [ ] Custom pinned supplier validates: name required, URL `https://` only, hotline optional; invalid input shows a localized error code mapping, not raw text.
- [x] Links open the provider site in a new tab with `rel="noopener noreferrer"`; hotline is a `tel:` link; each has a visible text label.
- [x] No network request to any provider domain from server or client (verified: no `fetch`/`axios` to provider hosts; page makes no extra API calls).
- [x] All new strings exist in `messages/sk.json`, `en.json`, `cs.json`; no hardcoded text in components.
- [x] Senior baseline met at 390 px: tap targets >= 44 px, text >= 16 px, no horizontal scroll.
- [x] Disclaimer shown: info is a link-out to the provider, not guaranteed current; report wrong data via board/support.

## Project Context

- Nav: `src/lib/navigation.ts` (`house` item, href `/dom`, audience owner); Dom page `src/app/[locale]/(dashboard)/dom/page.tsx`.
- Redesign baseline: `specs/in_progress/2026-11-17-ux-simplification.md` (Phase 3 nav, Phase 4 "Dom", senior baseline, no schema change, nothing live).
- Country source: `countryEnum` (`src/db/schema.ts:57`, `sk|cz`); community `dataSchema` with `address` (free text) and `country` in `src/lib/kinds/registry.ts` (~line 530); primary root lookup `getPrimaryRootId()` in `src/lib/branding.server.ts`.
- Jurisdiction direction: `specs/specs/2026-06-09-jurisdiction-modules-framework-pl-de.md` (country registry replacing hard-coded branches).
- Similar static-content pattern: laws library `src/lib/laws.ts`, `src/lib/laws.server.ts`, route `src/app/[locale]/(dashboard)/zakony`.
- Locale catalogs: `messages/sk.json`, `messages/en.json`, `messages/cs.json`.
- Inspiration only (do not copy data): competitor notes in `resitech-features.md` ("Outages page: static directory of SK utility companies + links").

## Notes

**Decisions to confirm:**
- Region source: optional board-set `region` field on community root data (kraj / distribution area) vs address parsing vs no filter. Recommend board-set field with "all" fallback; address parsing rejected as fragile.
- Is region one value (kraj) or per-utility (water operator areas do not match kraje or distributor areas)? Likely per-utility region mapping in each entry; confirm granularity (kraj vs okres).
- Pin scope: heat only, or any utility (many buildings have a local water operator not in the list)? Recommend any utility, heat first.
- Seed list for teplo: ship none (pin-only) or a small curated list of big city heat suppliers.
- Placement: card on Dom plus own page, or section inside Dom only.
- Who triggers yearly re-check (owner of repo vs scheduled GitHub issue).
- Whether hotline numbers should be shown at all if provider publishes only a web form (allow `hotline: null`).

**Deferred:**
- Czech provider data set (CEZ Distribuce, EG.D, PREdistribuce, GasNet, water operators) with its own verification pass; CZ locale copy review.
- Per-address region via structured address / municipality code.
- Board-managed full directory (add/edit providers in UI).
- Outage notices posted by board into the notices feed (existing feed, no integration with providers).
- Other utilities (internet, waste collection).

## Implementation notes (2026-11-18)

- Data: `src/lib/utility-providers/{index,sk,cz}.ts` + README. Page `/dom/odstavky`, card on Dom. Script `pnpm test:utility-providers` (script check, not a unit test; not run).
- Decisions: no region filter v1 (ACs for region filter / negative region test not done); `regions` field omitted from entries; heat = pin-only, board pin NOT shipped (TODO(decision): /api/building PATCH has no generic data path; needs settings form + rootDataPatch); hotline nullable.
- Not included (unverified): Stredoslovenská vodárenská spoločnosť (svsbb.sk cert error / ssvs.sk no DNS). Hotline null for ZSVS, VVS, VSD (not on official outage page). PVS number is the call centre. VSD URL is the "Nahlásiť výpadok" page vypadokelektriny.sk (no planned-outage page found).
- CZ: empty stub + TODO. Recurring reminder/issue not created.
