---
spec_id: RES-20260417-001
title: "Community foundation – schema, API, permissions, navigation"
status: spec
created: 2026-04-17
updated: 2026-04-17
author: "open-housing"
owner: "open-housing"
last_verified: 2026-04-17
project_type: feature
depends_on: []
related_handoffs: []
tags: [community, schema, api, foundation]
---

## Goal
Pridať do open-housing appky sekciu **Komunita** – čisto susedský
priestor bez správcovských funkcií. Táto spec pokrýva zdieľané
základy: DB schema, API routes pre posts + responses, permissions,
navigáciu a shared UI komponenty. Nad týmto foundationom potom
vzniknú jednotlivé podsekcie (burza, pomoc, udalosti, adresár)
ako samostatné specs.

## Scope

### V scope
- DB schema: `community_posts`, `community_responses`, enumy
  `community_post_type`, `community_post_status`
- Drizzle migrácia (`npm run db:generate && npm run db:migrate`)
- Spoločné API routes:
  - `GET/POST /api/community/posts`
  - `GET/PATCH /api/community/posts/[id]`
  - `POST /api/community/posts/[id]/respond`
- Permissions (`communityPermissions` v `src/lib/permissions.ts`)
  – pre všetky roly vrátane nájomcov
- Navigačný entry `/komunita` v `Sidebar.tsx`
- `/komunita` landing page s odkazmi na 4 podsekcie
- Auto-expirácia postov po 30 dňoch (`expiresAt`)
- Shared UI komponenty: `PostCard`, `PostForm`, `ResponseList`
- i18n kľúče v `sk.json` a `en.json` (Komunita namespace)

### Mimo scope
- Konkrétne podsekcie (burza/pomoc/udalosti/adresár) – vlastné specs
- Email notifikácie – vlastná spec
- Directory (`directory_entries`) – vlastná spec
- Real-time updates / WebSocket
- Mazanie postov (MVP rieši len `resolved` status)

## Approach

### Dátový model (`src/db/schema.ts`)
```typescript
export const communityPostTypeEnum = pgEnum('community_post_type', [
  'sale', 'free', 'borrow', 'help_request', 'help_offer', 'event',
])

export const communityPostStatusEnum = pgEnum('community_post_status', [
  'active', 'resolved', 'expired',
])

export const communityPosts = pgTable('community_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: communityPostTypeEnum('type').notNull(),
  status: communityPostStatusEnum('status').notNull().default('active'),
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content').notNull(),
  photoUrl: varchar('photo_url', { length: 1000 }),
  authorId: uuid('author_id').references(() => users.id).notNull(),
  eventDate: timestamp('event_date'),
  eventLocation: varchar('event_location', { length: 255 }),
  entranceId: uuid('entrance_id').references(() => entrances.id),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const communityResponses = pgTable('community_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  postId: uuid('post_id').references(() => communityPosts.id).notNull(),
  authorId: uuid('author_id').references(() => users.id).notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})
```

### Permissions (`src/lib/permissions.ts`)
```typescript
export const communityPermissions = {
  viewPosts:        () => true,
  createPost:       () => true,
  respondToPost:    () => true,
  resolvePost:      (role, isAuthor) => role === 'admin' || isAuthor,
}
```
Komunita je otvorená pre **všetky roly** (owner, tenant, admin).
Správcovská spoločnosť (externá) NEMÁ prístup.

### API
- `GET /api/community/posts?type=sale&status=active`
  → filter podľa `type` (optional) + `status` (default `active`)
  → expired posty filtrované server-side (`expiresAt > now()`)
- `POST /api/community/posts`
  → validácia: `title`, `content`, `type` povinné
  → `expiresAt = now() + 30 days` nastaví backend
  → `eventDate`/`eventLocation` povinné iba pre `type='event'`
- `GET /api/community/posts/[id]` → post + responses + author info
- `PATCH /api/community/posts/[id]` → len autor alebo admin,
  mení `status` na `resolved`
