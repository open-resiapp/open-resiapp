---
spec_id: RES-20260312-001
title: "Voting/posting per entrance"
status: idea
created: 2026-03-12
updated: 2026-03-12
author: "open-housing"
owner: ""
last_verified: 2026-03-12
project_type: feature
depends_on: []
related_handoffs: []
tags: [voting, posts, entrances, multi-entrance]
---

## Goal
Allow voting and posting per entrance, not just per building. This enables
more granular decisions for residents in the same building but different
entrances (e.g. oprava schodiska len vo Vchode A).

## Scope
- Voting – scope: `building` | `entrance`
- Posting (nástenka) – scope: `building` | `entrance` | `all`

## Approach

### Dátový model
Votings a Posts už majú väzbu na `building_id`. Pridať voliteľné pole:
```typescript
// votings table
entranceId: uuid('entrance_id')
  .references(() => entrances.id) // NULL = celá bytovka
  
// posts table  
entranceId: uuid('entrance_id')
  .references(() => entrances.id) // NULL = všetci vidia
```

### Permissions / viditeľnosť
- Ak `entrance_id = NULL` → vidia všetci vlastníci/nájomcovia
- Ak `entrance_id = X` → vidia len obyvatelia vchodu X
- Admin vždy vidí všetko

### Hlasovanie per-vchod
- Hlasovať môžu len vlastníci bytov v danom vchode
- Podiely sa počítajú len z bytov toho vchodu
- Kvórum sa vypočíta z celkového podielu daného vchodu

### UI
- Pri vytváraní hlasovania/postu: dropdown
  `[ Celá bytovka ▼ ]` → `[ Vchod A | Vchod B | Vchod C ]`
- V zozname hlasovaní/postov: badge `Vchod A` pri každom
- Vlastník vidí len relevantné záznamy (filtrované)

## Acceptance Criteria
- [ ] Admin môže vytvoriť hlasovanie pre konkrétny vchod
- [ ] Hlasovať môžu len vlastníci daného vchodu
- [ ] Výsledky a podiely sú relatívne k vchodu, nie celej bytovke
- [ ] Admin môže vytvoriť post pre konkrétny vchod
- [ ] Vlastníci vidia posty svojho vchodu + posty pre celú bytovku
- [ ] Nájomcovia rovnako (viditeľnosť)
- [ ] Zápisnica PDF jasne uvádza: "Hlasovanie pre Vchod A"
- [ ] Migrácia je non-breaking (existujúce záznamy = NULL = building-wide)

## Project Context
Bytové spoločenstvo môže mať viacero vchodov (napr. Hlavná 12, 14, 16)
ale právne je to jedna entita. Niektoré rozhodnutia sa týkajú len
jedného vchodu (oprava strechy, výťah, schodisko).

## Notes
- Reťazové mandáty stále zakázané aj pri per-entrance hlasovaní
- BSM pravidlo platí rovnako (1 byt = 1 hlas)
- Právne: per-entrance hlasovanie je podmnožina písomného hlasovania,
  rovnaké pravidlá podľa §14a zák. 182/1993 Z.z.
- NULL entrance_id = backward compatible so všetkými existujúcimi záznamami
