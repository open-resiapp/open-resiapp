---
spec_id: BYT-20260413-002
title: "Česká lokalizácia a country config na úrovni budovy"
status: idea
created: 2026-04-13
updated: 2026-04-13
author: "OpenResiApp"
owner: "Filip"
last_verified: 2026-04-13
project_type: other
depends_on: []
related_handoffs: []
tags: [czech-market, i18n, country-config]
---

## Goal

Pridať českú lokalizáciu (cs) a zaviesť koncept "country" na úrovni budovy, aby aplikácia vedela, aké právne pravidlá a terminológiu má používať pre konkrétny bytový dom.

## Scope

**IN scope:**
- Nový locale `cs` (routing, preklady, formátovanie)
- `messages/cs.json` s českou terminológiou
- `country` pole v tabuľke `buildings` (sk | cz)
- Country-aware formátovanie dátumov a čísel
- Aktualizácia language switchera pre 3 jazyky

**OUT of scope:**
- Zmeny v hlasovacej logike (to je spec BYT-20260413-003)
- Zmeny v board modeli (to je spec BYT-20260413-004)
- ARES integrácia

## Approach

### 1. Database — `country` pole

Pridať do `buildings` tabuľky:

```typescript
country: varchar("country", { length: 2 }).notNull().default("sk")
// "sk" = Slovensko, "cz" = Česko
```

Toto pole bude determinovať:
- Aké hlasovacie pravidlá platia (per rollam lehoty, kvóra, blokácia e-hlasovania)
- Aké orgány správy sú dostupné (predseda+rada vs výbor)
- Právne odkazy v UI a dokumentoch
- Validáciu IČO/DIČ

### 2. i18n routing

`src/i18n/routing.ts`:
```typescript
locales: ["sk", "en", "cs"] as const
```

### 3. České preklady

`messages/cs.json` — preložiť z `sk.json` s českou terminológiou:

| SK pojem | CZ ekvivalent |
|----------|---------------|
| Schôdza | Shromáždění |
| Písomné hlasovanie | Hlasování per rollam |
| Fond opráv | Příspěvek na správu domu |
| Splnomocnenie | Plná moc |
| Zápisnica | Zápis |
| Bytové spoločenstvo | Společenství vlastníků jednotek (SVJ) |
| Predseda | Předseda / Výbor |
| Rada | Kontrolní komise |
| Vlastník | Vlastník jednotky |
| Byt | Jednotka |
| Nebytový priestor | Nebytová jednotka |
| Správca | Správce |
| Domový poriadok | Domovní řád |
| Overovateľ | Ověřovatel |
| Zapisovateľ | Zapisovatel |

### 4. Formátovanie

Všetky miesta kde sa používa `sk-SK` locale formátovanie → dynamicky podľa building country alebo user locale:
- `toLocaleString("sk-SK")` → `toLocaleString(locale === "cs" ? "cs-CZ" : "sk-SK")`
- Dátumy, čísla, mena (EUR pre obe krajiny, ale CZK pre české budovy ak sa neskôr pridá)

### 5. Language switcher

Aktualizovať header component — dropdown s 3 možnosťami: Slovenčina, English, Čeština.

## Acceptance Criteria

- [ ] `messages/cs.json` existuje s kompletným prekladom všetkých kľúčov
- [ ] Routing podporuje `/cs/` prefix
- [ ] Language switcher zobrazuje 3 jazyky
- [ ] Tabuľka `buildings` má `country` pole (sk/cz)
- [ ] Dátumy a čísla sa formátujú podľa zvoleného locale
- [ ] Migrácia pre `country` pole je vygenerovaná
- [ ] Existujúce budovy majú default `country: "sk"`

## Project Context

Toto je prvý z troch specs pre českú expanziu. Nemení žiadnu business logiku — iba pridáva jazykový a country layer.

## Notes

- České preklady by mal ideálne reviewovať rodený Čech
- `country` na budove (nie na useri) — lebo pravidlá sa viažu na legislatívu kde dom stojí, nie kde býva user
- Mena: zatiaľ len EUR, CZK sa pridá neskôr ak bude dopyt