---
spec_id: RES-20260417-003
title: "Community help posts – /komunita/pomoc"
status: spec
created: 2026-04-17
updated: 2026-04-17
author: "open-housing"
owner: "filipvnencak"
last_verified: 2026-04-17
project_type: feature
depends_on: [RES-20260417-001]
related_handoffs: []
tags: [community, help, neighborly]
---

## Goal
Susedská výpomoc – jeden sused prosí o drobnú službu
(zaliatie kvetov počas dovolenky, vyvenčenie psa, drobná oprava),
iný sused ponúka pomoc (IT, elektrika, záhrada).
Stavia na foundation spec 001, ale s vlastnou UX optimalizovanou
pre "prosím / ponúkam" tón.

## Scope

### V scope
- Page `/komunita/pomoc`
- Zoznam postov typu `help`, zoradené najnovšie hore
- Rozlíšenie "Prosím o pomoc" vs "Ponúkam pomoc" – **2026-04-17
  rozhodnutie: použiť dva samostatné `type` enum hodnoty
  `help_request` / `help_offer`** (definované v spec 001).
  Formulár má radio na voľbu, backend zapisuje príslušný `type`.
- Detail postu `/komunita/pomoc/[id]`
- Formulár `/komunita/pomoc/novy`
- Tlačidlo "Rád pomôžem" / "Mám záujem" → `ResponseModal`
- Označenie "Vyriešené"
- Voliteľné obmedzenie na vchod

### Mimo scope
- Platby / odmeny (toto je susedská výpomoc, bezplatne)
- Rating susedov
- Rozlíšenie "urgentné / bežné"

## Approach

### UI
Nad zoznamom dve záložky / tabs:
- `[ Všetko ] [ Prosím o pomoc ] [ Ponúkam pomoc ]`

Filter sa aplikuje server-side cez `?type=help_request`
alebo `?type=help_offer`. "Všetko" = `?type=help_request,help_offer`
(API podporuje comma-separated types).

Karta:
```
┌─────────────────────────────────┐
│ 🤝 PROSÍM          Vchod A      │
│ Zalievanie kvetov 15.-22. júla  │
│ Idem na dovolenku...            │
│ Mária K. · Byt 5 · pred 1 dňom │
│                  [Rád pomôžem]  │
└─────────────────────────────────┘
```

### Prázdny stav
"Zatiaľ nikto nepotrebuje pomoc. Ponúkni svoje zručnosti!
[+ Pridať príspevok]"

## Acceptance Criteria
- [ ] `/komunita/pomoc` zobrazí aktívne posty typu `help_request|help_offer`
- [ ] Tabs filtrujú prosím / ponúkam (server-side cez `?type=`)
- [ ] Vytvorenie postu – radio na voľbu zapíše správny `type` enum
- [ ] "Rád pomôžem" otvorí modal, odošle response
- [ ] "Vyriešené" PATCH pre autora/admina
- [ ] "Zmazať" pre autora/admina (DELETE)
- [ ] Toggle vyriešené/expirované funguje
- [ ] Expired posty skryté
- [ ] Empty state s CTA
- [ ] Mobilne responzívne

## Project Context
- Stránka: `src/app/[locale]/(dashboard)/komunita/pomoc/page.tsx`
- Reuse shared komponentov zo spec 001
- Rovnaká API ako burza, len filter na `type IN ('help_request','help_offer')`

## Notes
- 2026-04-17: direction riešený cez dva enum typy
  (`help_request`, `help_offer`) v spec 001. Žiadna title prefix hack.
- Zvážiť notifikácie: "niekto v tvojom vchode prosí o pomoc"
  – tie sú v spec 006.

### Vzťah k existujúcim specs
- **RES-20260312-001 (per entrance)** – pomoc je často viazaná
  na fyzickú blízkosť (zaliatie kvetov, požičanie náradia).
  Defaultný scope môže byť "môj vchod" s možnosťou rozšíriť na bytovku.
  Reuse `entranceId` pattern z 312-001.
- **RES-20260312-002 (messages)** – rovnaký vzor ako marketplace:
  "Rád pomôžem" môže vytvoriť konverzáciu ak je 312-002 live
  a responder je vlastník.