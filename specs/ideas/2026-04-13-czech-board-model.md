---
spec_id: BYT-20260413-004
title: "Podpora výboru SVJ — český model orgánov správy"
status: idea
created: 2026-04-13
updated: 2026-04-13
author: "OpenResiApp"
owner: "Filip"
last_verified: 2026-04-13
project_type: other
depends_on: [BYT-20260413-002]
related_handoffs: []
tags: [czech-market, board, governance]
---

## Goal

Rozšíriť model orgánov správy o český "výbor" (kolektívny štatutárny orgán s 3+ členmi), ktorý je alternatívou k slovenskému modelu predseda + rada.

## Scope

**IN scope:**
- Výbor ako štatutárny orgán SVJ (3+ členov)
- Individuálne funkčné obdobie členov výboru (default 5 rokov)
- Country-aware board UI (SK: predseda + rada, CZ: výbor ALEBO predseda)
- Board members tabuľka v DB

**OUT of scope:**
- Kontrolná komisia (voliteľný orgán v CZ)
- Bytové družstvo orgány (predstavenstvo + kontrolní komise)
- Voľby cez hlasovaciu funkciu (zatiaľ manuálna správa)
- Integrácia s obchodným registrom

## Approach

### 1. Database zmeny

Nová tabuľka `board_members`:

```typescript
export const boardMembers = pgTable("board_members", {
  id: serial("id").primaryKey(),
  buildingId: integer("building_id").notNull().references(() => buildings.id),
  userId: integer("user_id").notNull().references(() => users.id),
  role: varchar("role", { length: 50 }).notNull(),
  // "predseda" | "clen_rady" | "clen_vyboru" | "predseda_vyboru"
  electedAt: timestamp("elected_at").notNull(),
  termEndsAt: timestamp("term_ends_at"),  // null = bez obmedzenia (SK default)
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});
```

### 2. Governance model na budove

Pridať do `buildings`:

```typescript
governanceModel: varchar("governance_model", { length: 20 }).notNull().default("chairman_council")
// "chairman_council" = predseda + rada (SK model)
// "committee" = výbor (CZ model)
// "chairman_only" = len predseda (malé SVJ v CZ)
```

### 3. Country defaults

| Country | Default governance model | Funkčné obdobie |
|---------|------------------------|------------------|
| SK | `chairman_council` | Bez obmedzenia (3 roky podľa zákona, ale app neblokuje) |
| CZ | `committee` | 5 rokov (zákonný default) |

### 4. Board UI

**SK mód (`chairman_council`):**
- Predseda (1 osoba, povinné)
- Rada (3+ členov, voliteľné)
- Zobrazenie ako dnes

**CZ mód (`committee`):**
- Výbor (3+ členov)
- Predseda výboru (volený z členov výboru)
- Zobrazenie funkčného obdobia s dátumom ukončenia
- Upozornenie keď sa blíži koniec funkčného obdobia (60 dní vopred)

**CZ mód (`chairman_only`):**
- Predseda společenství (1 osoba)
- Pre malé SVJ

### 5. Migrácia existujúcich dát

- Aktuálni useri s rolou `admin` sa nemigujú automaticky do `board_members`
- `board_members` je nová doplnková tabuľka — rola `admin` zostáva pre oprávnenia
- Board members sú "vizuálna" evidencia orgánov, oprávnenia sú stále cez role

## Acceptance Criteria

- [ ] Tabuľka `board_members` existuje s migráciou
- [ ] `governance_model` pole na `buildings` tabuľke
- [ ] Board page zobrazuje správny model podľa country/governance_model
- [ ] CZ výbor: min. 3 členov, predseda výboru volený z členov
- [ ] Funkčné obdobie s dátumom a upozornením
- [ ] Existujúce SK budovy nie sú ovplyvnené (default `chairman_council`)

## Project Context

Board page existuje na `src/app/[locale]/(dashboard)/dashboard/board/`. Aktuálne zobrazuje len statické info. Tento spec ju rozširuje o databázovú evidenciu.

## Notes

- Board members tabuľka je oddelená od oprávnení (roles). Admin rola = môže spravovať, board member = je člen orgánu. Tieto sa môžu prekrývať ale nie sú to isté.
- V CZ môže byť členom výboru aj **nevlastník** — toto je rozdiel od SK kde predseda musí byť vlastník
- Kontrolná komisia (CZ) a revízna komisia (SK) sú odložené — pridajú sa neskôr ak bude dopyt
- Bytové družstvo má úplne iné orgány (predstavenstvo, kontrolní komise, členská schůze) — to je ďalší spec