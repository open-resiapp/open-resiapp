---
spec_id: RES-20260417-005
title: "Community directory – /komunita/adresar"
status: implemented
created: 2026-04-17
updated: 2026-04-28
author: "open-housing"
owner: "filipvnencak"
last_verified: 2026-04-28
project_type: feature
depends_on: [RES-20260417-001]
related_handoffs: []
tags: [community, directory, opt-in, privacy]
---

## Goal
Opt-in susedský adresár – sused sa sám rozhodne, či zdieľa
telefón, email, poznámku a zručnosti. Cieľ: sused viem
zavolať elektrikára z piatého podlažia keď treba, namiesto
hľadania cez aplikáciu cudzieho človeka.

## Scope

### V scope
- Nová tabuľka `directory_entries`
- Migrácia
- API `GET/PUT /api/community/directory`
- Page `/komunita/adresar` – zoznam všetkých opt-in záznamov
- Page / sekcia "Upraviť môj záznam" (modal alebo `/komunita/adresar/moj`)
  s toggles: `sharePhone`, `shareEmail`, `note`, `skills`
- Filter/search podľa mena, vchodu, zručností

### Mimo scope
- Verejný adresár (viditeľný pre neprihlásených)
- Hviezdičkové hodnotenie susedov
- Export adresára (CSV/PDF)
- Group chat s "elektrikármi v bytovke"

## Approach

### Schema (`src/db/schema.ts`)
```typescript
export const directoryEntries = pgTable('directory_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull().unique(),
  sharePhone: boolean('share_phone').notNull().default(false),
  shareEmail: boolean('share_email').notNull().default(false),
  note: varchar('note', { length: 255 }),
  skills: varchar('skills', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
```

### Permissions
```typescript
export const directoryPermissions = {
  viewDirectory:    () => true,
  editOwnDirectory: () => true,
}
```
Externá správcovská spoločnosť NEMÁ prístup.

### API
- `GET /api/community/directory`
  → JOIN na `users` + `units` + `entrances` pre meno/byt/vchod
  → vráti telefón len ak `sharePhone=true`, email len ak `shareEmail=true`
  → NIKDY nevracia users bez directory entry (implicit opt-out)
- `PUT /api/community/directory`
  → upsert vlastného záznamu (kľúč `userId = session.user.id`)
- `DELETE /api/community/directory`
  → zmaže vlastný záznam úplne (full opt-out, na rozdiel od toggle)
  → admin môže zmazať aj cudzí záznam (moderácia)

### UI
```
┌─────────────────────────────────────┐
│ Ján Novák · Byt 12 · Vchod A       │
│ 📞 0900 123 456                     │
│ 🔧 "Elektrikár, rád pomôžem"        │
└─────────────────────────────────────┘
```

Tlačidlo "Upraviť môj záznam":
- Toggle: "Zdieľať telefón"
- Toggle: "Zdieľať email"
- Textarea: poznámka (max 255 znakov)
- Textarea: zručnosti (max 500 znakov)
- Save → PUT → refresh
- Tlačidlo "Odstrániť môj záznam úplne" → DELETE (full opt-out)

**Dva flavors opt-out** (z domain/community.md):
- Toggle fields off (partial) – záznam existuje, fields skryté
- DELETE (full) – záznam preč, joinuje sa nanovo pri ďalšom opt-in

Filter:
- Search input (meno, byt, zručnosti)
- Chip filter "Iba so zručnosťami" (ak chceme rýchlo nájsť elektrikára)

### Prázdny stav
"Zatiaľ nikto nezdieľa kontakt. Pridaj sa ty prvý!
[Upraviť môj záznam]"

## Acceptance Criteria
- [ ] Migrácia `directory_entries` prejde
- [ ] `GET /api/community/directory` vracia iba opt-in záznamy
- [ ] Telefón/email sa vracia len ak je `shareX=true`
- [ ] `PUT /api/community/directory` upsert vlastného záznamu
- [ ] `DELETE /api/community/directory` zmaže vlastný záznam
- [ ] Admin môže zmazať aj cudzí záznam
- [ ] Nikto iný nemôže editovať cudzí záznam
- [ ] Page zobrazuje karty s viditeľnými políčkami
- [ ] Search filter funguje na meno, byt, zručnosti
- [ ] Empty state s CTA
- [ ] Mobilne responzívne

## Project Context
- Schema: pridané do `src/db/schema.ts`
- Permissions: `src/lib/permissions.ts`
- API: `src/app/api/community/directory/route.ts`
- Page: `src/app/[locale]/(dashboard)/komunita/adresar/page.tsx`

## Notes
- GDPR: opt-in default (`sharePhone=false`, `shareEmail=false`)
- Pri mazaní user účtu (CASCADE) zmizne aj directory entry
- Zvážiť notifikáciu "nový sused v adresári" – **NIE** v MVP
  (spam-risk); radšej stats na /komunita landing