- `POST /api/community/posts/[id]/respond` → pridá response,
  trigger email notifikáciu autorovi (hook-point pre spec 006)

### Navigácia
Pridať položku do `Sidebar.tsx` nad Settings:
```
{ href: "/komunita", labelKey: "community", icon: "🏘️" }
```
Viditeľné pre všetky roly (žiadna permission).

### Shared UI komponenty (`src/components/community/`)
- `PostCard.tsx` – základná karta s type badge, title, content,
  author + byt/vchod, timestamp, CTA slot
- `PostForm.tsx` – formulár na vytvorenie postu, dynamické polia
  podľa `type`
- `ResponseList.tsx` – list reakcií pod postom
- `ResponseModal.tsx` – modal s textarea "Mám záujem"

### i18n
Namespace `Community` v oboch `sk.json` a `en.json`:
- navigácia, prázdne stavy, validačné hlášky, typ badges
- Tón: priateľský a susedský, nie inštitucionálny

## Acceptance Criteria
- [ ] Migrácia pre `communityPosts`, `communityResponses` + enumy prejde
- [ ] `GET /api/community/posts` vracia len `active` a nevypršané posty
- [ ] `POST /api/community/posts` nastaví `expiresAt = now() + 30d`
- [ ] `PATCH` na status `resolved` odmietnutý pre nie-autora/nie-admina
- [ ] `POST /api/community/posts/[id]/respond` uloží response
- [ ] Navigačná položka "Komunita" viditeľná pre všetky roly
- [ ] `/komunita` landing page zobrazí dlaždice na 4 podsekcie
- [ ] Shared komponenty `PostCard`/`PostForm`/`ResponseList` existujú
- [ ] Prázdny stav: "Zatiaľ žiadne príspevky. Buď prvý! [+ Pridať]"
- [ ] Mobilne responzívne (full-width karty)
- [ ] i18n kľúče v `sk.json` a `en.json`, žiadny hardcoded text

## Project Context
- Závislosti: `entrances` tabuľka (pre `entranceId`),
  `users` (pre `authorId`), `user_role` enum (pre permissions)
- Navigácia v `src/components/layout/Sidebar.tsx`
- Schema v `src/db/schema.ts`
- Permissions v `src/lib/permissions.ts`
- API routes v `src/app/api/community/`
- Stránky v `src/app/[locale]/(dashboard)/komunita/`

## Notes
- Cron job na auto-expiráciu (`status='active' → 'expired'`
  keď `expiresAt < now()`) – zvážiť v spec 006 alebo samostatne
- Fotky: decide between Vercel Blob / S3 / lokálne uploads –
  rozhodnutie odložiť po rozhodnutí v RES-20260312-002 (messages photos)
- Tone guideline pre copywriter: susedský, nie "Vážený vlastník..."

### Vzťah k existujúcim specs
- **RES-20260312-001 (voting/posting per entrance)** – rovnaký
  pattern `entranceId` (NULL = celá bytovka, X = len vchod X).
  **2026-04-17 rozhodnutie: Community foundation owns `EntranceScopePicker`.**
  Build `src/components/shared/EntranceScopePicker.tsx` v tejto spec.
  RES-312-001 ho bude reusovať keď landne (možno rozšíriť o
  voting-specific constraints, ale base API ostáva).
- **RES-20260312-003 (discussion threads with polls)** – je to
  INÝ primitive než community posts. Mentálny model pre user copy:
  - `Hlasovanie` = formálne, právne záväzné
  - `Diskusia` = neformálny group chat nad jednou témou
  - `Správy` = súkromné 1:1
  - `Komunita` = susedské (burza, pomoc, udalosti, adresár)
  UI copy v `Community` namespace musí toto rozlíšenie držať.
- **Security:** rovnaké hardening rules ako vo implemented specu
  external-api-security – rate limit, input validation, auth check
  per route.