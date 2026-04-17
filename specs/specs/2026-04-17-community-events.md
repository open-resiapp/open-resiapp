---
spec_id: RES-20260417-004
title: "Community events – /komunita/udalosti"
status: spec
created: 2026-04-17
updated: 2026-04-17
author: "open-housing"
owner: "filipvnencak"
last_verified: 2026-04-17
project_type: feature
depends_on: [RES-20260417-001]
related_handoffs: []
tags: [community, events, rsvp]
---

## Goal
Susedské udalosti – grilovačka, brigáda na dvore, vianočné
stretnutie, zbierka na darček. Miesto kde sused zvolá iných
susedov a vie koľko ľudí príde.

## Scope

### V scope
- Page `/komunita/udalosti`
- Zoznam postov typu `event`, zoradené podľa `eventDate` ASC
  (najbližšie hore)
- Detail udalosti `/komunita/udalosti/[id]`
- Formulár `/komunita/udalosti/nova` s povinnými poľami
  `eventDate` a `eventLocation`
- RSVP tlačidlo "Zúčastním sa" / "Nezúčastním sa" – využije
  `communityResponses` (1 response = 1 RSVP)
- Počítadlo účastníkov rozdelené: "8 áno · 2 možno · 1 nie"
  (všetky tri statusy counted separately, nie lumping)
- Segment: nadchádzajúce / ukončené (auto podľa `eventDate`)
- Voliteľné obmedzenie na vchod

### Mimo scope
- Opakujúce sa udalosti
- Ikona / kategória udalosti
- Kalendárová integrácia (iCal export)
- Platená účasť / vyberanie peňazí
- Pripomienkový email deň pred udalosťou (spec 006 to môže pokryť)

## Approach

### UI
Karta (trochu odlišná od burzy – zdôraznený dátum):
```
┌─────────────────────────────────┐
│ 📅 NED 15. JÚN                  │
│ Spoločná grilovačka             │
│ Dvorček za Vchodom B, 17:00     │
│ Organizuje: Mária K. · Byt 5   │
│ 8 ľudí sa zúčastní             │
│              [Zúčastním sa] ✓  │
└─────────────────────────────────┘
```

### RSVP model
**2026-04-17 rozhodnutie: samostatná tabuľka `event_rsvps`**
(oddelené od `community_responses` kvôli jasnej separácii concerns).

```typescript
export const rsvpStatusEnum = pgEnum('rsvp_status', ['yes', 'no', 'maybe'])

export const eventRsvps = pgTable('event_rsvps', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').references(() => communityPosts.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  status: rsvpStatusEnum('status').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  unique: unique().on(t.postId, t.userId),
}))
```

- Migrácia patrí k tejto spec (004), nie foundation (001)
- API: `POST /api/community/posts/[id]/rsvp` s body `{ status }`
  → UPSERT na `(postId, userId)`
- `GET /api/community/posts/[id]` pridá `rsvpCount` + vlastný `myRsvp`
- `community_responses` zostáva čisto text-only (komentáre pod eventom OK)

### Segmenty
Dve záložky: `[ Nadchádzajúce ] [ Ukončené ]`
- Nadchádzajúce: `eventDate >= now()`
- Ukončené: `eventDate < now()` (read-only, bez RSVP tlačidla)

### Prázdny stav
"Žiadne nadchádzajúce udalosti. Zorganizuj prvú! [+ Nová udalosť]"

## Acceptance Criteria
- [ ] `/komunita/udalosti` zobrazí posty `type='event'` podľa `eventDate` ASC
- [ ] Tabs nadchádzajúce / ukončené fungujú
- [ ] Formulár vyžaduje `eventDate` + `eventLocation` (validácia)
- [ ] Karta zobrazí deň v týždni, dátum, čas, miesto, organizátora,
      počet áno/možno/nie (každý status zvlášť)
- [ ] "Zúčastním sa" vytvorí row v `event_rsvps` so `status='yes'`;
      opakovaný klik prepne na `'no'` (UPSERT, unique `(postId, userId)`)
- [ ] Počet účastníkov = `count(event_rsvps where status='yes')`,
      refresh po RSVP
- [ ] Migrácia `event_rsvps` + enum `rsvp_status` prejde
- [ ] Ukončené udalosti skryjú RSVP tlačidlo
- [ ] Expired posty (>30d po eventDate) skryté
- [ ] Mobilne responzívne

## Project Context
- Stránka: `src/app/[locale]/(dashboard)/komunita/udalosti/page.tsx`
- Využíva shared komponenty + API zo spec 001
- Formátovanie dátumov cez `useFormatter()` z next-intl

## Notes
- 2026-04-17: RSVP má vlastnú tabuľku `event_rsvps` +
  enum `rsvp_status`. Žiadne miešanie s `community_responses`.
- Reminder email 1 deň pred udalosťou → spec 006.
- Zvážiť auto-expiration: event dostane `status='expired'`
  7 dní po `eventDate`, nie 30 dní od `createdAt`.
  → toto si vyžaduje úpravu cron jobu (spec 001 alebo 006).

### Vzťah k existujúcim specs
- **RES-20260312-001 (per entrance)** – grilovačka/brigáda je
  typicky per-vchod (dvorček za Vchodom B). Reuse `entranceId`
  filter + badge z 312-001.
- **RES-20260312-003 (discussion threads with polls)** – pod eventom
  môže byť `polls` nice-to-have ("Akú farbu grilu?") ak 312-003 live,
  ale NIE v MVP tejto spec.