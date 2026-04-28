---
spec_id: RES-20260312-001
title: "Voting/posting per entrance"
status: implemented
created: 2026-03-12
updated: 2026-04-28
author: "open-housing"
owner: "filipvnencak"
last_verified: 2026-04-28
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
- [x] Admin môže vytvoriť hlasovanie pre konkrétny vchod
      → `src/app/[locale]/(dashboard)/voting/new/page.tsx` (entrance dropdown)
- [x] Hlasovať môžu len vlastníci daného vchodu
      → `src/app/api/votes/route.ts` (flat-in-entrance check)
- [x] Výsledky a podiely sú relatívne k vchodu, nie celej bytovke
      → `src/app/api/votes/route.ts` (totalPossibleWeight scoped na entranceId)
- [x] Admin môže vytvoriť post pre konkrétny vchod
      → `src/components/nastenka/NewPostModal.tsx`
- [x] Vlastníci vidia posty svojho vchodu + posty pre celú bytovku
      → `src/app/api/posts/route.ts` (filter `isNull(entranceId) OR inArray(...)`)
- [x] Nájomcovia rovnako (viditeľnosť)
      → tenants sú v `userFlats` (viď `src/db/seed.ts`), filter platí rovnako
- [x] Zápisnica PDF jasne uvádza: "Hlasovanie pre Vchod A"
      → `src/components/voting/VotingMinutesPDF.tsx:307`
- [x] Migrácia je non-breaking (existujúce záznamy = NULL = building-wide)
      → `entranceId` je nullable na `votings`/`posts`

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

### 2026-04-17 – zdieľaný `EntranceScopePicker`
RES-20260417-001 (community foundation) buildne shared komponent
`src/components/shared/EntranceScopePicker.tsx`. Táto spec ho bude
REUSOVAŤ namiesto vlastného pickera. Ak voting potrebuje extra
constraints (napr. disable "Celá bytovka" pre owner so bytom len
v 1 vchode), pridať ako prop, nie vlastný komponent.

### 2026-04-28 – verified, promoted idea → implemented
Spec preskočila `spec` aj `in_progress` stavy — funkcionalita
landla inkrementálne počas community foundation prác (RES-20260417-001+)
a rôznych voting refactorov. Pri audite zistené, že všetky AC sú
hotové: schema, migrations, API filters (votings + posts), vote-cast
validation (flat-in-entrance), totalPossibleWeight scoping, voting
create form picker, voting card + detail badges, PDF zápisnica
("Hlasovanie pre vchod"), nástenka NewPostModal + PostCard badge.
EntranceScopePicker existuje v `src/components/community/`, voting
form má vlastný inline `<select>` namiesto reuse — drobný drift,
nie blocker. Pri ďalšej úprave voting formu zvážiť refactor na
zdieľaný picker.
