---
spec_id: BYT-20260413-001
title: "Analýza českého trhu - legislatívne porovnanie SK vs CZ"
status: implemented
created: 2026-04-13
updated: 2026-04-13
author: "OpenResiApp"
owner: "Filip"
last_verified: 2026-04-13
project_type: other
depends_on: []
related_handoffs: []
tags: [czech-market, analysis, legislation, i18n]
---

## Goal

Analyzovať českú legislatívu pre správu bytových domov (SVJ + bytové družstvá) a zistiť, či je dostatočne podobná slovenskej na to, aby sa OpenResiApp dala jednoducho lokalizovať pre český trh.

## Verdikt

**ÁNO — expanzia je realizovateľná s relatívne malým úsilím.** Jadro aplikácie (hlasovací algoritmus, model budov/bytov, oprávnenia, mandáty) je generické a parametrické. Hlavné rozdiely sú v:
1. Terminológii a prekladoch
2. Konkrétnych pravidlách hlasovania (kvóra, lehoty)
3. Štruktúre orgánov (výbor vs predseda+rada)

---

## Porovnanie legislatívy SK vs CZ

### Právny rámec

| Aspekt | Slovensko | Česko |
|--------|-----------|-------|
| Hlavný zákon | z. 182/1993 Z.z. (jeden zákon) | NOZ §1158-1222 (SVJ) + ZOK §727-757 (družstvo) |
| Správca | Povinne licencovaný (z. 246/2015) | Žiadna licencia |
| Povinné SVJ | Vždy keď >1 vlastník | 5+ jednotiek, 4+ rôznych vlastníkov |
| Účtovníctvo | Jednoduché alebo podvojné | Povinne podvojné |

### Hlasovanie — kľúčové rozdiely

| Aspekt | SK | CZ |
|--------|-----|-----|
| **Princíp hlasovania (SVJ)** | 1 byt = 1 hlas | Podľa podielu na spoločných častiach |
| **Kvórum schôdze** | >50% všetkých | >50% všetkých |
| **Náhradná schôdza** | 1 hodina po termíne, rozhoduje väčšina prítomných | Stanovy môžu určiť 40% kvórum |
| **Per rollam lehota** | Nie je zákonom fixovaná | Min. 15 dní |
| **Mlčanie pri per rollam** | Nie je explicitne riešené | Nereagoval = NESÚHLAS |
| **Elektronické hlasovanie** | Od 1.1.2025 (z. 325/2024) — len pri písomnom hlasovaní | Implicitne povolené cez §562 NOZ (liberálnejšie) |
| **Blokácia e-hlasovania** | 1/4 vlastníkov môže vynútiť papier | Neexistuje takáto blokácia |
| **Opakované hlasovanie** | Eskalácia kvóra (50%→66%, 66%→80%) | Neexistuje eskalácia |

### Orgány správy

| Aspekt | SK (SVB) | CZ (SVJ) |
|--------|----------|----------|
| Štatutárny orgán | Predseda | Výbor (3+ členov) ALEBO predseda |
| Kontrolný orgán | Rada (3+ členov, voliteľne) | Kontrolná komisia (voliteľné) |
| Funkčné obdobie | Nestanovené zákonom | 5 rokov (default) |
| Kto môže byť | Len vlastník | Aj nevlastník |
| Voľba | Nadpolovičná väčšina všetkých | Nadpolovičná väčšina všetkých |

### GDPR

Prakticky identické — obe krajiny pod EU GDPR. Rozdiel len v rozsahu údajov, ktoré zákon explicitne povoľuje spracúvať. Aplikácia už má consent management — stačí aktualizovať texty.

---

## Čo je v aplikácii generické (reuse as-is)

- **Hlasovací algoritmus** (`src/lib/voting.ts`) — tri metódy (per_share, per_flat, per_area) + tri typy kvóra (simple_present, simple_all, two_thirds_all). Plne parametrické.
- **Model budov/bytov** — Building → Entrances → Flats → UserFlats. Generický.
- **Mandáty/splnomocnenia** — delegácia hlasu medzi vlastníkmi. Generická logika.
- **Oprávnenia** (`src/lib/permissions.ts`) — role-based (admin, owner, tenant, vote_counter, caretaker). Generické.
- **PDF zápisnice** — framework reusable, treba len české preklady.

## Čo treba zmeniť pre CZ

### Kritické (must-have)

1. **Preklad `messages/cs.json`** — kompletná česká lokalizácia (terminológia: "shromáždění" nie "schôdza", "příspěvek na správu" nie "fond opráv", "stanovy" nie "zmluva o správe")
2. **Konfigurácia locale** — pridať "cs" do `src/i18n/routing.ts`
3. **Per rollam pravidlá** — 15-dňová lehota, pravidlo "mlčanie = nesúhlas"
4. **Náhradné zhromaždenie** — 40% kvórum (nie "1 hodina po")
5. **Orgány SVJ** — podpora pre "výbor" (kolektívny orgán, 3+ členov) ako alternatíva k jednočlennému predsedovi

### Stredná priorita

6. **IČO pole** — české IČO má rovnaký formát (8 číslic), ale DIČ je odlišné. Validácia.
7. **Formátovanie dátumov/čísel** — `cs-CZ` locale namiesto `sk-SK`
8. **Zákonné odkazy** — aktualizovať referencie zo slovenských paragrafov na české
9. **Blokácia e-hlasovania** — v CZ neexistuje blokácia pri "owners_quarter", odstrániť toto obmedzenie pre české budovy
10. **Bytové družstvo** — odlišný model (1 člen = 1 hlas, kvórum 2/3), vyžaduje si entity type

### Nice-to-have

11. **Integrácia s ARES** — český register ekonomických subjektov
12. **Šablóny českých dokumentov** — stanovy, zápisnice podľa NOZ
13. **Podpora DPP odmien** — pre členov výboru (limit 4 499 Kč)

---

## Odhad rozsahu zmien

| Oblasť | Súbory | Náročnosť |
|--------|--------|-----------|
| i18n (preklad + routing) | 3 súbory | Nízka |
| Voting rules (per-country config) | 2-3 súbory | Stredná |
| Board model (výbor support) | 3-4 súbory (schema + UI) | Stredná |
| Náhradné zhromaždenie | 2-3 súbory | Nízka |
| Per rollam pravidlá | 2-3 súbory | Nízka |
| Date/number formatting | 5-10 súborov | Nízka |
| **CELKOM** | ~20-25 súborov | **Stredná** |

---

## Záver

Česká legislatíva je dostatočne podobná slovenskej na to, aby expanzia bola realizovateľná bez zásadného refaktoru. Kľúčové architektonické rozhodnutie: **country/legal-context na úrovni budovy** — každá budova bude mať priradenú krajinu, ktorá určí pravidlá hlasovania, lehoty, štruktúru orgánov a terminológiu.

Odporúčaný prístup: **3 specs** (i18n + country config, voting rules, board model).