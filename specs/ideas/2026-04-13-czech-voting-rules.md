---
spec_id: BYT-20260413-003
title: "České hlasovacie pravidlá — country-aware voting"
status: idea
created: 2026-04-13
updated: 2026-04-13
author: "OpenResiApp"
owner: "Filip"
last_verified: 2026-04-13
project_type: other
depends_on: [BYT-20260413-002]
related_handoffs: []
tags: [czech-market, voting, legislation]
---

## Goal

Prispôsobiť hlasovaciu logiku tak, aby rešpektovala rozdiely medzi slovenskou a českou legislatívou. Pravidlá sa budú odvíjať od `country` poľa na budove.

## Scope

**IN scope:**
- Country-aware hlasovacia logika
- České kvóra a väčšiny
- Per rollam pravidlá pre CZ (15-dňová lehota, mlčanie = nesúhlas)
- Náhradné zhromaždenie CZ (40% kvórum)
- Odstránenie blokácie e-hlasovania pre CZ budovy
- Nový kvórum typ: `all_unanimous` (100% všetkých) pre CZ

**OUT of scope:**
- Bytové družstvo model (1 člen = 1 hlas) — samostatný spec neskôr
- Zmeny v mandátovej logike
- UI zmeny okrem zobrazovania správnych pravidiel podľa country

## Approach

### 1. Country-aware voting config

Vytvoriť `src/lib/voting-rules.ts`:

```typescript
type CountryVotingRules = {
  // Per rollam
  perRollamMinDays: number | null;        // CZ: 15, SK: null
  silenceIsNo: boolean;                    // CZ: true, SK: false

  // Kvóra
  fallbackQuorum: number;                  // CZ: 0.4 (40%), SK: 0.5 (50%)
  fallbackEnabled: boolean;               // CZ: ak stanovy povolia, SK: auto po 1h

  // E-hlasovanie
  ownersQuarterBlocksElectronic: boolean;  // SK: true, CZ: false
  meetingBlocksElectronic: boolean;        // SK: true, CZ: true (zhromaždenie je prezenčné)

  // Opakované hlasovanie
  repeatedVoteEscalation: boolean;         // SK: true, CZ: false

  // Dostupné kvóra
  availableQuorumTypes: QuorumType[];
}

const SK_RULES: CountryVotingRules = {
  perRollamMinDays: null,
  silenceIsNo: false,
  fallbackQuorum: 0.5,
  fallbackEnabled: true,
  ownersQuarterBlocksElectronic: true,
  meetingBlocksElectronic: true,
  repeatedVoteEscalation: true,
  availableQuorumTypes: ["simple_present", "simple_all", "two_thirds_all"],
}

const CZ_RULES: CountryVotingRules = {
  perRollamMinDays: 15,
  silenceIsNo: true,
  fallbackQuorum: 0.4,
  fallbackEnabled: false,  // musí byť v stanovách
  ownersQuarterBlocksElectronic: false,
  meetingBlocksElectronic: true,
  repeatedVoteEscalation: false,
  availableQuorumTypes: ["simple_present", "simple_all", "two_thirds_all", "all_unanimous"],
}
```

### 2. Per rollam zmeny pre CZ

**Minimálna lehota 15 dní:**
- Pri vytváraní per rollam hlasovania pre CZ budovu, `endDate` musí byť min. 15 dní od `startDate`
- Validácia na server-side (server action) aj client-side (form)

**Mlčanie = nesúhlas:**
- Po uzavretí per rollam hlasovania v CZ budove, všetci vlastníci ktorí nehlasovali sa automaticky počítajú ako `proti`
- Toto zásadne mení výpočet výsledkov — implementovať v `calculateResults()`

### 3. Náhradné zhromaždenie (CZ)

Aktuálne SK logika: po 1 hodine neuznášaniaschopnosti sa rozhoduje väčšinou prítomných.

CZ logika: Ak stanovy povoľujú náhradné zhromaždenie, kvórum je 40%.

**Implementácia:**
- Pridať `fallbackMeeting: boolean` do voting/meeting modelu
- Pre CZ budovy: ak je hlasovanie označené ako "náhradné zhromaždenie", kvórum klesne na 40%
- Pre SK budovy: zachovať aktuálnu logiku

### 4. Nový kvórum typ

Pridať `all_unanimous` do enum:
- CZ zákon vyžaduje 100% súhlas pre: zmenu prehlásenia vlastníka, prevzatie dlhu
- SK má tiež 100% pre prevod spoločných častí, ale nie je v app implementovaný

### 5. Opakované hlasovanie (SK-only)

Aktuálne nie je implementované v app. Keď sa bude implementovať, bude to len pre SK budovy (CZ nemá eskaláciu kvóra).

### 6. E-hlasovanie blokácia

Aktuálne kód v `src/lib/voting.ts`:
```
if (initiatedBy === "owners_quarter") → electronic disabled
```

Pre CZ budovy: toto pravidlo sa **nebude aplikovať**. E-hlasovanie je v CZ liberálnejšie.

## Acceptance Criteria

- [ ] `voting-rules.ts` s SK a CZ konfiguráciou existuje
- [ ] `calculateResults()` rešpektuje `silenceIsNo` pre CZ budovy
- [ ] Per rollam pre CZ vynucuje min. 15-dňovú lehotu
- [ ] CZ budovy nemajú blokáciu e-hlasovania pri `owners_quarter`
- [ ] `all_unanimous` kvórum typ je dostupný
- [ ] Náhradné zhromaždenie s 40% kvórom funguje pre CZ
- [ ] Všetky zmeny sú unit-testovateľné (voting-rules je pure function)

## Project Context

Závisí na BYT-20260413-002 (country pole na budove). Voting logika zostáva v `src/lib/voting.ts`, pravidlá sú v novom `src/lib/voting-rules.ts`.

## Notes

- `silenceIsNo` je najzásadnejší rozdiel — úplne mení sémantiku per rollam hlasovania
- V SK sa "nehlasoval" nezapočítava, v CZ sa počíta ako "proti"
- Bytové družstvo (1 člen = 1 hlas, 2/3 kvórum) je odložené na neskôr — vyžaduje väčší refaktor
- Opakované hlasovanie s eskaláciou kvóra (SK) zatiaľ nie je implementované a nie je súčasťou tohto spec