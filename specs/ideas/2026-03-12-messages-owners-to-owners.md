 ---
spec_id: RES-20260312-002
title: "Messages owners to owners"
status: idea
created: 2026-03-12
updated: 2026-03-12
author: "open-housing"
owner: "open-housing"
last_verified: 2026-03-12
project_type: feature
depends_on: []
related_handoffs: []
tags: [messaging, owners, communication, privacy]
---

## Goal
Jednoduchý interný messaging medzi vlastníkmi bytov bez zdieľania
osobných kontaktov (email, telefón). Vlastníci komunikujú cez app,
nie cez WhatsApp skupiny alebo osobné emaily.

## Problem Statement
Vlastníci nemajú bezpečný a súkromný kanál na komunikáciu.
Zdieľanie osobných emailov/telefónov je GDPR problém.
WhatsApp skupiny sú nekontrolované a správy sa strácajú.

## User Stories
- Ako vlastník chcem poslať správu inému vlastníkovi bez toho
  aby som poznal jeho email alebo telefón
- Ako vlastník chcem dostať emailovú notifikáciu keď mi príde správa
- Ako vlastník chcem priložiť fotku k správe (napr. foto poškodenia)
- Ako vlastník chcem vidieť či si príjemca správu prečítal
- Ako vlastník chcem vidieť históriu konverzácie
- Ako admin chcem vidieť len metadáta (kto s kým), nie obsah správ
- Ako nájomca nechcem mať prístup k messaging (len vlastníci)

## Scope

### V scope (MVP)
- 1:1 správy medzi vlastníkmi
- Príloha: max 1 fotka per správa (max 5MB)
- Email notifikácia pri novej správe
- Read receipts (prečítané/neprečítané)
- Zoznam konverzácií s poslednou správou

### Mimo scope (do budúcna)
- Skupinový chat
- Video/audio správy
- Reakcie (emoji)
- Mazanie správ
- Správy pre nájomcov

## Approach

### Dátový model
```typescript
// Konverzácia medzi dvoma vlastníkmi
export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  participantAId: uuid('participant_a_id')
    .references(() => users.id).notNull(),
  participantBId: uuid('participant_b_id')
    .references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // unique constraint – max 1 konverzácia medzi dvoma ľuďmi
}, (t) => ({
  unique: unique().on(t.participantAId, t.participantBId),
}))

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversationId: uuid('conversation_id')
    .references(() => conversations.id).notNull(),
  senderId: uuid('sender_id')
    .references(() => users.id).notNull(),
  content: text('content').notNull(),
  photoUrl: varchar('photo_url', { length: 1000 }), // voliteľná fotka
  readAt: timestamp('read_at'),    // NULL = neprečítané
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

### Súkromnosť a bezpečnosť
- Vlastníci vidia meno + číslo bytu, NIE email ani telefón
- Admin nevidí obsah správ, len metadáta (kto s kým, kedy)
- Row Level Security: vlastník vidí len svoje konverzácie
- Fotky uložené s UUID názvom, nie originálnym menom súboru
- Žiadne end-to-end šifrovanie v MVP (príliš komplexné)

### Email notifikácie
- Pri novej správe: email príjemcovi s textom
  "Máte novú správu od [Meno, byt č.X]"
- Obsah správy v emaili NIE JE – len odkaz do app
- Max 1 email per 30 minút od toho istého odosielateľa
  (anti-spam throttle)

### UI štruktúra
```
/spravy
  ├── Zoznam konverzácií (inbox)
  │     [Avatar] Ján N. (byt 12)        "Dobrý deň, chcel som..."  14:32  ●
  │     [Avatar] Mária K. (byt 5)       "Ďakujem za info"          včera
  │
  └── /spravy/[conversationId]
        Ján Novák · Byt 12 · Vchod A
        ─────────────────────────────
        [bublina] Dobrý deň...          10:32
        [bublina + foto]                10:33
                        Dobre, pozriem  [bublina] 10:45 ✓✓
        ─────────────────────────────
        [ Napíšte správu...  ] [📎] [➤]
```

### Nová správa flow
1. Vlastník klikne "Napísať správu" na profile iného vlastníka
   (napr. zo zoznamu vlastníkov)
2. Ak konverzácia existuje → redirect na existujúcu
3. Ak neexistuje → vytvorí sa nová konverzácia

## Acceptance Criteria
- [ ] Vlastník môže poslať správu inému vlastníkovi
- [ ] Vlastník vidí len konverzácie kde je účastníkom
- [ ] Nájomca nemá prístup k sekcii správ
- [ ] Príjemca dostane email notifikáciu (max 1 per 30 min od odosielateľa)
- [ ] Read receipt – správa sa označí ako prečítaná pri otvorení
- [ ] Počet neprečítaných správ viditeľný v navigácii (badge)
- [ ] Fotka sa dá priložiť, max 5MB, typy: jpg/png/webp
- [ ] Admin nevidí obsah správ
- [ ] Mobilne responzívne (dôchodcovia na mobile)

## Project Context
Vlastníci dnes riešia komunikáciu cez osobné emaily alebo
WhatsApp skupiny. To je problém pre súkromie (GDPR) aj prehľadnosť.
Interný messaging v app drží komunikáciu na jednom mieste
a chráni osobné kontakty vlastníkov.

## Notes
- Zvážiť či nájomca môže písať správy správcovi/predsedovi
  (nie iným nájomcom) – možno Fáza 2
- Real-time (WebSocket/Supabase Realtime) je nice-to-have,
  MVP môže fungovať na polling každých 30 sekúnd
- GDPR: správy sú osobné údaje – pridať možnosť
  vymazania konverzácie vlastníkom
- Správy medzi vlastníkmi nie sú verejné záznamy bytovky,
  admin ich nepotrebuje vidieť ani archivovať
