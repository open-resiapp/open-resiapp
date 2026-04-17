---
spec_id: RES-20260417-002
title: "Community marketplace – /komunita/burza"
status: spec
created: 2026-04-17
updated: 2026-04-17
author: "open-housing"
owner: "filipvnencak"
last_verified: 2026-04-17
project_type: feature
depends_on: [RES-20260417-001]
related_handoffs: []
tags: [community, marketplace, posts]
---

## Goal
Susedská burza – miesto kde vlastníci a nájomcovia predávajú,
darujú alebo požičiavajú veci medzi sebou. Namiesto bazošu alebo
Facebook skupiny zostáva obsah v rámci komunity bytovky.

## Scope

### V scope
- Page `/komunita/burza`
- Filter tabs (NIE dropdown): `[ Všetko ] [ Predám ] [ Darujem ] [ Požičiam ]`
- Zoznam postov typu `sale | free | borrow`, zoradené najnovšie hore
- Detail postu `/komunita/burza/[id]`
- Formulár na nový post `/komunita/burza/novy`
  – pre typy `sale | free | borrow`
- Tlačidlo "Mám záujem" → `ResponseModal` → POST response
- Označenie "Vyriešené / Predané" (autor / admin) → `status=resolved`
- Delete button – autor alebo admin (DELETE endpoint zo spec 001)
- Toggle "Zobraziť vyriešené / expirované" nad zoznamom
- Voliteľne jedna fotka per post
- Voliteľné obmedzenie na konkrétny vchod (`entranceId`)

### Mimo scope
- Platobná integrácia / rezervácie
- Viac fotiek per post (MVP = 1)
- Chat / messaging (prepoj na RES-20260312-002 ak bude live)
- Reputácia / hodnotenie susedov

## Approach

### UI
Filter tabs na vrchu stránky, pod nimi grid kariet.

Karta (`PostCard` z foundation):
```
┌─────────────────────────────────┐
│ 🏷️ PREDÁM          Vchod A      │
│ Detská postieľka IKEA           │
│ Zachovalá, 3 roky stará...      │
│ [foto]                          │
│ Ján N. · Byt 12 · pred 2 hod.  │
│                    [Mám záujem] │
└─────────────────────────────────┘
```

Badge farba podľa typu:
- `sale` → modrá "PREDÁM"
- `free` → zelená "DARUJEM"
- `borrow` → žltá "POŽIČIAM / HĽADÁM"

### Flow "Mám záujem"
1. User klikne tlačidlo
2. Otvorí sa `ResponseModal` s textarea
   (preset: "Dobrý deň, mám záujem o...")
3. Odoslanie → `POST /api/community/posts/[id]/respond`
4. Author dostane email notifikáciu (spec 006)
5. Ak existuje messaging (RES-20260312-002) → prepoj na
   konverzáciu s autorom

### Flow "Označiť ako vyriešené"
- Button viditeľný len pre autora alebo admina
- PATCH → `status='resolved'`
- Post zostane zobrazený s overlay "Vyriešené" / "Predané"

### Prázdny stav
Grid prázdny → "Zatiaľ žiadne príspevky v burze. Buď prvý!
[+ Pridať príspevok]"

## Acceptance Criteria
- [ ] `/komunita/burza` zobrazí aktívne posty typu `sale|free|borrow`
- [ ] Filter tabs prepínajú medzi typmi bez refreshu stránky
- [ ] Karta zobrazuje badge, title, content, fotku, autora, vchod
- [ ] "Mám záujem" otvorí modal, odošle response, zobrazí success toast
- [ ] "Označiť ako vyriešené" dostupné pre autora/admina, overlay po PATCH
- [ ] "Zmazať" button pre autora/admina (DELETE)
- [ ] Toggle "Zobraziť vyriešené / expirované" – query `includeResolved`/`includeExpired`
- [ ] Vytvorenie postu cez `/komunita/burza/novy` funguje
- [ ] Validácia formulára: title a content povinné
- [ ] Upload fotky (max 1, max 5MB, jpg/png/webp)
- [ ] Expired posty (>30d) sa nezobrazia
- [ ] Prázdny stav s CTA tlačidlom
- [ ] Mobilne: karty full-width, tabs scrollovateľné

## Project Context
- Stránka: `src/app/[locale]/(dashboard)/komunita/burza/page.tsx`
- Detail: `src/app/[locale]/(dashboard)/komunita/burza/[id]/page.tsx`
- Nová: `src/app/[locale]/(dashboard)/komunita/burza/novy/page.tsx`
- Používa shared komponenty z spec 001
- Konzumuje API z spec 001

## Notes
- Toto je najjednoduchšia podsekcia – použiť ako referenciu
  pre ostatné (pomoc, udalosti, adresár)
- Ak messaging live → "Mám záujem" môže rovno vytvoriť konverzáciu
  s prednastaveným textom

### Vzťah k existujúcim specs
- **RES-20260312-002 (messages owners-to-owners)** – soft integrácia.
  Ak bude 312-002 live pred touto spec, "Mám záujem" modal
  POKIAĽ je responder *vlastník*, vytvorí konverzáciu s autorom
  (reuse `POST /api/messages/conversations`).
  POKIAĽ je responder *nájomca*, padne na štandardný
  `community_responses` flow (messaging 312-002 je owners-only).
  Ak 312-002 NIE je live → len `community_responses` path.
- **RES-20260312-001 (per entrance)** – voliteľný filter
  "Iba môj vchod" v tabs, reuse `entranceId` semantiku z 312-001.